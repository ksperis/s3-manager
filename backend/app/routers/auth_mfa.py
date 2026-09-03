# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Any, Optional

from fastapi import (
    APIRouter,
    Cookie,
    Depends,
    HTTPException,
    Request,
    Response,
    status,
)
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import get_db
from app.core.security import decode_typed_token
from app.db import User
from app.models.auth import (
    AuthenticationResponse,
    RecoveryCodeRequest,
    WebAuthnAuthenticationRequest,
    WebAuthnCredentialRequest,
)
from app.routers.auth_cookies import set_auth_cookies
from app.routers.auth_request_context import request_context
from app.routers.dependencies import get_audit_service
from app.services.audit_service import AuditService
from app.services.auth_session_service import AuthSessionService, SessionCredentials
from app.services.users_service import get_users_service
from app.services.webauthn_service import WebAuthnSecurityError, WebAuthnService
from app.utils.request_security import require_trusted_origin

router = APIRouter()
settings = get_settings()


def _pre_auth_user(
    db: Session,
    token: Optional[str],
    *,
    purposes: set[str],
) -> tuple[User, dict[str, Any]]:
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Pre-authentication required")
    claims = decode_typed_token(token, expected_type="pre_auth")
    if claims is None or claims.get("purpose") not in purposes:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid pre-authentication")
    user = db.query(User).filter(User.id == claims.get("uid")).first()
    if not user or not user.is_active or user.auth_version != claims.get("auth_version"):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Pre-authentication expired")
    return user, claims


def _finish_verified_session(
    request: Request,
    response: Response,
    db: Session,
    user: User,
    *,
    auth_type: str,
) -> SessionCredentials:
    ip_address, user_agent, _ = request_context(request, settings=settings)
    credentials = AuthSessionService(db).create_for_user(
        user,
        auth_type=auth_type,
        ip_address=ip_address,
        user_agent=user_agent,
        mfa_verified=True,
    )
    set_auth_cookies(response, credentials)
    response.delete_cookie(settings.pre_auth_cookie_name, path="/api/auth")
    return credentials


@router.post("/webauthn/registration/options")
def webauthn_registration_options(
    request: Request,
    db: Session = Depends(get_db),
    pre_auth: Optional[str] = Cookie(None, alias=settings.pre_auth_cookie_name),
) -> dict[str, Any]:
    require_trusted_origin(request)
    user, claims = _pre_auth_user(db, pre_auth, purposes={"mfa_enrollment"})
    return WebAuthnService(db).begin_registration(user, binding_sid=str(claims["sid"]))


@router.post("/webauthn/registration/verify", response_model=AuthenticationResponse)
def webauthn_registration_verify(
    request: Request,
    response: Response,
    payload: WebAuthnCredentialRequest,
    db: Session = Depends(get_db),
    pre_auth: Optional[str] = Cookie(None, alias=settings.pre_auth_cookie_name),
    audit_service: AuditService = Depends(get_audit_service),
) -> AuthenticationResponse:
    require_trusted_origin(request)
    user, claims = _pre_auth_user(db, pre_auth, purposes={"mfa_enrollment"})
    service = WebAuthnService(db)
    try:
        credential_row = service.finish_registration(
            user,
            credential=payload.credential,
            name=payload.name,
            binding_sid=str(claims["sid"]),
        )
    except WebAuthnSecurityError as exc:
        raise HTTPException(status_code=400, detail="Invalid WebAuthn registration response") from exc
    user = get_users_service(db).get_by_id(user.id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User is unavailable")
    codes = service.issue_recovery_codes(user)
    credentials = _finish_verified_session(
        request,
        response,
        db,
        user,
        auth_type="password+webauthn",
    )
    audit_service.record_action(
        user=user,
        scope="security",
        action="webauthn_enrollment_completed",
        entity_type="webauthn_credential",
        entity_id=credential_row.id,
        metadata={"recovery_codes_issued": len(codes)},
    )
    return AuthenticationResponse(
        status="authenticated",
        user=get_users_service(db).user_to_out(user),
        recovery_codes=codes,
    )


@router.post("/webauthn/authentication/options")
def webauthn_authentication_options(
    request: Request,
    db: Session = Depends(get_db),
    pre_auth: Optional[str] = Cookie(None, alias=settings.pre_auth_cookie_name),
) -> dict[str, Any]:
    require_trusted_origin(request)
    user, claims = _pre_auth_user(db, pre_auth, purposes={"mfa_authentication"})
    try:
        return WebAuthnService(db).begin_authentication(user, binding_sid=str(claims["sid"]))
    except WebAuthnSecurityError as exc:
        raise HTTPException(status_code=400, detail="WebAuthn authentication is unavailable") from exc


@router.post("/webauthn/authentication/verify", response_model=AuthenticationResponse)
def webauthn_authentication_verify(
    request: Request,
    response: Response,
    payload: WebAuthnAuthenticationRequest,
    db: Session = Depends(get_db),
    pre_auth: Optional[str] = Cookie(None, alias=settings.pre_auth_cookie_name),
    audit_service: AuditService = Depends(get_audit_service),
) -> AuthenticationResponse:
    require_trusted_origin(request)
    user, claims = _pre_auth_user(db, pre_auth, purposes={"mfa_authentication"})
    try:
        WebAuthnService(db).finish_authentication(
            user,
            credential=payload.credential,
            binding_sid=str(claims["sid"]),
        )
    except WebAuthnSecurityError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid WebAuthn authentication response") from exc
    credentials = _finish_verified_session(
        request,
        response,
        db,
        user,
        auth_type="webauthn",
    )
    audit_service.record_action(
        user=user,
        scope="auth",
        action="webauthn_authentication_success",
        entity_type="ui_session",
        entity_id=credentials.session.id,
    )
    return AuthenticationResponse(status="authenticated", user=get_users_service(db).user_to_out(user))


@router.post("/recovery/verify", response_model=AuthenticationResponse)
def verify_recovery_code(
    request: Request,
    response: Response,
    payload: RecoveryCodeRequest,
    db: Session = Depends(get_db),
    pre_auth: Optional[str] = Cookie(None, alias=settings.pre_auth_cookie_name),
    audit_service: AuditService = Depends(get_audit_service),
) -> AuthenticationResponse:
    require_trusted_origin(request)
    user, _ = _pre_auth_user(db, pre_auth, purposes={"mfa_authentication"})
    if not WebAuthnService(db).consume_recovery_code(user, payload.code):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid recovery code")
    credentials = _finish_verified_session(
        request,
        response,
        db,
        user,
        auth_type="recovery_code",
    )
    audit_service.record_action(
        user=user,
        scope="auth",
        action="recovery_code_authentication_success",
        entity_type="ui_session",
        entity_id=credentials.session.id,
    )
    return AuthenticationResponse(status="authenticated", user=get_users_service(db).user_to_out(user))
