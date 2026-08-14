# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Any, Optional

from sqlalchemy.orm import Session

from app.db import (
    User,
    UserRole,
    UserS3Connection,
    UserS3User,
    is_superadmin_ui_role,
)
from app.models.admin_automation import AdminAutomationItemResult, UiUserApply
from app.models.user import UserCreate, UserUpdate
from app.services.admin_automation_results import AdminAutomationResultFactory
from app.services.audit_service import AuditService
from app.services.users_service import UsersService
from app.utils.normalize import normalize_optional_string


class AdminAutomationUiUserHandler(AdminAutomationResultFactory):
    def __init__(self, db: Session, users: UsersService) -> None:
        self.db = db
        self.users = users

    def apply(
        self,
        item: UiUserApply,
        dry_run: bool,
        current_user: User,
        audit_service: AuditService,
    ) -> AdminAutomationItemResult:
        key = self._key(item)
        try:
            user = self._find(item)
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
                self._ensure_role_assignment_allowed(spec.role, current_user)
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
                        can_create_manual_private_connections=bool(
                            spec.can_create_manual_private_connections
                        ),
                        can_provision_managed_private_connections=bool(
                            spec.can_provision_managed_private_connections
                        ),
                        manager_tool_access=spec.manager_tool_access,
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

            diff = self._diff(user, item)
            if not diff:
                return self._skipped("ui_user", key, dry_run=dry_run)
            if dry_run:
                return self._updated("ui_user", key, user.id, diff, dry_run=dry_run)

            if item.spec:
                self._ensure_role_assignment_allowed(item.spec.role, current_user)
            update_payload = self._build_update(item)
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

    def _diff(
        self,
        user: User,
        item: UiUserApply,
    ) -> dict[str, dict[str, Any]]:
        spec = item.spec
        if not spec:
            return {}
        diff: dict[str, dict[str, Any]] = {}
        fields_set = spec.model_fields_set
        if "email" in fields_set and spec.email and spec.email != user.email:
            diff["email"] = {"from": user.email, "to": spec.email}
        if "full_name" in fields_set:
            desired = normalize_optional_string(spec.full_name)
            if desired != normalize_optional_string(user.full_name):
                diff["full_name"] = {"from": user.full_name, "to": desired}
        if "role" in fields_set and spec.role and spec.role != user.role:
            diff["role"] = {"from": user.role, "to": spec.role}
        if "is_active" in fields_set and spec.is_active is not None:
            if bool(spec.is_active) != bool(user.is_active):
                diff["is_active"] = {
                    "from": bool(user.is_active),
                    "to": bool(spec.is_active),
                }
        if "is_root" in fields_set and spec.is_root is not None:
            if bool(spec.is_root) != bool(user.is_root):
                diff["is_root"] = {
                    "from": bool(user.is_root),
                    "to": bool(spec.is_root),
                }
        if (
            "can_create_manual_private_connections" in fields_set
            and spec.can_create_manual_private_connections is not None
            and bool(spec.can_create_manual_private_connections)
            != bool(user.can_create_manual_private_connections)
        ):
            diff["can_create_manual_private_connections"] = {
                "from": bool(user.can_create_manual_private_connections),
                "to": bool(spec.can_create_manual_private_connections),
            }
        if (
            "can_provision_managed_private_connections" in fields_set
            and spec.can_provision_managed_private_connections is not None
            and bool(spec.can_provision_managed_private_connections)
            != bool(user.can_provision_managed_private_connections)
        ):
            diff["can_provision_managed_private_connections"] = {
                "from": bool(user.can_provision_managed_private_connections),
                "to": bool(spec.can_provision_managed_private_connections),
            }
        if "manager_tool_access" in fields_set and spec.manager_tool_access is not None:
            current_access = {
                "bucket_compare": bool(user.can_access_manager_bucket_compare),
                "bucket_integrity_check": bool(
                    user.can_access_manager_bucket_integrity_check
                ),
                "bucket_migration": bool(user.can_access_manager_bucket_migration),
                "feature_rules": bool(user.can_access_manager_feature_rules),
                "bucket_purge": bool(user.can_access_manager_bucket_purge),
            }
            desired_access = spec.manager_tool_access.model_dump()
            if desired_access != current_access:
                diff["manager_tool_access"] = {
                    "from": current_access,
                    "to": desired_access,
                }
        if item.set_password and spec.password:
            diff["password"] = {"from": "<redacted>", "to": "<redacted>"}
        if "s3_user_ids" in fields_set and spec.s3_user_ids is not None:
            current_ids = self._user_s3_user_ids(user.id)
            desired_ids = sorted({int(value) for value in spec.s3_user_ids})
            if desired_ids != current_ids:
                diff["s3_user_ids"] = {"from": current_ids, "to": desired_ids}
        if "s3_connection_ids" in fields_set and spec.s3_connection_ids is not None:
            current_ids = self._user_s3_connection_ids(user.id)
            desired_ids = sorted({int(value) for value in spec.s3_connection_ids})
            if desired_ids != current_ids:
                diff["s3_connection_ids"] = {
                    "from": current_ids,
                    "to": desired_ids,
                }
        return diff

    @staticmethod
    def _ensure_role_assignment_allowed(role: Optional[str], current_user: User) -> None:
        if role == UserRole.UI_SUPERADMIN.value and not is_superadmin_ui_role(
            current_user.role
        ):
            raise ValueError("Only superadmin users can promote superadmins")

    @staticmethod
    def _build_update(item: UiUserApply) -> UserUpdate:
        spec = item.spec
        if not spec:
            return UserUpdate()
        payload = spec.model_dump(exclude_unset=True)
        if not item.set_password:
            payload.pop("password", None)
        s3_user_ids = payload.pop("s3_user_ids", None)
        if s3_user_ids is not None:
            payload["s3_user_links"] = [
                {"s3_user_id": int(s3_user_id)}
                for s3_user_id in sorted(set(s3_user_ids))
            ]
        if payload.get("s3_connection_ids") is not None:
            payload["s3_connection_ids"] = sorted(set(payload["s3_connection_ids"]))
        return UserUpdate(**payload)

    def _find(self, item: UiUserApply) -> Optional[User]:
        match = item.match
        if match.id is not None:
            return self.db.query(User).filter(User.id == match.id).first()
        if match.email:
            return self.db.query(User).filter(User.email == match.email).first()
        return None

    def _user_s3_user_ids(self, user_id: int) -> list[int]:
        rows = (
            self.db.query(UserS3User.s3_user_id)
            .filter(UserS3User.user_id == user_id)
            .all()
        )
        return sorted(row[0] for row in rows)

    def _user_s3_connection_ids(self, user_id: int) -> list[int]:
        rows = (
            self.db.query(UserS3Connection.s3_connection_id)
            .filter(UserS3Connection.user_id == user_id)
            .all()
        )
        return sorted(row[0] for row in rows)

    @staticmethod
    def _key(item: UiUserApply) -> str:
        if item.match.email:
            return f"email={item.match.email}"
        return f"id={item.match.id}"
