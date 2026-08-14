# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Any, Optional

from sqlalchemy.orm import Session

from app.db import S3User, StorageEndpoint, User, UserS3User
from app.models.admin_automation import (
    AdminAutomationItemResult,
    S3UserApply,
    S3UserSpec,
)
from app.models.s3_user import (
    S3User as S3UserSchema,
    S3UserCreate,
    S3UserUpdate,
    S3UserUserLink,
)
from app.services.admin_automation_results import AdminAutomationResultFactory
from app.services.admin_automation_storage_endpoint_resolver import (
    require_ceph_endpoint,
    resolve_storage_endpoint,
)
from app.services.audit_service import AuditService
from app.services.mappers.s3_connection import mask_access_key_id
from app.services.s3_users_service import S3UsersService
from app.utils.normalize import normalize_optional_string
from app.utils.quota_stats import bytes_to_gb
from app.utils.size_units import size_to_bytes


_ENDPOINT_FIELDS = {
    "storage_endpoint_id",
    "storage_endpoint_name",
    "storage_endpoint_url",
}
_CREDENTIAL_FIELDS = {"rgw_access_key", "rgw_secret_key"}


class AdminAutomationS3UserHandler(AdminAutomationResultFactory):
    def __init__(self, db: Session, users: S3UsersService) -> None:
        self.db = db
        self.users = users

    def apply(
        self,
        item: S3UserApply,
        dry_run: bool,
        current_user: User,
        audit_service: AuditService,
    ) -> AdminAutomationItemResult:
        key = self._key(item)
        try:
            s3_user = self._find(item)
            if item.state == "absent":
                if not s3_user:
                    return self._skipped("s3_user", key, dry_run=dry_run)
                if dry_run:
                    return self._deleted(
                        "s3_user",
                        key,
                        s3_user.id,
                        dry_run=dry_run,
                    )
                self.users.delete_user_db_only(s3_user.id)
                audit_service.record_action(
                    user=current_user,
                    scope="admin",
                    action="delete_s3_user",
                    entity_type="s3_user",
                    entity_id=str(s3_user.id),
                    metadata={"delete_rgw": False, "db_only": True},
                )
                return self._deleted(
                    "s3_user",
                    key,
                    s3_user.id,
                    dry_run=dry_run,
                )

            spec = item.spec
            if not s3_user:
                if not spec:
                    raise ValueError("s3_users.spec is required to create a new S3 user")
                if item.action == "register":
                    registration = self._prepare_registration(item, spec)
                    if dry_run:
                        return self._created("s3_user", key, dry_run=dry_run)
                    created = self._register(spec, *registration)
                    audit_service.record_action(
                        user=current_user,
                        scope="admin",
                        action="register_s3_user",
                        entity_type="s3_user",
                        entity_id=str(created.id),
                        metadata={
                            "rgw_user_uid": created.rgw_user_uid,
                            "db_only": True,
                        },
                    )
                    return self._created(
                        "s3_user",
                        key,
                        created.id,
                        dry_run=dry_run,
                    )
                created = self._create(item, spec, dry_run=dry_run)
                if dry_run:
                    return self._created("s3_user", key, dry_run=dry_run)
                audit_service.record_action(
                    user=current_user,
                    scope="admin",
                    action="create_s3_user",
                    entity_type="s3_user",
                    entity_id=str(created.id),
                    metadata={"rgw_user_uid": created.rgw_user_uid},
                )
                return self._created(
                    "s3_user",
                    key,
                    created.id,
                    dry_run=dry_run,
                )

            diff = self._diff(s3_user, item)
            if not diff:
                return self._skipped("s3_user", key, dry_run=dry_run)
            if dry_run:
                return self._updated(
                    "s3_user",
                    key,
                    s3_user.id,
                    diff,
                    dry_run=dry_run,
                )

            if spec is None:
                raise RuntimeError("S3 user update diff requires a specification")
            update_payload = self._build_update(item)
            if update_payload.model_fields_set:
                updated = self.users.update_user(s3_user.id, update_payload)
                updated_id = updated.id
            else:
                updated_id = s3_user.id
            self._apply_credentials(s3_user, spec)
            metadata = update_payload.model_dump(exclude_none=True)
            credential_fields = sorted(_CREDENTIAL_FIELDS & diff.keys())
            if credential_fields:
                metadata["credential_fields_updated"] = credential_fields
            audit_service.record_action(
                user=current_user,
                scope="admin",
                action="update_s3_user",
                entity_type="s3_user",
                entity_id=str(s3_user.id),
                metadata=metadata,
            )
            return self._updated(
                "s3_user",
                key,
                updated_id,
                diff,
                dry_run=dry_run,
            )
        except Exception as exc:  # noqa: BLE001
            return self._failed("s3_user", key, exc, dry_run=dry_run)

    def _create(
        self,
        item: S3UserApply,
        spec: S3UserSpec,
        *,
        dry_run: bool,
    ) -> Optional[S3UserSchema]:
        if not spec.name:
            raise ValueError("s3_users.spec.name is required to create a new S3 user")
        endpoint = self._resolve_endpoint(spec)
        require_ceph_endpoint(endpoint)
        if dry_run:
            return None
        created = self.users.create_user(
            S3UserCreate(
                name=spec.name,
                uid=spec.uid or item.match.uid,
                email=spec.email,
                quota_max_size_gb=spec.quota_max_size_gb,
                quota_max_size_unit=spec.quota_max_size_unit,
                quota_max_objects=spec.quota_max_objects,
                storage_endpoint_id=endpoint.id,
            )
        )
        if spec.user_ids is not None:
            created = self.users.update_user(
                created.id,
                S3UserUpdate(user_links=self._user_links(spec.user_ids)),
            )
        return created

    def _diff(
        self,
        s3_user: S3User,
        item: S3UserApply,
    ) -> dict[str, dict[str, Any]]:
        spec = item.spec
        if not spec:
            return {}
        diff: dict[str, dict[str, Any]] = {}
        fields_set = spec.model_fields_set
        if (
            "uid" in fields_set
            and spec.uid
            and spec.uid != s3_user.rgw_user_uid
        ):
            raise ValueError("uid cannot be changed for an existing S3 user")
        if "name" in fields_set and spec.name and spec.name != s3_user.name:
            diff["name"] = {"from": s3_user.name, "to": spec.name}
        if "email" in fields_set:
            desired = normalize_optional_string(spec.email)
            if desired != normalize_optional_string(s3_user.email):
                diff["email"] = {"from": s3_user.email, "to": desired}
        if _ENDPOINT_FIELDS & fields_set:
            endpoint = self._resolve_endpoint(spec)
            require_ceph_endpoint(endpoint)
            if endpoint.id != s3_user.storage_endpoint_id:
                raise ValueError(
                    "Storage endpoint cannot be changed for an existing S3 user"
                )
        if {"quota_max_size_gb", "quota_max_objects"} & fields_set:
            current_gb, current_objects = self.users.get_user_quota(s3_user)
            if "quota_max_size_gb" in fields_set:
                desired_gb = spec.quota_max_size_gb
                if desired_gb is not None:
                    desired_bytes = size_to_bytes(
                        desired_gb,
                        spec.quota_max_size_unit,
                    )
                    desired_gb = bytes_to_gb(desired_bytes)
                if desired_gb != current_gb:
                    diff["quota_max_size_gb"] = {
                        "from": current_gb,
                        "to": desired_gb,
                    }
            if (
                "quota_max_objects" in fields_set
                and spec.quota_max_objects != current_objects
            ):
                diff["quota_max_objects"] = {
                    "from": current_objects,
                    "to": spec.quota_max_objects,
                }
        if (
            "rgw_access_key" in fields_set
            and spec.rgw_access_key is not None
            and spec.rgw_access_key != s3_user.rgw_access_key
        ):
            diff["rgw_access_key"] = {
                "from": mask_access_key_id(s3_user.rgw_access_key),
                "to": mask_access_key_id(spec.rgw_access_key),
            }
        if (
            "rgw_secret_key" in fields_set
            and spec.rgw_secret_key is not None
            and spec.rgw_secret_key != s3_user.rgw_secret_key
        ):
            diff["rgw_secret_key"] = {
                "from": "<redacted>",
                "to": "<redacted>",
            }
        if "user_ids" in fields_set and spec.user_ids is not None:
            current_ids = self._linked_user_ids(s3_user.id)
            desired_ids = sorted({int(user_id) for user_id in spec.user_ids})
            if desired_ids != current_ids:
                diff["user_ids"] = {"from": current_ids, "to": desired_ids}
        return diff

    def _build_update(self, item: S3UserApply) -> S3UserUpdate:
        spec = item.spec
        if not spec:
            return S3UserUpdate()
        payload = spec.model_dump(exclude_unset=True)
        for field in (
            "uid",
            "rgw_access_key",
            "rgw_secret_key",
            "storage_endpoint_id",
            "storage_endpoint_name",
            "storage_endpoint_url",
        ):
            payload.pop(field, None)
        user_ids = payload.pop("user_ids", None)
        if user_ids is not None:
            payload["user_links"] = self._user_links(user_ids)
        return S3UserUpdate(**payload)

    def _prepare_registration(
        self,
        item: S3UserApply,
        spec: S3UserSpec,
    ) -> tuple[str, str, int]:
        if not spec.name:
            raise ValueError("s3_users.spec.name is required for register action")
        uid = spec.uid or item.match.uid
        if not uid:
            raise ValueError("s3_users.spec.uid is required for register action")
        if not spec.rgw_access_key or not spec.rgw_secret_key:
            raise ValueError(
                "s3_users.spec.rgw_access_key and rgw_secret_key are required for register action"
            )
        endpoint = self._resolve_endpoint(spec)
        require_ceph_endpoint(endpoint)
        if self.db.query(S3User).filter(S3User.rgw_user_uid == uid).first():
            raise ValueError("S3 user already exists")
        return spec.name, uid, endpoint.id

    def _register(
        self,
        spec: S3UserSpec,
        name: str,
        uid: str,
        endpoint_id: int,
    ) -> S3User:
        s3_user = S3User(
            name=name,
            rgw_user_uid=uid,
            email=spec.email,
            rgw_access_key=spec.rgw_access_key,
            rgw_secret_key=spec.rgw_secret_key,
            storage_endpoint_id=endpoint_id,
        )
        self.db.add(s3_user)
        self.db.commit()
        self.db.refresh(s3_user)
        update_data: dict[str, Any] = {}
        if spec.user_ids is not None:
            update_data["user_links"] = self._user_links(spec.user_ids)
        if spec.quota_max_size_gb is not None or spec.quota_max_objects is not None:
            update_data.update(
                quota_max_size_gb=spec.quota_max_size_gb,
                quota_max_size_unit=spec.quota_max_size_unit,
                quota_max_objects=spec.quota_max_objects,
            )
        if update_data:
            self.users.update_user(s3_user.id, S3UserUpdate(**update_data))
        return s3_user

    def _apply_credentials(self, s3_user: S3User, spec: S3UserSpec) -> None:
        changed = False
        if (
            spec.rgw_access_key is not None
            and spec.rgw_access_key != s3_user.rgw_access_key
        ):
            s3_user.rgw_access_key = spec.rgw_access_key
            changed = True
        if (
            spec.rgw_secret_key is not None
            and spec.rgw_secret_key != s3_user.rgw_secret_key
        ):
            s3_user.rgw_secret_key = spec.rgw_secret_key
            changed = True
        if changed:
            self.db.add(s3_user)
            self.db.commit()

    def _resolve_endpoint(self, spec: S3UserSpec) -> StorageEndpoint:
        endpoint = resolve_storage_endpoint(
            self.db,
            endpoint_id=spec.storage_endpoint_id,
            endpoint_name=spec.storage_endpoint_name,
            endpoint_url=spec.storage_endpoint_url,
        )
        if endpoint is None:
            raise ValueError(
                "storage_endpoint_id/name/url is required for an S3 user"
            )
        return endpoint

    def _find(self, item: S3UserApply) -> Optional[S3User]:
        if item.match.id is not None:
            return self.db.query(S3User).filter(S3User.id == item.match.id).first()
        return (
            self.db.query(S3User)
            .filter(S3User.rgw_user_uid == item.match.uid)
            .first()
        )

    def _linked_user_ids(self, s3_user_id: int) -> list[int]:
        rows = (
            self.db.query(UserS3User.user_id)
            .filter(UserS3User.s3_user_id == s3_user_id)
            .all()
        )
        return sorted(row[0] for row in rows)

    @staticmethod
    def _user_links(user_ids: list[int]) -> list[S3UserUserLink]:
        return [
            S3UserUserLink(user_id=user_id)
            for user_id in sorted({int(user_id) for user_id in user_ids})
        ]

    @staticmethod
    def _key(item: S3UserApply) -> str:
        if item.match.uid:
            return f"uid={item.match.uid}"
        return f"id={item.match.id}"
