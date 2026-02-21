# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import logging
from typing import Any, Optional

from sqlalchemy.orm import Session

from app.db import (
    AccountRole,
    S3Account,
    S3Connection,
    S3User,
    StorageEndpoint,
    StorageProvider,
    User,
    UserRole,
    UserS3Account,
    UserS3Connection,
    UserS3User,
    is_admin_ui_role,
    is_superadmin_ui_role,
)
from app.models.admin_automation import (
    AdminAutomationApplyRequest,
    AdminAutomationApplyResponse,
    AdminAutomationItemResult,
    AdminAutomationSummary,
    AccountLinkApply,
    S3AccountApply,
    S3ConnectionApply,
    S3UserApply,
    StorageEndpointApply,
    UiUserApply,
)
from app.models.s3_account import S3AccountCreate, S3AccountUpdate
from app.models.s3_user import S3UserCreate, S3UserUpdate
from app.models.storage_endpoint import StorageEndpointCreate, StorageEndpointUpdate
from app.models.user import UserCreate, UserUpdate
from app.services.audit_service import AuditService
from app.services.s3_accounts_service import S3AccountsService
from app.services.s3_users_service import S3UsersService
from app.services.storage_endpoints_service import StorageEndpointsService
from app.services.users_service import UsersService
from app.services.app_settings_service import load_app_settings
from app.utils.normalize import normalize_storage_provider
from app.utils.quota_stats import bytes_to_gb
from app.utils.size_units import size_to_bytes
from app.utils.storage_endpoint_features import dump_features_config, normalize_features_config
from app.utils.s3_connection_endpoint import build_custom_endpoint_config, parse_custom_endpoint_config, resolve_connection_details

logger = logging.getLogger(__name__)


class AdminAutomationService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.storage_endpoints = StorageEndpointsService(db)
        self.users = UsersService(db)
        self.s3_accounts = S3AccountsService(db)
        self.s3_users = S3UsersService(db)

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
            record(self._apply_storage_endpoint(item, payload.dry_run, current_user, audit_service))
            if should_stop():
                break

        if not should_stop():
            for item in payload.ui_users:
                record(self._apply_ui_user(item, payload.dry_run, current_user, audit_service))
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
                record(self._apply_s3_connection(item, payload.dry_run, current_user, audit_service))
                if should_stop():
                    break

        if not should_stop():
            for item in payload.account_links:
                record(self._apply_account_link(item, payload.dry_run, current_user, audit_service))
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

    def _apply_storage_endpoint(
        self,
        item: StorageEndpointApply,
        dry_run: bool,
        current_user: User,
        audit_service: AuditService,
    ) -> AdminAutomationItemResult:
        key = self._storage_endpoint_key(item)
        try:
            endpoint = self._find_storage_endpoint(item)
            if item.state == "absent":
                if not endpoint:
                    return self._skipped("storage_endpoint", key, dry_run=dry_run)
                if dry_run:
                    return self._deleted("storage_endpoint", key, endpoint.id, dry_run=dry_run)
                self.storage_endpoints.delete_endpoint(endpoint.id)
                audit_service.record_action(
                    user=current_user,
                    scope="admin",
                    action="delete_storage_endpoint",
                    entity_type="storage_endpoint",
                    entity_id=str(endpoint.id),
                )
                return self._deleted("storage_endpoint", key, endpoint.id, dry_run=dry_run)

            spec = item.spec
            if not endpoint:
                if not spec:
                    raise ValueError("storage_endpoints.spec is required to create a new endpoint")
                payload = self._build_storage_endpoint_create(item, spec)
                if dry_run:
                    return self._created("storage_endpoint", key, dry_run=dry_run)
                created = self.storage_endpoints.create_endpoint(payload)
                if spec.set_default:
                    self.storage_endpoints.set_default_endpoint(created.id)
                audit_service.record_action(
                    user=current_user,
                    scope="admin",
                    action="create_storage_endpoint",
                    entity_type="storage_endpoint",
                    entity_id=str(created.id),
                    metadata={
                        "endpoint_url": created.endpoint_url,
                        "provider": created.provider.value,
                        "admin_endpoint": created.admin_endpoint,
                    },
                )
                return self._created("storage_endpoint", key, created.id, dry_run=dry_run)

            diff = self._diff_storage_endpoint(endpoint, item)
            if not diff:
                if spec and spec.set_default and not endpoint.is_default:
                    if dry_run:
                        return self._updated("storage_endpoint", key, endpoint.id, {"is_default": {"from": False, "to": True}}, dry_run=dry_run)
                    updated = self.storage_endpoints.set_default_endpoint(endpoint.id)
                    audit_service.record_action(
                        user=current_user,
                        scope="admin",
                        action="set_default_storage_endpoint",
                        entity_type="storage_endpoint",
                        entity_id=str(updated.id),
                        metadata={
                            "endpoint_url": updated.endpoint_url,
                            "provider": updated.provider.value,
                        },
                    )
                    return self._updated(
                        "storage_endpoint",
                        key,
                        endpoint.id,
                        {"is_default": {"from": False, "to": True}},
                        dry_run=dry_run,
                    )
                return self._skipped("storage_endpoint", key, dry_run=dry_run)

            if dry_run:
                return self._updated("storage_endpoint", key, endpoint.id, diff, dry_run=dry_run)
            update_payload = self._build_storage_endpoint_update(item, item.spec)
            updated = self.storage_endpoints.update_endpoint(endpoint.id, update_payload)
            if item.spec and item.spec.set_default and not updated.is_default:
                updated = self.storage_endpoints.set_default_endpoint(updated.id)
            audit_service.record_action(
                user=current_user,
                scope="admin",
                action="update_storage_endpoint",
                entity_type="storage_endpoint",
                entity_id=str(endpoint.id),
                metadata={
                    "endpoint_url": updated.endpoint_url,
                    "provider": updated.provider.value,
                    "admin_endpoint": updated.admin_endpoint,
                },
            )
            return self._updated("storage_endpoint", key, endpoint.id, diff, dry_run=dry_run)
        except Exception as exc:  # noqa: BLE001
            return self._failed("storage_endpoint", key, exc, dry_run=dry_run)

    def _apply_ui_user(
        self,
        item: UiUserApply,
        dry_run: bool,
        current_user: User,
        audit_service: AuditService,
    ) -> AdminAutomationItemResult:
        key = self._ui_user_key(item)
        try:
            user = self._find_ui_user(item)
            if item.state == "absent":
                if not user:
                    return self._skipped("ui_user", key, dry_run=dry_run)
                if dry_run:
                    return self._deleted("ui_user", key, user.id, dry_run=dry_run)
                self.users.delete_user(user.id)
                audit_service.record_action(
                    user=current_user,
                    scope="admin",
                    action="delete_ui_user",
                    entity_type="ui_user",
                    entity_id=str(user.id),
                )
                return self._deleted("ui_user", key, user.id, dry_run=dry_run)

            spec = item.spec
            if not user:
                if not spec:
                    raise ValueError("ui_users.spec is required to create a new user")
                normalized_role = self._normalize_ui_role(spec.role)
                if normalized_role is not None:
                    spec.role = normalized_role
                if spec.role == UserRole.UI_SUPERADMIN.value and not is_superadmin_ui_role(current_user.role):
                    raise ValueError("Only superadmin users can promote superadmins")
                email = spec.email or item.match.email
                if not email:
                    raise ValueError("ui_users.spec.email is required to create a new user")
                if not spec.password:
                    raise ValueError("ui_users.spec.password is required to create a new user")
                if dry_run:
                    return self._created("ui_user", key, dry_run=dry_run)
                created = self.users.create_user(
                    UserCreate(
                        email=email,
                        password=spec.password,
                        full_name=spec.full_name,
                        role=spec.role,
                        is_root=bool(spec.is_root),
                    )
                )
                audit_service.record_action(
                    user=current_user,
                    scope="admin",
                    action="create_ui_user",
                    entity_type="ui_user",
                    entity_id=str(created.id),
                    metadata={"email": created.email, "role": created.role},
                )
                return self._created("ui_user", key, created.id, dry_run=dry_run)

            diff = self._diff_ui_user(user, item)
            if not diff:
                return self._skipped("ui_user", key, dry_run=dry_run)

            if dry_run:
                return self._updated("ui_user", key, user.id, diff, dry_run=dry_run)
            if item.spec:
                normalized_role = self._normalize_ui_role(item.spec.role)
                if normalized_role is not None:
                    item.spec.role = normalized_role
                if item.spec.role == UserRole.UI_SUPERADMIN.value and not is_superadmin_ui_role(current_user.role):
                    raise ValueError("Only superadmin users can promote superadmins")
            update_payload = self._build_ui_user_update(item)
            updated = self.users.update_user(user.id, update_payload)
            audit_service.record_action(
                user=current_user,
                scope="admin",
                action="update_ui_user",
                entity_type="ui_user",
                entity_id=str(user.id),
                metadata=update_payload.model_dump(exclude_unset=True, exclude_none=True),
            )
            return self._updated("ui_user", key, updated.id, diff, dry_run=dry_run)
        except Exception as exc:  # noqa: BLE001
            return self._failed("ui_user", key, exc, dry_run=dry_run)

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
                endpoint = self._resolve_storage_endpoint(spec.storage_endpoint_id, spec.storage_endpoint_name, spec.storage_endpoint_url)
                if dry_run:
                    return self._created("s3_account", key, dry_run=dry_run)
                created = self.s3_accounts.create_account_with_manager(
                    S3AccountCreate(
                        name=name,
                        email=spec.email,
                        quota_max_size_gb=spec.quota_max_size_gb,
                        quota_max_size_unit=spec.quota_max_size_unit,
                        quota_max_objects=spec.quota_max_objects,
                        storage_endpoint_id=endpoint.id if endpoint else None,
                        storage_endpoint_name=endpoint.name if endpoint else None,
                        storage_endpoint_url=endpoint.endpoint_url if endpoint else None,
                    )
                )
                db_id = int(created.db_id) if created.db_id is not None else None
                audit_service.record_action(
                    user=current_user,
                    scope="admin",
                    action="create_account",
                    entity_type="account",
                    entity_id=str(created.id),
                    account_id=db_id,
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
                endpoint = self._resolve_storage_endpoint(spec.storage_endpoint_id, spec.storage_endpoint_name, spec.storage_endpoint_url)
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
                        storage_endpoint_id=endpoint.id if endpoint else None,
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
            update_payload = self._build_s3_user_update(item, s3_user)
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

    def _apply_s3_connection(
        self,
        item: S3ConnectionApply,
        dry_run: bool,
        current_user: User,
        audit_service: AuditService,
    ) -> AdminAutomationItemResult:
        key = self._s3_connection_key(item)
        try:
            conn = self._find_s3_connection(item, current_user)
            if item.state == "absent":
                if not conn:
                    return self._skipped("s3_connection", key, dry_run=dry_run)
                if dry_run:
                    return self._deleted("s3_connection", key, conn.id, dry_run=dry_run)
                (
                    self.db.query(UserS3Connection)
                    .filter(UserS3Connection.s3_connection_id == conn.id)
                    .delete(synchronize_session=False)
                )
                self.db.delete(conn)
                self.db.commit()
                audit_service.record_action(
                    user=current_user,
                    scope="admin",
                    action="connection.delete",
                    entity_type="s3_connection",
                    entity_id=str(conn.id),
                )
                return self._deleted("s3_connection", key, conn.id, dry_run=dry_run)

            spec = item.spec
            if not conn:
                if not spec:
                    raise ValueError("s3_connections.spec is required to create a new connection")
                if not spec.name:
                    raise ValueError("s3_connections.spec.name is required to create a new connection")
                if not spec.access_key_id or not spec.secret_access_key:
                    raise ValueError("s3_connections.spec.access_key_id and secret_access_key are required to create a new connection")
                if spec.storage_endpoint_id is None and not spec.endpoint_url:
                    raise ValueError("s3_connections.spec.endpoint_url or storage_endpoint_id is required to create a new connection")
                if dry_run:
                    return self._created("s3_connection", key, dry_run=dry_run)
                conn = self._create_s3_connection(spec, current_user)
                details = resolve_connection_details(conn)
                audit_service.record_action(
                    user=current_user,
                    scope="admin",
                    action="connection.create",
                    entity_type="s3_connection",
                    entity_id=str(conn.id),
                    metadata={
                        "name": conn.name,
                        "endpoint_url": details.endpoint_url,
                        "provider_hint": details.provider,
                    },
                )
                return self._created("s3_connection", key, conn.id, dry_run=dry_run)

            diff = self._diff_s3_connection(conn, item)
            if not diff:
                return self._skipped("s3_connection", key, dry_run=dry_run)
            if dry_run:
                return self._updated("s3_connection", key, conn.id, diff, dry_run=dry_run)
            conn = self._update_s3_connection(conn, item, current_user)
            audit_service.record_action(
                user=current_user,
                scope="admin",
                action="connection.update",
                entity_type="s3_connection",
                entity_id=str(conn.id),
                metadata=item.spec.model_dump(exclude_none=True, exclude_unset=True) if item.spec else None,
            )
            return self._updated("s3_connection", key, conn.id, diff, dry_run=dry_run)
        except Exception as exc:  # noqa: BLE001
            return self._failed("s3_connection", key, exc, dry_run=dry_run)

    def _apply_account_link(
        self,
        item: AccountLinkApply,
        dry_run: bool,
        current_user: User,
        audit_service: AuditService,
    ) -> AdminAutomationItemResult:
        key = self._account_link_key(item)
        try:
            user = self._resolve_user_ref(item)
            account = self._resolve_account_ref(item)
            link = (
                self.db.query(UserS3Account)
                .filter(UserS3Account.user_id == user.id, UserS3Account.account_id == account.id)
                .first()
            )

            if item.state == "absent":
                if not link:
                    return self._skipped("account_link", key, dry_run=dry_run)
                if link.is_root:
                    raise ValueError("Cannot remove the root account link")
                if dry_run:
                    return self._deleted("account_link", key, link.id, dry_run=dry_run)
                (
                    self.db.query(UserS3Account)
                    .filter(UserS3Account.user_id == user.id, UserS3Account.account_id == account.id)
                    .delete(synchronize_session=False)
                )
                self.db.commit()
                audit_service.record_action(
                    user=current_user,
                    scope="admin",
                    action="unassign_user_account",
                    entity_type="ui_user",
                    entity_id=str(user.id),
                    account_id=account.id,
                    metadata={"assigned_user_id": user.id},
                )
                return self._deleted("account_link", key, link.id, dry_run=dry_run)

            desired_role = item.account_role
            desired_admin = item.account_admin
            portal_enabled = bool(load_app_settings().general.portal_enabled)
            if link:
                if link.is_root and (desired_role is not None or desired_admin is not None):
                    raise ValueError("Cannot modify the root account link")
                if desired_role is None:
                    desired_role = link.account_role
                if desired_admin is None:
                    desired_admin = link.account_admin
            else:
                if desired_role is None:
                    desired_role = self._default_account_role(user, portal_enabled)
                if desired_admin is None:
                    desired_admin = False

            if not portal_enabled and item.account_role is not None and desired_role != AccountRole.PORTAL_NONE.value:
                raise ValueError("Portal feature is disabled")
            if desired_role not in {role.value for role in AccountRole}:
                raise ValueError("Invalid account role")

            if link:
                diff: dict[str, dict[str, Any]] = {}
                if desired_role != link.account_role:
                    diff["account_role"] = {"from": link.account_role, "to": desired_role}
                if bool(desired_admin) != bool(link.account_admin):
                    diff["account_admin"] = {"from": bool(link.account_admin), "to": bool(desired_admin)}
                if not diff:
                    return self._skipped("account_link", key, dry_run=dry_run)
                if dry_run:
                    return self._updated("account_link", key, link.id, diff, dry_run=dry_run)
                self.users.assign_user_to_account(
                    user.id,
                    account.id,
                    account_root=link.is_root,
                    account_role=desired_role,
                    account_admin=desired_admin,
                )
                audit_service.record_action(
                    user=current_user,
                    scope="admin",
                    action="assign_user_account",
                    entity_type="ui_user",
                    entity_id=str(user.id),
                    account_id=account.id,
                    metadata={
                        "account_root": bool(link.is_root),
                        "assigned_user_id": user.id,
                    },
                )
                return self._updated("account_link", key, link.id, diff, dry_run=dry_run)

            if dry_run:
                return self._created("account_link", key, dry_run=dry_run)
            self.users.assign_user_to_account(
                user.id,
                account.id,
                account_root=False,
                account_role=desired_role,
                account_admin=desired_admin,
            )
            audit_service.record_action(
                user=current_user,
                scope="admin",
                action="assign_user_account",
                entity_type="ui_user",
                entity_id=str(user.id),
                account_id=account.id,
                metadata={
                    "account_root": False,
                    "assigned_user_id": user.id,
                },
            )
            return self._created("account_link", key, dry_run=dry_run)
        except Exception as exc:  # noqa: BLE001
            return self._failed("account_link", key, exc, dry_run=dry_run)

    def _diff_storage_endpoint(
        self,
        endpoint: StorageEndpoint,
        item: StorageEndpointApply,
    ) -> dict[str, dict[str, Any]]:
        spec = item.spec
        if not spec:
            return {}
        diff: dict[str, dict[str, Any]] = {}
        fields_set = spec.model_fields_set
        if "name" in fields_set:
            desired = self._normalize_optional_str(spec.name) or endpoint.name
            if desired != endpoint.name:
                diff["name"] = {"from": endpoint.name, "to": desired}
        if "endpoint_url" in fields_set:
            desired = self._normalize_endpoint_url(spec.endpoint_url)
            current = self._normalize_endpoint_url(endpoint.endpoint_url)
            if desired != current:
                diff["endpoint_url"] = {"from": current, "to": desired}
        if "region" in fields_set:
            desired = self._normalize_optional_str(spec.region)
            if desired != self._normalize_optional_str(endpoint.region):
                diff["region"] = {"from": endpoint.region, "to": desired}
        if "provider" in fields_set:
            desired = normalize_storage_provider(spec.provider).value
            if desired != str(endpoint.provider):
                diff["provider"] = {"from": endpoint.provider, "to": desired}
        if "features_config" in fields_set:
            provider = normalize_storage_provider(spec.provider if "provider" in fields_set else endpoint.provider)
            desired_features = dump_features_config(normalize_features_config(provider, spec.features_config))
            current_features = dump_features_config(
                normalize_features_config(provider, endpoint.features_config)
            )
            if desired_features != current_features:
                diff["features_config"] = {"from": current_features, "to": desired_features}
        if item.update_secrets:
            if "admin_access_key" in fields_set:
                desired = self._normalize_optional_str(spec.admin_access_key)
                if desired != self._normalize_optional_str(endpoint.admin_access_key):
                    diff["admin_access_key"] = {
                        "from": self._mask_value(endpoint.admin_access_key),
                        "to": self._mask_value(desired),
                    }
            if "admin_secret_key" in fields_set:
                diff["admin_secret_key"] = {"from": "<redacted>", "to": "<redacted>"}
            if "supervision_access_key" in fields_set:
                desired = self._normalize_optional_str(spec.supervision_access_key)
                if desired != self._normalize_optional_str(endpoint.supervision_access_key):
                    diff["supervision_access_key"] = {
                        "from": self._mask_value(endpoint.supervision_access_key),
                        "to": self._mask_value(desired),
                    }
            if "supervision_secret_key" in fields_set:
                diff["supervision_secret_key"] = {"from": "<redacted>", "to": "<redacted>"}
            if "ceph_admin_access_key" in fields_set:
                desired = self._normalize_optional_str(spec.ceph_admin_access_key)
                if desired != self._normalize_optional_str(endpoint.ceph_admin_access_key):
                    diff["ceph_admin_access_key"] = {
                        "from": self._mask_value(endpoint.ceph_admin_access_key),
                        "to": self._mask_value(desired),
                    }
            if "ceph_admin_secret_key" in fields_set:
                diff["ceph_admin_secret_key"] = {"from": "<redacted>", "to": "<redacted>"}
        return diff

    def _diff_ui_user(self, user: User, item: UiUserApply) -> dict[str, dict[str, Any]]:
        spec = item.spec
        if not spec:
            return {}
        diff: dict[str, dict[str, Any]] = {}
        fields_set = spec.model_fields_set
        if "email" in fields_set and spec.email and spec.email != user.email:
            diff["email"] = {"from": user.email, "to": spec.email}
        if "full_name" in fields_set:
            desired = self._normalize_optional_str(spec.full_name)
            if desired != self._normalize_optional_str(user.full_name):
                diff["full_name"] = {"from": user.full_name, "to": desired}
        if "role" in fields_set and spec.role and spec.role != user.role:
            diff["role"] = {"from": user.role, "to": spec.role}
        if "is_active" in fields_set and spec.is_active is not None:
            if bool(spec.is_active) != bool(user.is_active):
                diff["is_active"] = {"from": bool(user.is_active), "to": bool(spec.is_active)}
        if "is_root" in fields_set and spec.is_root is not None:
            if bool(spec.is_root) != bool(user.is_root):
                diff["is_root"] = {"from": bool(user.is_root), "to": bool(spec.is_root)}
        if item.set_password and spec.password:
            diff["password"] = {"from": "<redacted>", "to": "<redacted>"}
        if "s3_user_ids" in fields_set and spec.s3_user_ids is not None:
            current_ids = self._user_s3_user_ids(user.id)
            desired_ids = sorted({int(x) for x in spec.s3_user_ids})
            if desired_ids != current_ids:
                diff["s3_user_ids"] = {"from": current_ids, "to": desired_ids}
        if "s3_connection_ids" in fields_set and spec.s3_connection_ids is not None:
            current_ids = self._user_s3_connection_ids(user.id)
            desired_ids = sorted({int(x) for x in spec.s3_connection_ids})
            if desired_ids != current_ids:
                diff["s3_connection_ids"] = {"from": current_ids, "to": desired_ids}
        return diff

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
            desired = self._normalize_optional_str(spec.email)
            if desired != self._normalize_optional_str(account.email):
                diff["email"] = {"from": account.email, "to": desired}
        if {"storage_endpoint_id", "storage_endpoint_name", "storage_endpoint_url"} & fields_set:
            endpoint = self._resolve_storage_endpoint(
                spec.storage_endpoint_id,
                spec.storage_endpoint_name,
                spec.storage_endpoint_url,
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
                diff["rgw_access_key"] = {"from": self._mask_value(account.rgw_access_key), "to": self._mask_value(spec.rgw_access_key)}
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
            desired = self._normalize_optional_str(spec.email)
            if desired != self._normalize_optional_str(s3_user.email):
                diff["email"] = {"from": s3_user.email, "to": desired}
        if {"storage_endpoint_id", "storage_endpoint_name", "storage_endpoint_url"} & fields_set:
            endpoint = self._resolve_storage_endpoint(
                spec.storage_endpoint_id,
                spec.storage_endpoint_name,
                spec.storage_endpoint_url,
            )
            desired_id = endpoint.id if endpoint else None
            if s3_user.storage_endpoint_id and desired_id != s3_user.storage_endpoint_id:
                raise ValueError("Storage endpoint cannot be changed for an existing S3 user")
            if desired_id != s3_user.storage_endpoint_id:
                diff["storage_endpoint_id"] = {"from": s3_user.storage_endpoint_id, "to": desired_id}
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
                diff["rgw_access_key"] = {"from": self._mask_value(s3_user.rgw_access_key), "to": self._mask_value(spec.rgw_access_key)}
        if "rgw_secret_key" in fields_set and spec.rgw_secret_key is not None:
            diff["rgw_secret_key"] = {"from": "<redacted>", "to": "<redacted>"}
        if "user_ids" in fields_set and spec.user_ids is not None:
            current_ids = self._s3_user_linked_ids(s3_user.id)
            desired_ids = sorted({int(x) for x in spec.user_ids})
            if desired_ids != current_ids:
                diff["user_ids"] = {"from": current_ids, "to": desired_ids}
        return diff

    def _diff_s3_connection(self, conn: S3Connection, item: S3ConnectionApply) -> dict[str, dict[str, Any]]:
        spec = item.spec
        if not spec:
            return {}
        diff: dict[str, dict[str, Any]] = {}
        fields_set = spec.model_fields_set
        if "name" in fields_set and spec.name and spec.name != conn.name:
            diff["name"] = {"from": conn.name, "to": spec.name}
        if "is_public" in fields_set and spec.is_public is not None:
            if bool(spec.is_public) != bool(conn.is_public):
                diff["is_public"] = {"from": bool(conn.is_public), "to": bool(spec.is_public)}
        if "storage_endpoint_id" in fields_set:
            desired = spec.storage_endpoint_id
            if desired != conn.storage_endpoint_id:
                diff["storage_endpoint_id"] = {"from": conn.storage_endpoint_id, "to": desired}
        if {"endpoint_url", "region", "force_path_style", "verify_tls", "provider_hint"} & fields_set:
            details = resolve_connection_details(conn)
            if "endpoint_url" in fields_set and spec.endpoint_url is not None:
                desired = spec.endpoint_url.rstrip("/")
                current = (details.endpoint_url or "").rstrip("/")
                if desired != current:
                    diff["endpoint_url"] = {"from": details.endpoint_url, "to": desired}
            if "region" in fields_set and spec.region is not None and spec.region != details.region:
                diff["region"] = {"from": details.region, "to": spec.region}
            if "force_path_style" in fields_set and spec.force_path_style is not None:
                if bool(spec.force_path_style) != bool(details.force_path_style):
                    diff["force_path_style"] = {"from": bool(details.force_path_style), "to": bool(spec.force_path_style)}
            if "verify_tls" in fields_set and spec.verify_tls is not None:
                if bool(spec.verify_tls) != bool(details.verify_tls):
                    diff["verify_tls"] = {"from": bool(details.verify_tls), "to": bool(spec.verify_tls)}
            if "provider_hint" in fields_set and spec.provider_hint is not None and spec.provider_hint != details.provider:
                diff["provider_hint"] = {"from": details.provider, "to": spec.provider_hint}
        if item.update_credentials:
            if "access_key_id" in fields_set and spec.access_key_id is not None and spec.access_key_id != conn.access_key_id:
                diff["access_key_id"] = {
                    "from": self._mask_value(conn.access_key_id),
                    "to": self._mask_value(spec.access_key_id),
                }
            if "secret_access_key" in fields_set and spec.secret_access_key is not None and spec.secret_access_key != conn.secret_access_key:
                diff["secret_access_key"] = {"from": "<redacted>", "to": "<redacted>"}
        return diff

    def _build_storage_endpoint_create(self, item: StorageEndpointApply, spec) -> StorageEndpointCreate:
        name = self._normalize_optional_str(spec.name or item.match.name) or "Endpoint"
        endpoint_url = self._normalize_endpoint_url(spec.endpoint_url or item.match.endpoint_url)
        if not endpoint_url:
            raise ValueError("storage_endpoints.spec.endpoint_url is required to create a new endpoint")
        return StorageEndpointCreate(
            name=name,
            endpoint_url=endpoint_url,
            region=self._normalize_optional_str(spec.region),
            provider=spec.provider or StorageProvider.CEPH,
            admin_access_key=spec.admin_access_key,
            admin_secret_key=spec.admin_secret_key,
            supervision_access_key=spec.supervision_access_key,
            supervision_secret_key=spec.supervision_secret_key,
            ceph_admin_access_key=spec.ceph_admin_access_key,
            ceph_admin_secret_key=spec.ceph_admin_secret_key,
            features_config=spec.features_config,
        )

    def _build_storage_endpoint_update(self, item: StorageEndpointApply, spec) -> StorageEndpointUpdate:
        if not spec:
            return StorageEndpointUpdate()
        payload = spec.model_dump(exclude_unset=True)
        if not item.update_secrets:
            payload.pop("admin_access_key", None)
            payload.pop("admin_secret_key", None)
            payload.pop("supervision_access_key", None)
            payload.pop("supervision_secret_key", None)
            payload.pop("ceph_admin_access_key", None)
            payload.pop("ceph_admin_secret_key", None)
        payload.pop("set_default", None)
        return StorageEndpointUpdate(**payload)

    def _build_ui_user_update(self, item: UiUserApply) -> UserUpdate:
        spec = item.spec
        if not spec:
            return UserUpdate()
        payload = spec.model_dump(exclude_unset=True)
        if not item.set_password:
            payload.pop("password", None)
        return UserUpdate(**payload)

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
        endpoint = self._resolve_storage_endpoint(
            spec.storage_endpoint_id,
            spec.storage_endpoint_name,
            spec.storage_endpoint_url,
        )
        if endpoint:
            payload["storage_endpoint_id"] = endpoint.id
        return S3AccountUpdate(**payload)

    def _build_s3_user_update(self, item: S3UserApply, s3_user: S3User) -> S3UserUpdate:
        spec = item.spec
        if not spec:
            return S3UserUpdate()
        payload = spec.model_dump(exclude_unset=True)
        payload.pop("rgw_access_key", None)
        payload.pop("rgw_secret_key", None)
        payload.pop("storage_endpoint_name", None)
        payload.pop("storage_endpoint_url", None)
        endpoint = self._resolve_storage_endpoint(
            spec.storage_endpoint_id,
            spec.storage_endpoint_name,
            spec.storage_endpoint_url,
        )
        if endpoint and s3_user.storage_endpoint_id is None:
            payload["storage_endpoint_id"] = endpoint.id
        elif "storage_endpoint_id" in payload:
            payload.pop("storage_endpoint_id", None)
        return S3UserUpdate(**payload)

    def _resolve_storage_endpoint(
        self,
        endpoint_id: Optional[int],
        endpoint_name: Optional[str],
        endpoint_url: Optional[str],
    ) -> Optional[StorageEndpoint]:
        if endpoint_id is not None:
            endpoint = self.db.query(StorageEndpoint).filter(StorageEndpoint.id == endpoint_id).first()
            if not endpoint:
                raise ValueError("Storage endpoint not found")
            return endpoint
        if endpoint_name:
            endpoint = self.db.query(StorageEndpoint).filter(StorageEndpoint.name == endpoint_name).first()
            if not endpoint:
                raise ValueError("Storage endpoint not found")
            return endpoint
        if endpoint_url:
            normalized = self._normalize_endpoint_url(endpoint_url)
            endpoint = (
                self.db.query(StorageEndpoint)
                .filter(StorageEndpoint.endpoint_url == normalized)
                .first()
            )
            if not endpoint:
                raise ValueError("Storage endpoint not found")
            return endpoint
        return None

    def _require_ceph_endpoint(self, endpoint: StorageEndpoint) -> None:
        provider = normalize_storage_provider(endpoint.provider)
        if provider != StorageProvider.CEPH:
            raise ValueError("This endpoint is not a Ceph endpoint")

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
        endpoint = self._resolve_storage_endpoint(
            spec.storage_endpoint_id,
            spec.storage_endpoint_name,
            spec.storage_endpoint_url,
        )
        if not endpoint:
            raise ValueError("storage_endpoint_id/name/url is required for register action")
        self._require_ceph_endpoint(endpoint)
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
        endpoint = self._resolve_storage_endpoint(
            spec.storage_endpoint_id,
            spec.storage_endpoint_name,
            spec.storage_endpoint_url,
        )
        if not endpoint:
            raise ValueError("storage_endpoint_id/name/url is required for register action")
        self._require_ceph_endpoint(endpoint)
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

    def _create_s3_connection(self, spec, current_user: User) -> S3Connection:
        storage_endpoint_id = spec.storage_endpoint_id
        endpoint_url = (spec.endpoint_url or "").strip()
        if storage_endpoint_id is not None:
            storage_endpoint = (
                self.db.query(StorageEndpoint)
                .filter(StorageEndpoint.id == storage_endpoint_id)
                .first()
            )
            if not storage_endpoint:
                raise ValueError("Storage endpoint not found")
            custom_endpoint_config = None
        else:
            if not endpoint_url:
                raise ValueError("Endpoint URL is required for manual connections")
            endpoint_url = endpoint_url.rstrip("/")
            custom_endpoint_config = build_custom_endpoint_config(
                endpoint_url,
                spec.region,
                bool(spec.force_path_style or False),
                bool(spec.verify_tls if spec.verify_tls is not None else True),
                spec.provider_hint,
            )
        is_public = bool(spec.is_public) if spec.is_public is not None else False
        owner_user_id = None if is_public else current_user.id
        conn = S3Connection(
            owner_user_id=owner_user_id,
            name=spec.name,
            storage_endpoint_id=storage_endpoint_id,
            custom_endpoint_config=custom_endpoint_config,
            is_public=is_public,
            access_key_id=spec.access_key_id,
            secret_access_key=spec.secret_access_key,
        )
        self.db.add(conn)
        self.db.commit()
        self.db.refresh(conn)
        return conn

    def _update_s3_connection(self, conn: S3Connection, item: S3ConnectionApply, current_user: User) -> S3Connection:
        spec = item.spec
        if not spec:
            return conn
        payload_data = spec.model_dump(exclude_unset=True)
        if "name" in payload_data and spec.name is not None:
            conn.name = spec.name
        if "is_public" in payload_data and spec.is_public is not None:
            if spec.is_public:
                conn.is_public = True
                conn.owner_user_id = None
            else:
                conn.is_public = False
                if conn.owner_user_id is None:
                    conn.owner_user_id = current_user.id
        if "storage_endpoint_id" in payload_data:
            if spec.storage_endpoint_id is not None:
                storage_endpoint = (
                    self.db.query(StorageEndpoint)
                    .filter(StorageEndpoint.id == spec.storage_endpoint_id)
                    .first()
                )
                if not storage_endpoint:
                    raise ValueError("Storage endpoint not found")
                conn.storage_endpoint_id = storage_endpoint.id
                conn.custom_endpoint_config = None
            else:
                conn.storage_endpoint_id = None
        if conn.storage_endpoint_id is None:
            current = parse_custom_endpoint_config(conn.custom_endpoint_config)
            endpoint_url = current.get("endpoint_url")
            region = current.get("region")
            force_path_style = bool(current.get("force_path_style", False))
            verify_tls = bool(current.get("verify_tls", True))
            provider = current.get("provider") or current.get("provider_hint")
            if "endpoint_url" in payload_data and spec.endpoint_url is not None:
                endpoint_url = spec.endpoint_url.rstrip("/")
            if "region" in payload_data and spec.region is not None:
                region = spec.region
            if "force_path_style" in payload_data and spec.force_path_style is not None:
                force_path_style = bool(spec.force_path_style)
            if "verify_tls" in payload_data and spec.verify_tls is not None:
                verify_tls = bool(spec.verify_tls)
            if "provider_hint" in payload_data and spec.provider_hint is not None:
                provider = spec.provider_hint
            if not endpoint_url:
                raise ValueError("Endpoint URL is required for manual connections")
            conn.custom_endpoint_config = build_custom_endpoint_config(
                endpoint_url,
                region,
                force_path_style,
                verify_tls,
                provider,
            )
        if item.update_credentials:
            if "access_key_id" in payload_data and spec.access_key_id is not None:
                conn.access_key_id = spec.access_key_id
            if "secret_access_key" in payload_data and spec.secret_access_key is not None:
                conn.secret_access_key = spec.secret_access_key
        self.db.add(conn)
        self.db.commit()
        self.db.refresh(conn)
        return conn

    def _find_storage_endpoint(self, item: StorageEndpointApply) -> Optional[StorageEndpoint]:
        match = item.match
        if match.id is not None:
            return self.db.query(StorageEndpoint).filter(StorageEndpoint.id == match.id).first()
        if match.endpoint_url:
            normalized = self._normalize_endpoint_url(match.endpoint_url)
            return self.db.query(StorageEndpoint).filter(StorageEndpoint.endpoint_url == normalized).first()
        if match.name:
            return self.db.query(StorageEndpoint).filter(StorageEndpoint.name == match.name).first()
        return None

    def _find_ui_user(self, item: UiUserApply) -> Optional[User]:
        match = item.match
        if match.id is not None:
            return self.db.query(User).filter(User.id == match.id).first()
        if match.email:
            return self.db.query(User).filter(User.email == match.email).first()
        return None

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

    def _find_s3_connection(self, item: S3ConnectionApply, current_user: User) -> Optional[S3Connection]:
        match = item.match
        if match.id is not None:
            return self.db.query(S3Connection).filter(S3Connection.id == match.id).first()
        if match.name:
            desired_public = bool(item.spec.is_public) if item.spec and item.spec.is_public is not None else False
            if desired_public:
                return (
                    self.db.query(S3Connection)
                    .filter(S3Connection.name == match.name, S3Connection.is_public.is_(True))
                    .first()
                )
            return (
                self.db.query(S3Connection)
                .filter(
                    S3Connection.name == match.name,
                    S3Connection.is_public.is_(False),
                    S3Connection.owner_user_id == current_user.id,
                )
                .first()
            )
        return None

    def _resolve_user_ref(self, item: AccountLinkApply) -> User:
        ref = item.user
        user = None
        if ref.id is not None:
            user = self.db.query(User).filter(User.id == ref.id).first()
        elif ref.email:
            user = self.db.query(User).filter(User.email == ref.email).first()
        if not user:
            raise ValueError("UI user not found")
        return user

    def _resolve_account_ref(self, item: AccountLinkApply) -> S3Account:
        ref = item.account
        account = None
        if ref.id is not None:
            account = self.db.query(S3Account).filter(S3Account.id == ref.id).first()
        elif ref.rgw_account_id:
            account = self.db.query(S3Account).filter(S3Account.rgw_account_id == ref.rgw_account_id).first()
        elif ref.name:
            account = self.db.query(S3Account).filter(S3Account.name == ref.name).first()
        if not account:
            raise ValueError("S3Account not found")
        return account

    def _default_account_role(self, user: User, portal_enabled: bool) -> str:
        if not portal_enabled:
            return AccountRole.PORTAL_NONE.value
        if is_admin_ui_role(user.role):
            return AccountRole.PORTAL_MANAGER.value
        if user.role == UserRole.UI_NONE.value:
            return AccountRole.PORTAL_USER.value
        return AccountRole.PORTAL_USER.value

    @staticmethod
    def _normalize_ui_role(value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        normalized = value.strip().lower()
        if normalized in {"ui_superadmin", "super_admin", "superadmin"}:
            return UserRole.UI_SUPERADMIN.value
        if normalized in {"ui_admin", "admin"}:
            return UserRole.UI_ADMIN.value
        if normalized in {"ui_user", "user"}:
            return UserRole.UI_USER.value
        if normalized in {"ui_none", "none"}:
            return UserRole.UI_NONE.value
        return value

    def _delete_s3_user_db_only(self, s3_user: S3User) -> None:
        (
            self.db.query(UserS3User)
            .filter(UserS3User.s3_user_id == s3_user.id)
            .delete(synchronize_session=False)
        )
        self.db.delete(s3_user)
        self.db.commit()

    def _user_s3_user_ids(self, user_id: int) -> list[int]:
        rows = (
            self.db.query(UserS3User.s3_user_id)
            .filter(UserS3User.user_id == user_id)
            .all()
        )
        return sorted([row[0] for row in rows])

    def _user_s3_connection_ids(self, user_id: int) -> list[int]:
        rows = (
            self.db.query(UserS3Connection.s3_connection_id)
            .filter(UserS3Connection.user_id == user_id)
            .all()
        )
        return sorted([row[0] for row in rows])

    def _s3_user_linked_ids(self, s3_user_id: int) -> list[int]:
        rows = (
            self.db.query(UserS3User.user_id)
            .filter(UserS3User.s3_user_id == s3_user_id)
            .all()
        )
        return sorted([row[0] for row in rows])

    def _storage_endpoint_key(self, item: StorageEndpointApply) -> str:
        if item.match.endpoint_url:
            return f"endpoint_url={item.match.endpoint_url}"
        if item.match.name:
            return f"name={item.match.name}"
        return f"id={item.match.id}"

    def _ui_user_key(self, item: UiUserApply) -> str:
        if item.match.email:
            return f"email={item.match.email}"
        return f"id={item.match.id}"

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

    def _account_link_key(self, item: AccountLinkApply) -> str:
        user_label = item.user.email or str(item.user.id)
        account_label = item.account.name or item.account.rgw_account_id or str(item.account.id)
        return f"user={user_label},account={account_label}"

    def _s3_connection_key(self, item: S3ConnectionApply) -> str:
        if item.match.name:
            return f"name={item.match.name}"
        return f"id={item.match.id}"

    @staticmethod
    def _normalize_optional_str(value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        trimmed = value.strip()
        return trimmed or None

    @staticmethod
    def _normalize_endpoint_url(value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        trimmed = value.strip().rstrip("/")
        return trimmed or None

    @staticmethod
    def _mask_value(value: Optional[str]) -> str:
        if not value:
            return ""
        trimmed = value.strip()
        if len(trimmed) <= 8:
            return "***" + trimmed[-2:]
        return f"{trimmed[:4]}***{trimmed[-4:]}"

    @staticmethod
    def _created(resource: str, key: str, entity_id: Optional[int] = None, *, dry_run: bool) -> AdminAutomationItemResult:
        return AdminAutomationItemResult(
            resource=resource,
            key=key,
            action="created",
            changed=True,
            id=str(entity_id) if entity_id is not None else None,
            dry_run=dry_run,
        )

    @staticmethod
    def _updated(
        resource: str,
        key: str,
        entity_id: Optional[int] = None,
        diff: Optional[dict[str, dict[str, Any]]] = None,
        *,
        dry_run: bool,
    ) -> AdminAutomationItemResult:
        return AdminAutomationItemResult(
            resource=resource,
            key=key,
            action="updated",
            changed=True,
            id=str(entity_id) if entity_id is not None else None,
            diff=diff,
            dry_run=dry_run,
        )

    @staticmethod
    def _deleted(resource: str, key: str, entity_id: Optional[int] = None, *, dry_run: bool) -> AdminAutomationItemResult:
        return AdminAutomationItemResult(
            resource=resource,
            key=key,
            action="deleted",
            changed=True,
            id=str(entity_id) if entity_id is not None else None,
            dry_run=dry_run,
        )

    @staticmethod
    def _skipped(resource: str, key: str, *, dry_run: bool) -> AdminAutomationItemResult:
        return AdminAutomationItemResult(
            resource=resource,
            key=key,
            action="skipped",
            changed=False,
            dry_run=dry_run,
        )

    @staticmethod
    def _failed(resource: str, key: str, exc: Exception, *, dry_run: bool) -> AdminAutomationItemResult:
        return AdminAutomationItemResult(
            resource=resource,
            key=key,
            action="failed",
            changed=False,
            error=str(exc),
            dry_run=dry_run,
        )


def get_admin_automation_service(db: Session) -> AdminAutomationService:
    return AdminAutomationService(db)
