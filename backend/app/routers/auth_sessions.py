# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Cookie, Depends, HTTPException, Query, Request, Response, status
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import get_db
from app.core.security import constant_time_equal, decode_typed_token
from app.db import AuthSession, User, WebAuthnCredential, is_admin_ui_role
from app.models.auth import (
    CurrentSessionResponse,
    ExternalIdentityInfo,
    LinkDecisionRequest,
    RefreshResponse,
    SessionInfo,
    WebAuthnCredentialInfo,
    WebAuthnCredentialRequest,
)
from app.models.session import ManagerSessionPrincipal, SessionDescriptor
from app.routers.auth_cookies import clear_auth_cookies, set_auth_cookies
from app.routers.auth_session_guards import (
    current_auth_session,
    require_recent_mfa,
    require_recent_primary_auth,
)
from app.routers.dependencies import (
    get_audit_service,
    get_current_actor,
    get_current_ui_superadmin,
    get_current_user,
)
from app.services.audit_service import AuditService
from app.services.auth_session_service import AuthSessionError, AuthSessionService, RefreshReplayError
from app.services.external_identity_user_service import ExternalIdentityUserService
from app.services.users_service import get_users_service
from app.services.webauthn_service import WebAuthnSecurityError, WebAuthnService
from app.utils.request_security import require_trusted_origin


router = APIRouter()
settings = get_settings()


def _session_info(row: AuthSession, *, current_id: Optional[str] = None) -> SessionInfo:
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
        current=row.id == current_id,
        user_id=row.user_id,
        s3_session_id=row.s3_session_id,
    )


@router.post("/refresh", response_model=RefreshResponse)
def refresh_access_token(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    refresh_token: Optional[str] = Cookie(None, alias=settings.refresh_token_cookie_name),
) -> RefreshResponse:
    require_trusted_origin(request)
    if request.headers.get("authorization"):
        raise HTTPException(status_code=400, detail="Bearer authentication is not allowed for refresh")
    if not refresh_token:
        raise HTTPException(status_code=401, detail="Missing refresh token")
    try:
        credentials = AuthSessionService(db).rotate(refresh_token)
    except RefreshReplayError as exc:
        clear_auth_cookies(response)
        raise HTTPException(status_code=401, detail="Refresh token replay detected") from exc
    except AuthSessionError as exc:
        clear_auth_cookies(response)
        raise HTTPException(status_code=401, detail="Session expired or invalid") from exc
    set_auth_cookies(response, credentials)
    return RefreshResponse()


@router.get("/session", response_model=CurrentSessionResponse)
def current_session(
    request: Request,
    actor=Depends(get_current_actor),
    db: Session = Depends(get_db),
) -> CurrentSessionResponse:
    row = current_auth_session(request, db)
    if isinstance(actor, ManagerSessionPrincipal):
        descriptor = SessionDescriptor(
            session_id=actor.session_id,
            actor_type=actor.actor_type,
            account_id=actor.account_id,
            account_name=actor.account_name,
            user_uid=actor.user_uid,
            capabilities=actor.capabilities,
        )
        return CurrentSessionResponse(session=descriptor, auth_session=_session_info(row, current_id=row.id))
    return CurrentSessionResponse(
        user=get_users_service(db).user_to_out(actor),
        auth_session=_session_info(row, current_id=row.id),
    )


@router.get("/sessions", response_model=list[SessionInfo])
def list_sessions(
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[SessionInfo]:
    current = current_auth_session(request, db)
    return [_session_info(row, current_id=current.id) for row in AuthSessionService(db).list_for_user(current_user.id)]


@router.delete("/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_session(
    request: Request,
    session_id: str,
    response: Response,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    audit_service: AuditService = Depends(get_audit_service),
) -> None:
    require_recent_mfa(request, db) if is_admin_ui_role(current_user.role) else None
    current_id = current_auth_session(request, db).id
    row = db.query(AuthSession).filter(AuthSession.id == session_id, AuthSession.user_id == current_user.id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Session not found")
    AuthSessionService(db).revoke_session(row.id, "user_revoked")
    audit_service.record_action(
        user=current_user,
        scope="security",
        action="revoke_own_session",
        entity_type="auth_session",
        entity_id=row.id,
        metadata={"current_session": current_id == row.id},
    )
    if current_id == row.id:
        clear_auth_cookies(response)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    audit_service: AuditService = Depends(get_audit_service),
) -> None:
    require_trusted_origin(request)
    submitted_csrf = request.headers.get("x-csrf-token")
    cookie_csrf = request.cookies.get(settings.csrf_cookie_name)
    if not submitted_csrf or not constant_time_equal(submitted_csrf, cookie_csrf):
        raise HTTPException(status_code=403, detail="Invalid CSRF token")
    service = AuthSessionService(db)
    token = request.cookies.get(settings.access_token_cookie_name)
    revoked_session_id = None
    for token_type in ("ui_access", "s3_access"):
        claims = decode_typed_token(token or "", expected_type=token_type)
        if claims:
            session = db.query(AuthSession).filter(AuthSession.id == str(claims["sid"])).first()
            if session is None or not service.validate_csrf(session, submitted_csrf):
                raise HTTPException(status_code=403, detail="Invalid CSRF token")
            service.revoke_session(str(claims["sid"]), "logout")
            revoked_session_id = str(claims["sid"])
            break
    if revoked_session_id is None:
        refresh_token = request.cookies.get(settings.refresh_token_cookie_name)
        if refresh_token:
            try:
                revoked_session_id = service.revoke_by_refresh_token(
                    refresh_token,
                    "logout",
                    csrf_token=submitted_csrf,
                )
            except AuthSessionError as exc:
                raise HTTPException(status_code=403, detail="Invalid CSRF token") from exc
    clear_auth_cookies(response)
    audit_service.record_action(
        user=None,
        user_email="session",
        user_role="session",
        scope="auth",
        action="logout",
        entity_type="auth_session",
        entity_id=revoked_session_id,
    )


@router.post("/logout-all", status_code=status.HTTP_204_NO_CONTENT)
def logout_all(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    audit_service: AuditService = Depends(get_audit_service),
) -> None:
    if is_admin_ui_role(current_user.role):
        require_recent_mfa(request, db)
    AuthSessionService(db).revoke_all_for_user(current_user, "global_logout")
    audit_service.record_action(
        user=current_user,
        scope="security",
        action="logout_all_sessions",
        entity_type="user",
        entity_id=str(current_user.id),
    )
    clear_auth_cookies(response)


@router.get("/external-link-requests")
def list_external_link_requests(
    request: Request,
    include_decided: bool = Query(False),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_ui_superadmin),
) -> list[dict[str, Any]]:
    require_recent_mfa(request, db)
    rows = ExternalIdentityUserService(db).list_link_requests(include_decided=include_decided)
    return [
        {
            "id": row.id,
            "user_id": row.user_id,
            "provider_type": row.provider_type,
            "provider_id": row.provider_id,
            "email": row.email,
            "status": row.status,
            "created_at": row.created_at,
            "expires_at": row.expires_at,
        }
        for row in rows
    ]


@router.post("/external-link-requests/{request_id}")
def decide_external_link_request(
    request: Request,
    request_id: str,
    payload: LinkDecisionRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_ui_superadmin),
    audit_service: AuditService = Depends(get_audit_service),
) -> dict[str, str]:
    require_recent_mfa(request, db)
    try:
        row = ExternalIdentityUserService(db).decide_link_request(
            request_id,
            superadmin=current_user,
            approve=payload.approve,
            reason=payload.reason,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="External identity request cannot be updated") from exc
    audit_service.record_action(
        user=current_user,
        scope="security",
        action="external_identity_link_decision",
        entity_type="external_identity_link_request",
        entity_id=row.id,
        metadata={"decision": row.status, "provider_type": row.provider_type, "provider_id": row.provider_id},
    )
    return {"id": row.id, "status": row.status}


@router.get("/security/webauthn/credentials", response_model=list[WebAuthnCredentialInfo])
def list_webauthn_credentials(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[WebAuthnCredentialInfo]:
    rows = (
        db.query(WebAuthnCredential)
        .filter(
            WebAuthnCredential.user_id == current_user.id,
            WebAuthnCredential.revoked_at.is_(None),
        )
        .order_by(WebAuthnCredential.created_at.asc())
        .all()
    )
    return [
        WebAuthnCredentialInfo(id=row.id, name=row.name, created_at=row.created_at, last_used_at=row.last_used_at)
        for row in rows
    ]


@router.get("/security/external-identities", response_model=list[ExternalIdentityInfo])
def list_external_identities(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[ExternalIdentityInfo]:
    rows = ExternalIdentityUserService(db).list_for_user(current_user.id)
    return [
        ExternalIdentityInfo(
            id=row.id,
            provider_type=row.provider_type,
            provider_id=row.provider_id,
            email=row.email,
            email_verified=row.email_verified,
            created_at=row.created_at,
            last_login_at=row.last_login_at,
        )
        for row in rows
    ]


@router.delete("/security/external-identities/{identity_id}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_external_identity(
    request: Request,
    identity_id: str,
    response: Response,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    audit_service: AuditService = Depends(get_audit_service),
) -> None:
    require_recent_mfa(request, db)
    identity = next(
        (row for row in ExternalIdentityUserService(db).list_for_user(current_user.id) if row.id == identity_id),
        None,
    )
    if identity is None:
        raise HTTPException(status_code=404, detail="External identity not found")
    try:
        ExternalIdentityUserService(db).revoke_identity(identity.id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="External identity not found") from exc
    audit_service.record_action(
        user=current_user,
        scope="security",
        action="external_identity_revoked",
        entity_type="external_identity",
        entity_id=identity.id,
        metadata={"provider_type": identity.provider_type, "provider_id": identity.provider_id},
    )
    clear_auth_cookies(response)


@router.post("/security/webauthn/registration/options")
def profile_webauthn_registration_options(
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    service = WebAuthnService(db)
    if service.has_credentials(current_user.id):
        require_recent_mfa(request, db)
    else:
        require_recent_primary_auth(request, db)
    return service.begin_registration(current_user, binding_sid=current_auth_session(request, db).id)


@router.post("/security/webauthn/registration/verify", status_code=status.HTTP_201_CREATED)
def profile_webauthn_registration_verify(
    request: Request,
    payload: WebAuthnCredentialRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    audit_service: AuditService = Depends(get_audit_service),
) -> dict[str, Any]:
    service = WebAuthnService(db)
    if service.has_credentials(current_user.id):
        require_recent_mfa(request, db)
    else:
        require_recent_primary_auth(request, db)
    current_session_id = current_auth_session(request, db).id
    try:
        row = service.finish_registration(
            current_user,
            credential=payload.credential,
            name=payload.name,
            binding_sid=current_session_id,
        )
    except WebAuthnSecurityError as exc:
        raise HTTPException(status_code=400, detail="Invalid WebAuthn registration response") from exc
    AuthSessionService(db).revoke_all_for_user(current_user, "mfa_changed", increment_version=False)
    audit_service.record_action(
        user=current_user,
        scope="security",
        action="webauthn_credential_added",
        entity_type="webauthn_credential",
        entity_id=row.id,
    )
    return {"id": row.id, "name": row.name, "reauthentication_required": True}


@router.delete("/security/webauthn/credentials/{credential_id}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_webauthn_credential(
    request: Request,
    credential_id: str,
    response: Response,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    audit_service: AuditService = Depends(get_audit_service),
) -> None:
    require_recent_mfa(request, db)
    try:
        WebAuthnService(db).revoke_credential(current_user, credential_id)
    except WebAuthnSecurityError as exc:
        raise HTTPException(status_code=400, detail="Passkey cannot be revoked") from exc
    AuthSessionService(db).revoke_all_for_user(current_user, "mfa_changed", increment_version=False)
    audit_service.record_action(
        user=current_user,
        scope="security",
        action="webauthn_credential_revoked",
        entity_type="webauthn_credential",
        entity_id=credential_id,
    )
    clear_auth_cookies(response)


@router.post("/security/recovery-codes")
def regenerate_recovery_codes(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    audit_service: AuditService = Depends(get_audit_service),
) -> dict[str, list[str]]:
    require_recent_mfa(request, db)
    codes = WebAuthnService(db).issue_recovery_codes(current_user)
    AuthSessionService(db).revoke_all_for_user(
        current_user,
        "recovery_codes_regenerated",
    )
    audit_service.record_action(
        user=current_user,
        scope="security",
        action="recovery_codes_regenerated",
        entity_type="user",
        entity_id=str(current_user.id),
        metadata={"count": len(codes)},
    )
    clear_auth_cookies(response)
    return {"codes": codes}


@router.get("/admin/sessions", response_model=list[SessionInfo])
def list_all_sessions(
    request: Request,
    include_revoked: bool = Query(False),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_ui_superadmin),
) -> list[SessionInfo]:
    require_recent_mfa(request, db)
    query = db.query(AuthSession)
    if not include_revoked:
        query = query.filter(AuthSession.revoked_at.is_(None))
    return [_session_info(row) for row in query.order_by(AuthSession.created_at.desc()).all()]


@router.delete("/admin/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
def admin_revoke_session(
    request: Request,
    session_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_ui_superadmin),
    audit_service: AuditService = Depends(get_audit_service),
) -> None:
    require_recent_mfa(request, db)
    AuthSessionService(db).revoke_session(session_id, "administrator_revoked")
    audit_service.record_action(
        user=current_user,
        scope="security",
        action="administrator_revoke_session",
        entity_type="auth_session",
        entity_id=session_id,
    )
