# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Any, Optional

from sqlalchemy.orm import Session

from app.db import (
    S3Account,
    S3User,
    UiGroupS3User,
    User,
    UserS3User,
)
from app.models.admin_automation import (
    AdminAutomationApplyRequest,
    AdminAutomationApplyResponse,
    AdminAutomationItemResult,
    AdminAutomationSummary,
    S3AccountApply,
    S3UserApply,
)
from app.models.s3_account import S3AccountCreate, S3AccountUpdate
from app.models.s3_user import S3UserCreate, S3UserUpdate
from app.services.admin_automation_account_link_handler import (
    AdminAutomationAccountLinkHandler,
)
from app.services.admin_automation_connection_handler import AdminAutomationConnectionHandler
from app.services.admin_automation_results import AdminAutomationResultFactory
from app.services.admin_automation_storage_endpoint_handler import (
    AdminAutomationStorageEndpointHandler,
)
from app.services.admin_automation_storage_endpoint_resolver import (
    require_ceph_endpoint,
    resolve_storage_endpoint,
)
from app.services.admin_automation_ui_user_handler import AdminAutomationUiUserHandler
from app.services.audit_service import AuditService
from app.services.mappers.s3_connection import mask_access_key_id
from app.services.resource_deletion_purge_service import ResourceDeletionPurgeService
from app.services.s3_accounts_service import S3AccountsService
from app.services.s3_connections_service import S3ConnectionsService
from app.services.s3_users_service import S3UsersService
from app.services.storage_endpoints_service import StorageEndpointsService
from app.services.users_service import UsersService
from app.utils.normalize import normalize_optional_string
from app.utils.quota_stats import bytes_to_gb
from app.utils.size_units import size_to_bytes


class AdminAutomationService(AdminAutomationResultFactory):
    def __init__(self, db: Session) -> None:
        self.db = db
        self.storage_endpoint_handler = AdminAutomationStorageEndpointHandler(
            db,
            StorageEndpointsService(db),
        )
        users = UsersService(db)
        self.ui_user_handler = AdminAutomationUiUserHandler(db, users)
        self.account_link_handler = AdminAutomationAccountLinkHandler(db, users)
        self.s3_accounts = S3AccountsService(db)
        self.s3_users = S3UsersService(db)
        self.s3_connection_handler = AdminAutomationConnectionHandler(
            db,
            S3ConnectionsService(db),
        )

    def apply(
        self,
        payload: AdminAutomationApplyRequest,
        *,
        current_user: User,
        audit_service: AuditService,
    ) -> AdminAutomationApplyResponse:
        summary = AdminAutomationSummary()
        results: list[AdminAutomationItemResult] = []
        continue_on_error = bool(payload.continue_on_error)

        def record(result: AdminAutomationItemResult) -> None:
            results.append(result)
            if result.action == "created":
                summary.created += 1
            elif result.action == "updated":
                summary.updated += 1
            elif result.action == "deleted":
                summary.deleted += 1
            elif result.action == "skipped":
                summary.skipped += 1
            elif result.action == "failed":
                summary.failed += 1

        def should_stop() -> bool:
            return summary.failed > 0 and not continue_on_error

        for item in payload.storage_endpoints:
            record(
                self.storage_endpoint_handler.apply(
                    item,
                    payload.dry_run,
                    current_user,
                    audit_service,
                )
            )
            if should_stop():
                break

        if not should_stop():
            for item in payload.ui_users:
                record(self.ui_user_handler.apply(item, payload.dry_run, current_user, audit_service))
                if should_stop():
                    break

        if not should_stop():
            for item in payload.s3_accounts:
                record(self._apply_s3_account(item, payload.dry_run, current_user, audit_service))
                if should_stop():
                    break

        if not should_stop():
            for item in payload.s3_users:
                record(self._apply_s3_user(item, payload.dry_run, current_user, audit_service))
                if should_stop():
                    break

        if not should_stop():
            for item in payload.s3_connections:
                record(self.s3_connection_handler.apply(item, payload.dry_run, current_user, audit_service))
                if should_stop():
                    break

        if not should_stop():
            for item in payload.account_links:
                record(
                    self.account_link_handler.apply(
                        item,
                        payload.dry_run,
                        current_user,
                        audit_service,
                    )
                )
                if should_stop():
                    break

        changed = summary.created + summary.updated + summary.deleted > 0
        success = summary.failed == 0
        return AdminAutomationApplyResponse(
            changed=changed,
            success=success,
            summary=summary,
            results=results,
        )

    def _apply_s3_account(
        self,
        item: S3AccountApply,
        dry_run: bool,
        current_user: User,
        audit_service: AuditService,
    ) -> AdminAutomationItemResult:
        key = self._s3_account_key(item)
        try:
            account = self._find_s3_account(item)
            if item.state == "absent":
                if not account:
                    return self._skipped("s3_account", key, dry_run=dry_run)
                if dry_run:
                    return self._deleted("s3_account", key, account.id, dry_run=dry_run)
                self.s3_accounts.delete_account(account.id, delete_rgw=False)
                audit_service.record_action(
                    user=current_user,
                    scope="admin",
                    action="delete_account",
                    entity_type="account",
                    entity_id=str(account.id),
                    account_id=account.id,
                    metadata={"delete_rgw": False, "db_only": True},
                )
                return self._deleted("s3_account", key, account.id, dry_run=dry_run)

            spec = item.spec
            if not account:
                if not spec:
                    raise ValueError("s3_accounts.spec is required to create a new account")
                if item.action == "register":
                    created = self._register_s3_account(item, spec, dry_run)
                    if dry_run:
                        return self._created("s3_account", key, dry_run=dry_run)
                    audit_service.record_action(
                        user=current_user,
                        scope="admin",
                        action="register_account",
                        entity_type="account",
                        entity_id=str(created.id),
                        account_id=created.id,
                        account_name=created.name,
                        metadata={"rgw_account_id": created.rgw_account_id, "db_only": True},
                    )
                    return self._created("s3_account", key, created.id, dry_run=dry_run)
                name = spec.name or item.match.name
                if not name:
                    raise ValueError("s3_accounts.spec.name is required to create a new account")
                endpoint = resolve_storage_endpoint(
                    self.db,
                    endpoint_id=spec.storage_endpoint_id,
                    endpoint_name=spec.storage_endpoint_name,
                    endpoint_url=spec.storage_endpoint_url,
                )
                if endpoint is None:
                    raise ValueError("storage_endpoint_id/name/url is required to create an account")
                require_ceph_endpoint(endpoint)
                if dry_run:
                    return self._created("s3_account", key, dry_run=dry_run)
                created = self.s3_accounts.create_account_with_manager(
                    S3AccountCreate(
                        name=name,
                        email=spec.email,
                        quota_max_size_gb=spec.quota_max_size_gb,
                        quota_max_size_unit=spec.quota_max_size_unit,
                        quota_max_objects=spec.quota_max_objects,
                        storage_endpoint_id=endpoint.id,
                    )
                )
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
                return self._created("s3_account", key, created.id, dry_run=dry_run)

            diff = self._diff_s3_account(account, item)
            if not diff:
                return self._skipped("s3_account", key, dry_run=dry_run)
            if dry_run:
                return self._updated("s3_account", key, account.id, diff, dry_run=dry_run)
            update_payload = self._build_s3_account_update(item)
            updated = self.s3_accounts.update_account(account.id, update_payload)
            if spec:
                self._apply_account_credentials(updated.id, spec)
            audit_service.record_action(
                user=current_user,
                scope="admin",
                action="update_account",
                entity_type="account",
                entity_id=str(account.id),
                account_id=account.id,
                account_name=updated.name,
                metadata=update_payload.model_dump(exclude_none=True),
            )
            return self._updated("s3_account", key, account.id, diff, dry_run=dry_run)
        except Exception as exc:  # noqa: BLE001
            return self._failed("s3_account", key, exc, dry_run=dry_run)

    def _apply_s3_user(
        self,
        item: S3UserApply,
        dry_run: bool,
        current_user: User,
        audit_service: AuditService,
    ) -> AdminAutomationItemResult:
        key = self._s3_user_key(item)
        try:
            s3_user = self._find_s3_user(item)
            if item.state == "absent":
                if not s3_user:
                    return self._skipped("s3_user", key, dry_run=dry_run)
                if dry_run:
                    return self._deleted("s3_user", key, s3_user.id, dry_run=dry_run)
                self._delete_s3_user_db_only(s3_user)
                audit_service.record_action(
                    user=current_user,
                    scope="admin",
                    action="delete_s3_user",
                    entity_type="s3_user",
                    entity_id=str(s3_user.id),
                    metadata={"delete_rgw": False, "db_only": True},
                )
                return self._deleted("s3_user", key, s3_user.id, dry_run=dry_run)

            spec = item.spec
            if not s3_user:
                if not spec:
                    raise ValueError("s3_users.spec is required to create a new S3 user")
                if item.action == "register":
                    created = self._register_s3_user(item, spec, dry_run)
                    if dry_run:
                        return self._created("s3_user", key, dry_run=dry_run)
                    audit_service.record_action(
                        user=current_user,
                        scope="admin",
                        action="register_s3_user",
                        entity_type="s3_user",
                        entity_id=str(created.id),
                        metadata={"rgw_user_uid": created.rgw_user_uid, "db_only": True},
                    )
                    return self._created("s3_user", key, created.id, dry_run=dry_run)
                name = spec.name
                if not name:
                    raise ValueError("s3_users.spec.name is required to create a new S3 user")
                uid = spec.uid or item.match.uid
                endpoint = resolve_storage_endpoint(
                    self.db,
                    endpoint_id=spec.storage_endpoint_id,
                    endpoint_name=spec.storage_endpoint_name,
                    endpoint_url=spec.storage_endpoint_url,
                )
                if not endpoint:
                    raise ValueError("storage_endpoint_id/name/url is required to create an S3 user")
                if dry_run:
                    return self._created("s3_user", key, dry_run=dry_run)
                created = self.s3_users.create_user(
                    S3UserCreate(
                        name=name,
                        uid=uid,
                        email=spec.email,
                        quota_max_size_gb=spec.quota_max_size_gb,
                        quota_max_size_unit=spec.quota_max_size_unit,
                        quota_max_objects=spec.quota_max_objects,
                        storage_endpoint_id=endpoint.id,
                    )
                )
                audit_service.record_action(
                    user=current_user,
                    scope="admin",
                    action="create_s3_user",
                    entity_type="s3_user",
                    entity_id=str(created.id),
                    metadata={"rgw_user_uid": created.rgw_user_uid},
                )
                return self._created("s3_user", key, created.id, dry_run=dry_run)

            diff = self._diff_s3_user(s3_user, item)
            if not diff:
                return self._skipped("s3_user", key, dry_run=dry_run)
            if dry_run:
                return self._updated("s3_user", key, s3_user.id, diff, dry_run=dry_run)
            update_payload = self._build_s3_user_update(item)
            updated = self.s3_users.update_user(s3_user.id, update_payload)
            if spec:
                self._apply_s3_user_credentials(updated.id, spec)
            audit_service.record_action(
                user=current_user,
                scope="admin",
                action="update_s3_user",
                entity_type="s3_user",
                entity_id=str(s3_user.id),
                metadata=update_payload.model_dump(exclude_none=True),
            )
            return self._updated("s3_user", key, updated.id, diff, dry_run=dry_run)
        except Exception as exc:  # noqa: BLE001
            return self._failed("s3_user", key, exc, dry_run=dry_run)

    def _diff_s3_account(self, account: S3Account, item: S3AccountApply) -> dict[str, dict[str, Any]]:
        spec = item.spec
        if not spec:
            return {}
        diff: dict[str, dict[str, Any]] = {}
        fields_set = spec.model_fields_set
        if "rgw_account_id" in fields_set and spec.rgw_account_id and spec.rgw_account_id != account.rgw_account_id:
            raise ValueError("rgw_account_id cannot be changed for an existing account")
        if "name" in fields_set and spec.name and spec.name != account.name:
            diff["name"] = {"from": account.name, "to": spec.name}
        if "email" in fields_set:
            desired = normalize_optional_string(spec.email)
            if desired != normalize_optional_string(account.email):
                diff["email"] = {"from": account.email, "to": desired}
        if {"storage_endpoint_id", "storage_endpoint_name", "storage_endpoint_url"} & fields_set:
            endpoint = resolve_storage_endpoint(
                self.db,
                endpoint_id=spec.storage_endpoint_id,
                endpoint_name=spec.storage_endpoint_name,
                endpoint_url=spec.storage_endpoint_url,
            )
            desired_id = endpoint.id if endpoint else None
            if desired_id != account.storage_endpoint_id:
                diff["storage_endpoint_id"] = {"from": account.storage_endpoint_id, "to": desired_id}
        if {"quota_max_size_gb", "quota_max_objects"} & fields_set:
            current_gb, current_objects = self.s3_accounts._account_quota(account)
            if "quota_max_size_gb" in fields_set:
                desired_gb = spec.quota_max_size_gb
                if desired_gb is not None:
                    desired_bytes = size_to_bytes(desired_gb, spec.quota_max_size_unit)
                    desired_gb = bytes_to_gb(desired_bytes)
                if desired_gb != current_gb:
                    diff["quota_max_size_gb"] = {"from": current_gb, "to": desired_gb}
            if "quota_max_objects" in fields_set:
                if spec.quota_max_objects != current_objects:
                    diff["quota_max_objects"] = {"from": current_objects, "to": spec.quota_max_objects}
        if "rgw_access_key" in fields_set and spec.rgw_access_key is not None:
            if spec.rgw_access_key != account.rgw_access_key:
                diff["rgw_access_key"] = {"from": mask_access_key_id(account.rgw_access_key), "to": mask_access_key_id(spec.rgw_access_key)}
        if "rgw_secret_key" in fields_set and spec.rgw_secret_key is not None:
            diff["rgw_secret_key"] = {"from": "<redacted>", "to": "<redacted>"}
        if "root_user_uid" in fields_set and spec.root_user_uid is not None:
            if spec.root_user_uid != account.rgw_user_uid:
                diff["root_user_uid"] = {"from": account.rgw_user_uid, "to": spec.root_user_uid}
        return diff

    def _diff_s3_user(self, s3_user: S3User, item: S3UserApply) -> dict[str, dict[str, Any]]:
        spec = item.spec
        if not spec:
            return {}
        diff: dict[str, dict[str, Any]] = {}
        fields_set = spec.model_fields_set
        if "uid" in fields_set and spec.uid and spec.uid != s3_user.rgw_user_uid:
            raise ValueError("uid cannot be changed for an existing S3 user")
        if "name" in fields_set and spec.name and spec.name != s3_user.name:
            diff["name"] = {"from": s3_user.name, "to": spec.name}
        if "email" in fields_set:
            desired = normalize_optional_string(spec.email)
            if desired != normalize_optional_string(s3_user.email):
                diff["email"] = {"from": s3_user.email, "to": desired}
        if {"storage_endpoint_id", "storage_endpoint_name", "storage_endpoint_url"} & fields_set:
            endpoint = resolve_storage_endpoint(
                self.db,
                endpoint_id=spec.storage_endpoint_id,
                endpoint_name=spec.storage_endpoint_name,
                endpoint_url=spec.storage_endpoint_url,
            )
            if endpoint is None or endpoint.id != s3_user.storage_endpoint_id:
                raise ValueError("Storage endpoint cannot be changed for an existing S3 user")
        if {"quota_max_size_gb", "quota_max_objects"} & fields_set:
            current_gb, current_objects = self.s3_users._user_quota(s3_user)
            if "quota_max_size_gb" in fields_set:
                desired_gb = spec.quota_max_size_gb
                if desired_gb is not None:
                    desired_bytes = size_to_bytes(desired_gb, spec.quota_max_size_unit)
                    desired_gb = bytes_to_gb(desired_bytes)
                if desired_gb != current_gb:
                    diff["quota_max_size_gb"] = {"from": current_gb, "to": desired_gb}
            if "quota_max_objects" in fields_set:
                if spec.quota_max_objects != current_objects:
                    diff["quota_max_objects"] = {"from": current_objects, "to": spec.quota_max_objects}
        if "rgw_access_key" in fields_set and spec.rgw_access_key is not None:
            if spec.rgw_access_key != s3_user.rgw_access_key:
                diff["rgw_access_key"] = {"from": mask_access_key_id(s3_user.rgw_access_key), "to": mask_access_key_id(spec.rgw_access_key)}
        if "rgw_secret_key" in fields_set and spec.rgw_secret_key is not None:
            diff["rgw_secret_key"] = {"from": "<redacted>", "to": "<redacted>"}
        if "user_ids" in fields_set and spec.user_ids is not None:
            current_ids = self._s3_user_linked_ids(s3_user.id)
            desired_ids = sorted({int(x) for x in spec.user_ids})
            if desired_ids != current_ids:
                diff["user_ids"] = {"from": current_ids, "to": desired_ids}
        return diff

    def _build_s3_account_update(self, item: S3AccountApply) -> S3AccountUpdate:
        spec = item.spec
        if not spec:
            return S3AccountUpdate()
        payload = spec.model_dump(exclude_unset=True)
        payload.pop("rgw_account_id", None)
        payload.pop("root_user_uid", None)
        payload.pop("rgw_access_key", None)
        payload.pop("rgw_secret_key", None)
        payload.pop("storage_endpoint_name", None)
        payload.pop("storage_endpoint_url", None)
        endpoint = resolve_storage_endpoint(
            self.db,
            endpoint_id=spec.storage_endpoint_id,
            endpoint_name=spec.storage_endpoint_name,
            endpoint_url=spec.storage_endpoint_url,
        )
        if endpoint:
            payload["storage_endpoint_id"] = endpoint.id
        return S3AccountUpdate(**payload)

    def _build_s3_user_update(self, item: S3UserApply) -> S3UserUpdate:
        spec = item.spec
        if not spec:
            return S3UserUpdate()
        payload = spec.model_dump(exclude_unset=True)
        payload.pop("rgw_access_key", None)
        payload.pop("rgw_secret_key", None)
        payload.pop("storage_endpoint_id", None)
        payload.pop("storage_endpoint_name", None)
        payload.pop("storage_endpoint_url", None)
        return S3UserUpdate(**payload)

    def _register_s3_account(self, item: S3AccountApply, spec, dry_run: bool) -> S3Account:
        name = spec.name or item.match.name
        if not name:
            raise ValueError("s3_accounts.spec.name is required for register action")
        rgw_account_id = spec.rgw_account_id or item.match.rgw_account_id
        if not rgw_account_id:
            raise ValueError("s3_accounts.spec.rgw_account_id is required for register action")
        if not spec.root_user_uid:
            raise ValueError("s3_accounts.spec.root_user_uid is required for register action")
        if not spec.rgw_access_key or not spec.rgw_secret_key:
            raise ValueError("s3_accounts.spec.rgw_access_key and rgw_secret_key are required for register action")
        endpoint = resolve_storage_endpoint(
            self.db,
            endpoint_id=spec.storage_endpoint_id,
            endpoint_name=spec.storage_endpoint_name,
            endpoint_url=spec.storage_endpoint_url,
        )
        if not endpoint:
            raise ValueError("storage_endpoint_id/name/url is required for register action")
        require_ceph_endpoint(endpoint)
        if self.db.query(S3Account).filter(S3Account.name == name).first():
            raise ValueError("S3Account already exists")
        if self.db.query(S3Account).filter(S3Account.rgw_account_id == rgw_account_id).first():
            raise ValueError("S3Account already exists")
        if dry_run:
            return S3Account(
                id=0,
                name=name,
                rgw_account_id=rgw_account_id,
                rgw_access_key=spec.rgw_access_key,
                rgw_secret_key=spec.rgw_secret_key,
                rgw_user_uid=spec.root_user_uid,
                email=spec.email,
                storage_endpoint_id=endpoint.id,
            )
        account = S3Account(
            name=name,
            rgw_account_id=rgw_account_id,
            rgw_access_key=spec.rgw_access_key,
            rgw_secret_key=spec.rgw_secret_key,
            rgw_user_uid=spec.root_user_uid,
            email=spec.email,
            storage_endpoint_id=endpoint.id,
        )
        self.db.add(account)
        self.db.commit()
        self.db.refresh(account)
        if spec.quota_max_size_gb is not None or spec.quota_max_objects is not None:
            self.s3_accounts._apply_account_quota(
                account,
                spec.quota_max_size_gb,
                spec.quota_max_objects,
                spec.quota_max_size_unit,
            )
        return account

    def _register_s3_user(self, item: S3UserApply, spec, dry_run: bool) -> S3User:
        name = spec.name
        if not name:
            raise ValueError("s3_users.spec.name is required for register action")
        uid = spec.uid or item.match.uid
        if not uid:
            raise ValueError("s3_users.spec.uid is required for register action")
        if not spec.rgw_access_key or not spec.rgw_secret_key:
            raise ValueError("s3_users.spec.rgw_access_key and rgw_secret_key are required for register action")
        endpoint = resolve_storage_endpoint(
            self.db,
            endpoint_id=spec.storage_endpoint_id,
            endpoint_name=spec.storage_endpoint_name,
            endpoint_url=spec.storage_endpoint_url,
        )
        if not endpoint:
            raise ValueError("storage_endpoint_id/name/url is required for register action")
        require_ceph_endpoint(endpoint)
        if self.db.query(S3User).filter(S3User.rgw_user_uid == uid).first():
            raise ValueError("S3 user already exists")
        if dry_run:
            return S3User(
                id=0,
                name=name,
                rgw_user_uid=uid,
                email=spec.email,
                rgw_access_key=spec.rgw_access_key,
                rgw_secret_key=spec.rgw_secret_key,
                storage_endpoint_id=endpoint.id,
            )
        s3_user = S3User(
            name=name,
            rgw_user_uid=uid,
            email=spec.email,
            rgw_access_key=spec.rgw_access_key,
            rgw_secret_key=spec.rgw_secret_key,
            storage_endpoint_id=endpoint.id,
        )
        self.db.add(s3_user)
        self.db.commit()
        self.db.refresh(s3_user)
        if spec.user_ids is not None:
            self.s3_users._ensure_links(s3_user, spec.user_ids)
        if spec.quota_max_size_gb is not None or spec.quota_max_objects is not None:
            self.s3_users._apply_user_quota(
                s3_user,
                spec.quota_max_size_gb,
                spec.quota_max_objects,
                spec.quota_max_size_unit,
            )
        return s3_user

    def _apply_account_credentials(self, account_id: int, spec) -> None:
        if spec.rgw_access_key is None and spec.rgw_secret_key is None and spec.root_user_uid is None:
            return
        account = self.db.query(S3Account).filter(S3Account.id == account_id).first()
        if not account:
            return
        if spec.rgw_access_key is not None:
            account.rgw_access_key = spec.rgw_access_key
        if spec.rgw_secret_key is not None:
            account.rgw_secret_key = spec.rgw_secret_key
        if spec.root_user_uid is not None:
            account.rgw_user_uid = spec.root_user_uid
        self.db.add(account)
        self.db.commit()

    def _apply_s3_user_credentials(self, s3_user_id: int, spec) -> None:
        if spec.rgw_access_key is None and spec.rgw_secret_key is None:
            return
        s3_user = self.db.query(S3User).filter(S3User.id == s3_user_id).first()
        if not s3_user:
            return
        if spec.rgw_access_key is not None:
            s3_user.rgw_access_key = spec.rgw_access_key
        if spec.rgw_secret_key is not None:
            s3_user.rgw_secret_key = spec.rgw_secret_key
        self.db.add(s3_user)
        self.db.commit()

    def _find_s3_account(self, item: S3AccountApply) -> Optional[S3Account]:
        match = item.match
        if match.id is not None:
            return self.db.query(S3Account).filter(S3Account.id == match.id).first()
        if match.rgw_account_id:
            return self.db.query(S3Account).filter(S3Account.rgw_account_id == match.rgw_account_id).first()
        if match.name:
            return self.db.query(S3Account).filter(S3Account.name == match.name).first()
        return None

    def _find_s3_user(self, item: S3UserApply) -> Optional[S3User]:
        match = item.match
        if match.id is not None:
            return self.db.query(S3User).filter(S3User.id == match.id).first()
        if match.uid:
            return self.db.query(S3User).filter(S3User.rgw_user_uid == match.uid).first()
        return None

    def _delete_s3_user_db_only(self, s3_user: S3User) -> None:
        (
            self.db.query(UserS3User)
            .filter(UserS3User.s3_user_id == s3_user.id)
            .delete(synchronize_session=False)
        )
        self.db.query(UiGroupS3User).filter(UiGroupS3User.s3_user_id == s3_user.id).delete(
            synchronize_session=False
        )
        ResourceDeletionPurgeService(self.db).purge_s3_user_derived_data(s3_user.id)
        self.db.delete(s3_user)
        self.db.commit()

    def _s3_user_linked_ids(self, s3_user_id: int) -> list[int]:
        rows = (
            self.db.query(UserS3User.user_id)
            .filter(UserS3User.s3_user_id == s3_user_id)
            .all()
        )
        return sorted([row[0] for row in rows])

    def _s3_account_key(self, item: S3AccountApply) -> str:
        if item.match.name:
            return f"name={item.match.name}"
        if item.match.rgw_account_id:
            return f"rgw_account_id={item.match.rgw_account_id}"
        return f"id={item.match.id}"

    def _s3_user_key(self, item: S3UserApply) -> str:
        if item.match.uid:
            return f"uid={item.match.uid}"
        return f"id={item.match.id}"


def get_admin_automation_service(db: Session) -> AdminAutomationService:
    return AdminAutomationService(db)
