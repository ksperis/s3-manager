# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.sensitive_data import sanitize_error_detail
from app.db import AuthSession, User, WebAuthnCredential, is_superadmin_ui_role
from app.models.auth import LinkDecisionRequest, SessionInfo
from app.models.identity_security import (
    AdminExternalIdentityInfo,
    AdminExternalIdentityRequest,
    AdminMfaResetResponse,
    AdminPasskeyInfo,
    AdminSessionInfo,
    AdminSetPasswordRequest,
    AdminUserSecurity,
    ExternalIdentityLinkRequestInfo,
)
from app.models.user import UserUpdate, validate_password_policy
from app.routers.dependencies import (
    get_audit_service,
    get_current_super_admin,
    get_users_service_dependency,
)
from app.services.audit_service import AuditService
from app.services.auth_session_service import AuthSessionService
from app.services.external_identity_user_service import ExternalIdentityUserService
from app.services.identity_security_policy import (
    STANDARD_UI_ROLES,
    ensure_actor_can_manage_user,
    passkey_required_for_role,
    require_admin_sensitive_action,
)
from app.services.mfa_reset_service import MfaResetService
from app.services.users_service import UsersService


router = APIRouter(prefix="/admin", tags=["admin-identity-security"])


def _session_info(row: AuthSession) -> SessionInfo:
    return SessionInfo(
        id=row.id,
        principal_type=row.principal_type,
        auth_type=row.auth_type,
        created_at=row.created_at,
        last_activity_at=row.last_activity_at,
        idle_expires_at=row.idle_expires_at,
        absolute_expires_at=row.absolute_expires_at,
        mfa_verified_at=row.mfa_verified_at,
        ip_address=row.ip_address,
        user_agent=row.user_agent,
        revoked_at=row.revoked_at,
        revoke_reason=row.revoke_reason,
        user_id=row.user_id,
        s3_session_id=row.s3_session_id,
    )


def _target_user(db: Session, actor: User, user_id: int, *, allow_self: bool = True) -> User:
    target = db.query(User).filter(User.id == user_id).first()
    if target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    ensure_actor_can_manage_user(actor, target, allow_self=allow_self)
    return target


def _identity_info(row) -> AdminExternalIdentityInfo:
    return AdminExternalIdentityInfo(
        id=row.id,
        provider_type=row.provider_type,
        provider_id=row.provider_id,
        subject=row.subject,
        email=row.email,
        email_verified=bool(row.email_verified),
        link_source=row.link_source,
        created_at=row.created_at,
        last_login_at=row.last_login_at,
        revoked_at=row.revoked_at,
    )


@router.get("/users/{user_id}/security", response_model=AdminUserSecurity)
def get_user_security(
    request: Request,
    user_id: int,
    include_revoked: bool = Query(True),
    db: Session = Depends(get_db),
    actor: User = Depends(get_current_super_admin),
) -> AdminUserSecurity:
    require_admin_sensitive_action(request, db, actor)
    target = _target_user(db, actor, user_id)
    passkeys = db.query(WebAuthnCredential).filter(WebAuthnCredential.user_id == target.id)
    if not include_revoked:
        passkeys = passkeys.filter(WebAuthnCredential.revoked_at.is_(None))
    identities = ExternalIdentityUserService(db).list_for_user(target.id, include_revoked=include_revoked)
    sessions = AuthSessionService(db).list_for_user(target.id)
    return AdminUserSecurity(
        user_id=target.id,
        email=target.email,
        role=target.role,
        has_local_password=bool(target.hashed_password),
        passkey_required=passkey_required_for_role(db, target.role),
        passkeys=[
            AdminPasskeyInfo(
                id=row.id,
                name=row.name,
                created_at=row.created_at,
                last_used_at=row.last_used_at,
                revoked_at=row.revoked_at,
            )
            for row in passkeys.order_by(WebAuthnCredential.created_at.asc()).all()
        ],
        external_identities=[_identity_info(row) for row in identities],
        sessions=[_session_info(row) for row in sessions],
    )


@router.post("/users/{user_id}/mfa/reset", response_model=AdminMfaResetResponse)
def reset_user_mfa(
    request: Request,
    user_id: int,
    db: Session = Depends(get_db),
    actor: User = Depends(get_current_super_admin),
    audit: AuditService = Depends(get_audit_service),
) -> AdminMfaResetResponse:
    require_admin_sensitive_action(request, db, actor)
    target = _target_user(db, actor, user_id, allow_self=False)
    result = MfaResetService(db).reset(target, reason="administrator_mfa_reset")
    enrollment_required = passkey_required_for_role(db, target.role)
    audit.record_action(
        user=actor,
        scope="security",
        action="administrator_reset_user_mfa",
        entity_type="ui_user",
        entity_id=str(target.id),
        metadata={
            "passkey_enrollment_required": enrollment_required,
            "passkeys_removed": result.passkeys_removed,
            "recovery_codes_removed": result.recovery_codes_removed,
            "challenges_removed": result.challenges_removed,
        },
    )
    return AdminMfaResetResponse(
        user_id=target.id,
        passkey_enrollment_required=enrollment_required,
        passkeys_removed=result.passkeys_removed,
        recovery_codes_removed=result.recovery_codes_removed,
        challenges_removed=result.challenges_removed,
    )


@router.put("/users/{user_id}/security/password", status_code=status.HTTP_204_NO_CONTENT)
def set_user_password(
    request: Request,
    user_id: int,
    payload: AdminSetPasswordRequest,
    db: Session = Depends(get_db),
    actor: User = Depends(get_current_super_admin),
    users: UsersService = Depends(get_users_service_dependency),
    audit: AuditService = Depends(get_audit_service),
) -> None:
    require_admin_sensitive_action(request, db, actor)
    target = _target_user(db, actor, user_id, allow_self=False)
    try:
        validate_password_policy(payload.password)
        users.update_user(target.id, UserUpdate(password=payload.password))
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=sanitize_error_detail(str(exc)),
        ) from exc
    audit.record_action(
        user=actor,
        scope="security",
        action="administrator_set_local_password",
        entity_type="ui_user",
        entity_id=str(target.id),
        metadata={"sessions_revoked": True},
    )


@router.post(
    "/users/{user_id}/external-identities",
    response_model=AdminExternalIdentityInfo,
    status_code=status.HTTP_201_CREATED,
)
def add_user_external_identity(
    request: Request,
    user_id: int,
    payload: AdminExternalIdentityRequest,
    db: Session = Depends(get_db),
    actor: User = Depends(get_current_super_admin),
    audit: AuditService = Depends(get_audit_service),
) -> AdminExternalIdentityInfo:
    require_admin_sensitive_action(request, db, actor)
    target = _target_user(db, actor, user_id, allow_self=False)
    try:
        identity, changed = ExternalIdentityUserService(db).provision_identity(
            user=target,
            provider_type=payload.provider_type,
            provider_id=payload.provider_id,
            subject=payload.subject,
            email=str(payload.email) if payload.email else None,
            email_verified=payload.email_verified,
            restore=payload.restore,
            link_source="administrator",
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=sanitize_error_detail(str(exc)),
        ) from exc
    audit.record_action(
        user=actor,
        scope="security",
        action="administrator_external_identity_linked" if changed else "administrator_external_identity_unchanged",
        entity_type="external_identity",
        entity_id=identity.id,
        metadata={"provider_type": identity.provider_type, "provider_id": identity.provider_id},
    )
    return _identity_info(identity)


def _managed_identity(db: Session, actor: User, user_id: int, identity_id: str):
    target = _target_user(db, actor, user_id, allow_self=False)
    identity = next(
        (row for row in ExternalIdentityUserService(db).list_for_user(target.id, include_revoked=True) if row.id == identity_id),
        None,
    )
    if identity is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="External identity not found")
    return target, identity


@router.delete("/users/{user_id}/external-identities/{identity_id}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_user_external_identity(
    request: Request,
    user_id: int,
    identity_id: str,
    db: Session = Depends(get_db),
    actor: User = Depends(get_current_super_admin),
    audit: AuditService = Depends(get_audit_service),
) -> None:
    require_admin_sensitive_action(request, db, actor)
    _, identity = _managed_identity(db, actor, user_id, identity_id)
    try:
        ExternalIdentityUserService(db).revoke_identity(identity.id, reason="administrator_identity_revoked")
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=sanitize_error_detail(str(exc)),
        ) from exc
    audit.record_action(
        user=actor,
        scope="security",
        action="administrator_external_identity_revoked",
        entity_type="external_identity",
        entity_id=identity.id,
        metadata={"provider_type": identity.provider_type, "provider_id": identity.provider_id},
    )


@router.post("/users/{user_id}/external-identities/{identity_id}/restore", response_model=AdminExternalIdentityInfo)
def restore_user_external_identity(
    request: Request,
    user_id: int,
    identity_id: str,
    db: Session = Depends(get_db),
    actor: User = Depends(get_current_super_admin),
    audit: AuditService = Depends(get_audit_service),
) -> AdminExternalIdentityInfo:
    require_admin_sensitive_action(request, db, actor)
    _, identity = _managed_identity(db, actor, user_id, identity_id)
    try:
        restored = ExternalIdentityUserService(db).restore_identity(identity.id)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=sanitize_error_detail(str(exc)),
        ) from exc
    audit.record_action(
        user=actor,
        scope="security",
        action="administrator_external_identity_restored",
        entity_type="external_identity",
        entity_id=restored.id,
        metadata={"provider_type": restored.provider_type, "provider_id": restored.provider_id},
    )
    return _identity_info(restored)


@router.delete("/users/{user_id}/security/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_user_session(
    request: Request,
    user_id: int,
    session_id: str,
    db: Session = Depends(get_db),
    actor: User = Depends(get_current_super_admin),
    audit: AuditService = Depends(get_audit_service),
) -> None:
    require_admin_sensitive_action(request, db, actor)
    target = _target_user(db, actor, user_id)
    session = db.query(AuthSession).filter(AuthSession.id == session_id, AuthSession.user_id == target.id).first()
    if session is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    AuthSessionService(db).revoke_session(session.id, "administrator_revoked")
    audit.record_action(
        user=actor,
        scope="security",
        action="administrator_revoke_session",
        entity_type="auth_session",
        entity_id=session.id,
    )


@router.get("/identity/link-requests", response_model=list[ExternalIdentityLinkRequestInfo])
def list_identity_link_requests(
    request: Request,
    include_decided: bool = Query(False),
    db: Session = Depends(get_db),
    actor: User = Depends(get_current_super_admin),
) -> list[ExternalIdentityLinkRequestInfo]:
    require_admin_sensitive_action(request, db, actor)
    rows = ExternalIdentityUserService(db).list_link_requests(include_decided=include_decided)
    user_ids = {row.user_id for row in rows}
    users = {row.id: row for row in db.query(User).filter(User.id.in_(user_ids)).all()} if user_ids else {}
    result: list[ExternalIdentityLinkRequestInfo] = []
    for row in rows:
        target = users.get(row.user_id)
        if target is None or (not is_superadmin_ui_role(actor.role) and target.role not in STANDARD_UI_ROLES):
            continue
        result.append(
            ExternalIdentityLinkRequestInfo(
                id=row.id,
                user_id=target.id,
                user_email=target.email,
                user_role=target.role,
                provider_type=row.provider_type,
                provider_id=row.provider_id,
                email=row.email,
                status=row.status,
                created_at=row.created_at,
                expires_at=row.expires_at,
                decided_at=row.decided_at,
                decision_source=row.decision_source,
            )
        )
    return result


@router.post("/identity/link-requests/{request_id}")
def decide_identity_link_request(
    request: Request,
    request_id: str,
    payload: LinkDecisionRequest,
    db: Session = Depends(get_db),
    actor: User = Depends(get_current_super_admin),
    audit: AuditService = Depends(get_audit_service),
) -> dict[str, str]:
    require_admin_sensitive_action(request, db, actor)
    request_row = ExternalIdentityUserService(db).list_link_requests(include_decided=True)
    link_request = next((row for row in request_row if row.id == request_id), None)
    if link_request is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="External identity request not found")
    _target_user(db, actor, link_request.user_id)
    try:
        decided = ExternalIdentityUserService(db).decide_link_request(
            request_id,
            superadmin=actor,
            approve=payload.approve,
            reason=payload.reason,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=sanitize_error_detail(str(exc)),
        ) from exc
    audit.record_action(
        user=actor,
        scope="security",
        action="external_identity_link_decision",
        entity_type="external_identity_link_request",
        entity_id=decided.id,
        metadata={
            "decision": decided.status,
            "provider_type": decided.provider_type,
            "provider_id": decided.provider_id,
        },
    )
    return {"id": decided.id, "status": decided.status}


@router.get("/identity/sessions", response_model=list[AdminSessionInfo])
def list_global_sessions(
    request: Request,
    include_revoked: bool = Query(False),
    db: Session = Depends(get_db),
    actor: User = Depends(get_current_super_admin),
) -> list[AdminSessionInfo]:
    require_admin_sensitive_action(request, db, actor)
    rows = AuthSessionService(db).list_for_admin(actor, include_revoked=include_revoked)
    user_ids = {row.user_id for row in rows if row.user_id is not None}
    users = {row.id: row for row in db.query(User).filter(User.id.in_(user_ids)).all()} if user_ids else {}
    return [
        AdminSessionInfo(
            **_session_info(row).model_dump(),
            user_email=users[row.user_id].email if row.user_id in users else None,
            user_full_name=users[row.user_id].full_name if row.user_id in users else None,
            user_role=users[row.user_id].role if row.user_id in users else None,
        )
        for row in rows
    ]


@router.delete("/identity/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_global_session(
    request: Request,
    session_id: str,
    db: Session = Depends(get_db),
    actor: User = Depends(get_current_super_admin),
    audit: AuditService = Depends(get_audit_service),
) -> None:
    require_admin_sensitive_action(request, db, actor)
    row = db.query(AuthSession).filter(AuthSession.id == session_id).first()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    if row.user_id is None:
        if not is_superadmin_ui_role(actor.role):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")
    else:
        _target_user(db, actor, row.user_id)
    AuthSessionService(db).revoke_session(row.id, "administrator_revoked")
    audit.record_action(
        user=actor,
        scope="security",
        action="administrator_revoke_session",
        entity_type="auth_session",
        entity_id=row.id,
    )
