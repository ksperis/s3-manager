# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Any, Optional

from sqlalchemy.orm import Session

from app.db import S3Account, StorageEndpoint, User
from app.models.admin_automation import (
    AdminAutomationItemResult,
    S3AccountApply,
    S3AccountSpec,
)
from app.models.s3_account import (
    S3Account as S3AccountSchema,
    S3AccountCreate,
    S3AccountUpdate,
)
from app.services.admin_automation_results import AdminAutomationResultFactory
from app.services.admin_automation_storage_endpoint_resolver import (
    require_ceph_endpoint,
    resolve_storage_endpoint,
)
from app.services.audit_service import AuditService
from app.services.mappers.s3_connection import mask_access_key_id
from app.services.s3_accounts_service import S3AccountsService
from app.utils.normalize import normalize_optional_string
from app.utils.quota_stats import bytes_to_gb
from app.utils.size_units import size_to_bytes


_ENDPOINT_FIELDS = {
    "storage_endpoint_id",
    "storage_endpoint_name",
    "storage_endpoint_url",
}
_CREDENTIAL_FIELDS = {
    "rgw_access_key",
    "rgw_secret_key",
    "root_user_uid",
}


class AdminAutomationS3AccountHandler(AdminAutomationResultFactory):
    def __init__(self, db: Session, accounts: S3AccountsService) -> None:
        self.db = db
        self.accounts = accounts

    def apply(
        self,
        item: S3AccountApply,
        dry_run: bool,
        current_user: User,
        audit_service: AuditService,
    ) -> AdminAutomationItemResult:
        key = self._key(item)
        try:
            account = self._find(item)
            if item.state == "absent":
                if not account:
                    return self._skipped("s3_account", key, dry_run=dry_run)
                if dry_run:
                    return self._deleted(
                        "s3_account",
                        key,
                        account.id,
                        dry_run=dry_run,
                    )
                self.accounts.delete_account(account.id, delete_rgw=False)
                audit_service.record_action(
                    user=current_user,
                    scope="admin",
                    action="delete_account",
                    entity_type="account",
                    entity_id=str(account.id),
                    account_id=account.id,
                    metadata={"delete_rgw": False, "db_only": True},
                )
                return self._deleted(
                    "s3_account",
                    key,
                    account.id,
                    dry_run=dry_run,
                )

            spec = item.spec
            if not account:
                if not spec:
                    raise ValueError("s3_accounts.spec is required to create a new account")
                if item.action == "register":
                    registration = self._prepare_registration(item, spec)
                    if dry_run:
                        return self._created("s3_account", key, dry_run=dry_run)
                    created = self._register(spec, *registration)
                    audit_service.record_action(
                        user=current_user,
                        scope="admin",
                        action="register_account",
                        entity_type="account",
                        entity_id=str(created.id),
                        account_id=created.id,
                        account_name=created.name,
                        metadata={
                            "rgw_account_id": created.rgw_account_id,
                            "db_only": True,
                        },
                    )
                    return self._created(
                        "s3_account",
                        key,
                        created.id,
                        dry_run=dry_run,
                    )
                created = self._create(item, spec, dry_run=dry_run)
                if dry_run:
                    return self._created("s3_account", key, dry_run=dry_run)
                audit_service.record_action(
                    user=current_user,
                    scope="admin",
                    action="create_account",
                    entity_type="account",
                    entity_id=str(created.id),
                    account_id=created.id,
                    account_name=created.name,
                    metadata={
                        "quota_max_size_gb": created.quota_max_size_gb,
                        "quota_max_objects": created.quota_max_objects,
                    },
                )
                return self._created(
                    "s3_account",
                    key,
                    created.id,
                    dry_run=dry_run,
                )

            diff = self._diff(account, item)
            if not diff:
                return self._skipped("s3_account", key, dry_run=dry_run)
            if dry_run:
                return self._updated(
                    "s3_account",
                    key,
                    account.id,
                    diff,
                    dry_run=dry_run,
                )

            if spec is None:
                raise RuntimeError("S3 account update diff requires a specification")
            update_payload = self._build_update(item)
            if update_payload.model_fields_set:
                updated = self.accounts.update_account(account.id, update_payload)
                account_name = updated.name
            else:
                account_name = account.name
            if spec:
                self._apply_credentials(account, spec)
            metadata = update_payload.model_dump(exclude_none=True)
            credential_fields = sorted(_CREDENTIAL_FIELDS & diff.keys())
            if credential_fields:
                metadata["credential_fields_updated"] = credential_fields
            audit_service.record_action(
                user=current_user,
                scope="admin",
                action="update_account",
                entity_type="account",
                entity_id=str(account.id),
                account_id=account.id,
                account_name=account_name,
                metadata=metadata,
            )
            return self._updated(
                "s3_account",
                key,
                account.id,
                diff,
                dry_run=dry_run,
            )
        except Exception as exc:  # noqa: BLE001
            return self._failed("s3_account", key, exc, dry_run=dry_run)

    def _create(
        self,
        item: S3AccountApply,
        spec: S3AccountSpec,
        *,
        dry_run: bool,
    ) -> Optional[S3AccountSchema]:
        name = spec.name or item.match.name
        if not name:
            raise ValueError("s3_accounts.spec.name is required to create a new account")
        endpoint = self._resolve_endpoint(spec)
        require_ceph_endpoint(endpoint)
        if dry_run:
            return None
        return self.accounts.create_account_with_manager(
            S3AccountCreate(
                name=name,
                email=spec.email,
                quota_max_size_gb=spec.quota_max_size_gb,
                quota_max_size_unit=spec.quota_max_size_unit,
                quota_max_objects=spec.quota_max_objects,
                storage_endpoint_id=endpoint.id,
            )
        )

    def _diff(
        self,
        account: S3Account,
        item: S3AccountApply,
    ) -> dict[str, dict[str, Any]]:
        spec = item.spec
        if not spec:
            return {}
        diff: dict[str, dict[str, Any]] = {}
        fields_set = spec.model_fields_set
        if (
            "rgw_account_id" in fields_set
            and spec.rgw_account_id
            and spec.rgw_account_id != account.rgw_account_id
        ):
            raise ValueError("rgw_account_id cannot be changed for an existing account")
        if "name" in fields_set and spec.name and spec.name != account.name:
            diff["name"] = {"from": account.name, "to": spec.name}
        if "email" in fields_set:
            desired = normalize_optional_string(spec.email)
            if desired != normalize_optional_string(account.email):
                diff["email"] = {"from": account.email, "to": desired}
        if _ENDPOINT_FIELDS & fields_set:
            endpoint = self._resolve_endpoint(spec)
            require_ceph_endpoint(endpoint)
            if endpoint.id != account.storage_endpoint_id:
                diff["storage_endpoint_id"] = {
                    "from": account.storage_endpoint_id,
                    "to": endpoint.id,
                }
        if {"quota_max_size_gb", "quota_max_objects"} & fields_set:
            current_gb, current_objects = self.accounts.get_account_quota(account)
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
            and spec.rgw_access_key != account.rgw_access_key
        ):
            diff["rgw_access_key"] = {
                "from": mask_access_key_id(account.rgw_access_key),
                "to": mask_access_key_id(spec.rgw_access_key),
            }
        if (
            "rgw_secret_key" in fields_set
            and spec.rgw_secret_key is not None
            and spec.rgw_secret_key != account.rgw_secret_key
        ):
            diff["rgw_secret_key"] = {
                "from": "<redacted>",
                "to": "<redacted>",
            }
        if (
            "root_user_uid" in fields_set
            and spec.root_user_uid is not None
            and spec.root_user_uid != account.rgw_user_uid
        ):
            diff["root_user_uid"] = {
                "from": account.rgw_user_uid,
                "to": spec.root_user_uid,
            }
        return diff

    def _build_update(self, item: S3AccountApply) -> S3AccountUpdate:
        spec = item.spec
        if not spec:
            return S3AccountUpdate()
        payload = spec.model_dump(exclude_unset=True)
        for field in (
            "rgw_account_id",
            "root_user_uid",
            "rgw_access_key",
            "rgw_secret_key",
            "storage_endpoint_name",
            "storage_endpoint_url",
        ):
            payload.pop(field, None)
        if _ENDPOINT_FIELDS & spec.model_fields_set:
            endpoint = self._resolve_endpoint(spec)
            payload["storage_endpoint_id"] = endpoint.id
        return S3AccountUpdate(**payload)

    def _prepare_registration(
        self,
        item: S3AccountApply,
        spec: S3AccountSpec,
    ) -> tuple[str, str, int]:
        name = spec.name or item.match.name
        if not name:
            raise ValueError("s3_accounts.spec.name is required for register action")
        rgw_account_id = spec.rgw_account_id or item.match.rgw_account_id
        if not rgw_account_id:
            raise ValueError(
                "s3_accounts.spec.rgw_account_id is required for register action"
            )
        if not spec.root_user_uid:
            raise ValueError(
                "s3_accounts.spec.root_user_uid is required for register action"
            )
        if not spec.rgw_access_key or not spec.rgw_secret_key:
            raise ValueError(
                "s3_accounts.spec.rgw_access_key and rgw_secret_key are required for register action"
            )
        endpoint = self._resolve_endpoint(spec)
        require_ceph_endpoint(endpoint)
        if self.db.query(S3Account).filter(S3Account.name == name).first():
            raise ValueError("S3Account already exists")
        if (
            self.db.query(S3Account)
            .filter(S3Account.rgw_account_id == rgw_account_id)
            .first()
        ):
            raise ValueError("S3Account already exists")
        return name, rgw_account_id, endpoint.id

    def _register(
        self,
        spec: S3AccountSpec,
        name: str,
        rgw_account_id: str,
        endpoint_id: int,
    ) -> S3Account:
        account = S3Account(
            name=name,
            rgw_account_id=rgw_account_id,
            rgw_access_key=spec.rgw_access_key,
            rgw_secret_key=spec.rgw_secret_key,
            rgw_user_uid=spec.root_user_uid,
            email=spec.email,
            storage_endpoint_id=endpoint_id,
        )
        self.db.add(account)
        self.db.commit()
        self.db.refresh(account)
        if spec.quota_max_size_gb is not None or spec.quota_max_objects is not None:
            self.accounts.update_account(
                account.id,
                S3AccountUpdate(
                    quota_max_size_gb=spec.quota_max_size_gb,
                    quota_max_size_unit=spec.quota_max_size_unit,
                    quota_max_objects=spec.quota_max_objects,
                ),
            )
        return account

    def _apply_credentials(self, account: S3Account, spec: S3AccountSpec) -> None:
        changed = False
        if (
            spec.rgw_access_key is not None
            and spec.rgw_access_key != account.rgw_access_key
        ):
            account.rgw_access_key = spec.rgw_access_key
            changed = True
        if (
            spec.rgw_secret_key is not None
            and spec.rgw_secret_key != account.rgw_secret_key
        ):
            account.rgw_secret_key = spec.rgw_secret_key
            changed = True
        if (
            spec.root_user_uid is not None
            and spec.root_user_uid != account.rgw_user_uid
        ):
            account.rgw_user_uid = spec.root_user_uid
            changed = True
        if changed:
            self.db.add(account)
            self.db.commit()

    def _resolve_endpoint(
        self,
        spec: S3AccountSpec,
    ) -> StorageEndpoint:
        endpoint = resolve_storage_endpoint(
            self.db,
            endpoint_id=spec.storage_endpoint_id,
            endpoint_name=spec.storage_endpoint_name,
            endpoint_url=spec.storage_endpoint_url,
        )
        if endpoint is None:
            raise ValueError(
                "storage_endpoint_id/name/url is required for an account"
            )
        return endpoint

    def _find(self, item: S3AccountApply) -> Optional[S3Account]:
        match = item.match
        if match.id is not None:
            return self.db.query(S3Account).filter(S3Account.id == match.id).first()
        if match.rgw_account_id:
            return (
                self.db.query(S3Account)
                .filter(S3Account.rgw_account_id == match.rgw_account_id)
                .first()
            )
        return self.db.query(S3Account).filter(S3Account.name == match.name).first()

    @staticmethod
    def _key(item: S3AccountApply) -> str:
        if item.match.name:
            return f"name={item.match.name}"
        if item.match.rgw_account_id:
            return f"rgw_account_id={item.match.rgw_account_id}"
        return f"id={item.match.id}"
