# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from fastapi import HTTPException, Request, status
from sqlalchemy.orm import Session

from app.db import AuthSession, User, UserRole, is_admin_ui_role, is_superadmin_ui_role
from app.models.user import ManagerToolAccess, UserUpdate
from app.routers.auth_session_guards import current_auth_session, require_recent_mfa, require_recent_primary_auth
from app.services.app_settings_service import load_app_settings_for_db
from app.services.webauthn_service import WebAuthnService


STANDARD_UI_ROLES = {UserRole.UI_USER.value, UserRole.UI_NONE.value}
PRIVILEGED_UI_ROLES = {UserRole.UI_ADMIN.value, UserRole.UI_SUPERADMIN.value}
_MANAGER_TOOL_COLUMNS = {
    "bucket_compare": "can_access_manager_bucket_compare",
    "bucket_integrity_check": "can_access_manager_bucket_integrity_check",
    "bucket_migration": "can_access_manager_bucket_migration",
    "feature_rules": "can_access_manager_feature_rules",
    "bucket_purge": "can_access_manager_bucket_purge",
}
_DIRECT_ACCESS_FIELDS = (
    "can_access_ceph_admin",
    "can_access_storage_ops",
    "can_create_manual_private_connections",
    "can_provision_managed_private_connections",
    "browser_advanced_features_enabled",
)


def passkey_required_for_role(db: Session, role: str) -> bool:
    general = load_app_settings_for_db(db).general
    if role in PRIVILEGED_UI_ROLES:
        return bool(general.require_passkey_for_admins)
    if role in STANDARD_UI_ROLES:
        return bool(general.require_passkey_for_users)
    return False


def require_admin_interactive_session(
    request: Request,
    db: Session,
    actor: User,
) -> AuthSession:
    """Require an authorized administrator using a browser-backed UI session."""
    if not is_admin_ui_role(actor.role):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")
    return current_auth_session(request, db)


def require_admin_sensitive_action(
    request: Request,
    db: Session,
    actor: User,
) -> None:
    """Require an interactive admin session and, when enabled, recent WebAuthn."""
    session = require_admin_interactive_session(request, db, actor)
    if load_app_settings_for_db(db).general.require_passkey_for_admins:
        if not WebAuthnService(db).is_recent(session):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Recent WebAuthn verification required",
            )


def _manager_tool_access_changed(user: User, requested: ManagerToolAccess) -> bool:
    return any(
        bool(getattr(user, column)) != bool(getattr(requested, field))
        for field, column in _MANAGER_TOOL_COLUMNS.items()
    )


def _account_links_changed(user: User, payload: UserUpdate) -> bool:
    if payload.account_links is None:
        return False
    if payload.account_links and user.role == UserRole.UI_NONE.value:
        # The association service promotes ui_none to ui_user when account
        # access is persisted, even when the submitted links are unchanged.
        return True
    persisted = {
        (
            int(link.account_id),
            link.manager_role,
            link.portal_role,
            bool(link.allow_manager_browser_data_access),
        )
        for link in user.account_links
    }
    requested = {
        (
            int(link.account_id),
            link.manager_role,
            link.portal_role,
            bool(link.allow_manager_browser_data_access),
        )
        for link in payload.account_links
    }
    return persisted != requested


def _s3_user_links_changed(user: User, payload: UserUpdate) -> bool:
    if payload.s3_user_links is None:
        return False
    persisted = {
        (int(link.s3_user_id), bool(link.allow_manager_browser_data_access))
        for link in user.s3_user_links
    }
    requested = {
        (int(link.s3_user_id), bool(link.allow_manager_browser_data_access))
        for link in payload.s3_user_links
    }
    return persisted != requested


def admin_user_update_requires_step_up(user: User, payload: UserUpdate) -> bool:
    """Return whether an update would change persisted identity or access state."""
    if payload.password:
        return True
    if payload.email is not None and str(payload.email).strip() != str(user.email).strip():
        return True
    if payload.role is not None and payload.role != user.role:
        return True
    if payload.is_active is not None and bool(payload.is_active) != bool(user.is_active):
        return True
    for field in _DIRECT_ACCESS_FIELDS:
        requested = getattr(payload, field)
        if requested is not None and bool(requested) != bool(getattr(user, field)):
            return True
    if payload.manager_tool_access is not None and _manager_tool_access_changed(
        user,
        payload.manager_tool_access,
    ):
        return True
    if _account_links_changed(user, payload) or _s3_user_links_changed(user, payload):
        return True
    if payload.s3_connection_ids is not None:
        persisted_connection_ids = {int(link.s3_connection_id) for link in user.s3_connection_links}
        requested_connection_ids = {int(connection_id) for connection_id in payload.s3_connection_ids}
        if persisted_connection_ids != requested_connection_ids:
            return True
    if payload.group_ids is not None:
        persisted_group_ids = {int(link.group_id) for link in user.ui_group_links}
        requested_group_ids = {int(group_id) for group_id in payload.group_ids}
        if persisted_group_ids != requested_group_ids:
            return True
    return False


def require_self_service_security_action(
    request: Request,
    db: Session,
    user: User,
) -> None:
    """Use WebAuthn when enrolled/required, otherwise recent primary auth."""
    service = WebAuthnService(db)
    if service.has_credentials(user.id) or passkey_required_for_role(db, user.role):
        require_recent_mfa(request, db)
    else:
        require_recent_primary_auth(request, db)


def ensure_actor_can_manage_user(actor: User, target: User, *, allow_self: bool = False) -> None:
    if actor.id == target.id and not allow_self:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot perform this administrative action on your own account",
        )
    if is_superadmin_ui_role(actor.role):
        return
    if target.role not in STANDARD_UI_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Administrators can manage only standard users",
        )


def ensure_actor_can_assign_role(actor: User, role: str) -> None:
    if not is_superadmin_ui_role(actor.role) and role not in STANDARD_UI_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Administrators can assign only standard user roles",
        )
