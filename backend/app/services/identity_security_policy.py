# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from fastapi import HTTPException, Request, status
from sqlalchemy.orm import Session

from app.db import User, UserRole, is_admin_ui_role, is_superadmin_ui_role
from app.routers.auth_session_guards import require_recent_mfa, require_recent_primary_auth
from app.services.app_settings_service import load_app_settings_for_db
from app.services.webauthn_service import WebAuthnService


STANDARD_UI_ROLES = {UserRole.UI_USER.value, UserRole.UI_NONE.value}
PRIVILEGED_UI_ROLES = {UserRole.UI_ADMIN.value, UserRole.UI_SUPERADMIN.value}


def passkey_required_for_role(db: Session, role: str) -> bool:
    general = load_app_settings_for_db(db).general
    if role in PRIVILEGED_UI_ROLES:
        return bool(general.require_passkey_for_admins)
    if role in STANDARD_UI_ROLES:
        return bool(general.require_passkey_for_users)
    return False


def require_admin_sensitive_action(
    request: Request,
    db: Session,
    actor: User,
) -> None:
    """Require WebAuthn for admin operations only when the global policy does."""
    if not is_admin_ui_role(actor.role):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")
    if load_app_settings_for_db(db).general.require_passkey_for_admins:
        require_recent_mfa(request, db)


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
