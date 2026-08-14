# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import hashlib
import json
import uuid
from datetime import datetime, timedelta
from typing import Any, Literal, Optional

from fastapi import APIRouter, Cookie, Depends, HTTPException, Query, Request, Response, status
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import Field
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import get_db
from app.core.security import constant_time_equal, create_pre_auth_token, decode_typed_token
from app.db import AuthSession, S3Session, User, WebAuthnCredential, is_admin_ui_role
from app.models.api_token import ApiTokenCreateRequest, ApiTokenCreateResponse, ApiTokenInfo
from app.models.base import ApiModel
from app.models.ldap import LDAPLoginRequest, LDAPProviderInfo
from app.models.oidc import OIDCCallbackRequest, OIDCProviderInfo, OIDCStartRequest, OIDCStartResponse
from app.models.session import ManagerSessionPrincipal, S3KeyLogin, SessionDescriptor
from app.models.user import UserCreate, UserOut
from app.routers.dependencies import (
    get_audit_service,
    get_current_actor,
    get_current_super_admin,
    get_current_ui_superadmin,
    get_current_user,
)
from app.services.api_token_service import ApiTokenError, ApiTokenNotFoundError, ApiTokenService
from app.services.app_settings_service import load_app_settings
from app.services.audit_service import AuditService
from app.services.auth_rate_limit_service import AuthRateLimitService, LoginRateLimitedError
from app.services.auth_session_service import AuthSessionError, AuthSessionService, RefreshReplayError, SessionCredentials
from app.services.external_identity_user_service import ExternalIdentityLinkRequiredError, ExternalIdentityUserService
from app.services.ldap_service import (
    LDAPAuthenticationError,
    LDAPAuthService,
    LDAPConfigurationError,
    LDAPProviderNotFoundError,
    LDAPUserConflictError,
    get_ldap_auth_service,
)
from app.services.oidc_service import (
    OIDCAuthenticationError,
    OIDCConfigurationError,
    OIDCProviderNotFoundError,
    OIDCStateError,
    OidcService,
    get_oidc_service,
)
from app.services.session_service import SessionIntrospectionError, SessionService
from app.services.storage_endpoints_service import get_storage_endpoints_service
from app.services.users_service import UsersService, get_users_service
from app.services.webauthn_service import WebAuthnSecurityError, WebAuthnService
from app.utils.http_errors import raise_http_exception_from_exception
from app.utils.request_security import client_ip, require_trusted_origin
from app.utils.s3_endpoint import validate_custom_login_s3_endpoint
from app.utils.time import utcnow


router = APIRouter(prefix="/auth", tags=["auth"])
settings = get_settings()


class AuthenticationResponse(ApiModel):
    status: Literal[
        "authenticated",
        "mfa_required",
        "mfa_enrollment_required",
        "link_approval_required",
    ]
    user: Optional[UserOut] = None
    session: Optional[SessionDescriptor] = None
    redirect_path: Optional[str] = None
    link_request_id: Optional[str] = None
    recovery_codes: Optional[list[str]] = None


class RefreshResponse(ApiModel):
    status: Literal["authenticated"] = "authenticated"


class SessionInfo(ApiModel):
    id: str
    principal_type: str
    auth_type: str
    created_at: datetime
    last_activity_at: datetime
    idle_expires_at: datetime
    absolute_expires_at: datetime
    mfa_verified_at: Optional[datetime] = None
    ip_address: Optional[str] = None
    user_agent: Optional[str] = None
    revoked_at: Optional[datetime] = None
    revoke_reason: Optional[str] = None
    current: bool = False
    user_id: Optional[int] = None
    s3_session_id: Optional[str] = None


class CurrentSessionResponse(ApiModel):
    authenticated: Literal[True] = True
    user: Optional[UserOut] = None
    session: Optional[SessionDescriptor] = None
    auth_session: SessionInfo


class WebAuthnCredentialRequest(ApiModel):
    credential: dict[str, Any]
    name: str = Field(default="Passkey", min_length=1, max_length=128)


class WebAuthnAuthenticationRequest(ApiModel):
    credential: dict[str, Any]


class RecoveryCodeRequest(ApiModel):
    code: str = Field(min_length=8, max_length=128)


class LinkDecisionRequest(ApiModel):
    approve: bool
    reason: Optional[str] = Field(default=None, max_length=500)


class WebAuthnCredentialInfo(ApiModel):
    id: str
    name: str
    created_at: datetime
    last_used_at: Optional[datetime] = None


class ExternalIdentityInfo(ApiModel):
    id: str
    provider_type: str
    provider_id: str
    email: Optional[str] = None
    email_verified: bool
    created_at: datetime
    last_login_at: Optional[datetime] = None


def _set_auth_cookies(response: Response, credentials: SessionCredentials) -> None:
    common = {
        "secure": settings.refresh_token_cookie_secure,
        "samesite": settings.refresh_token_cookie_samesite,
        "domain": None,
    }
    response.set_cookie(
        settings.access_token_cookie_name,
        credentials.access_token,
        max_age=settings.access_token_expire_minutes * 60,
        httponly=True,
        path="/api",
        **common,
    )
    response.set_cookie(
        settings.refresh_token_cookie_name,
        credentials.refresh_token,
        max_age=settings.refresh_token_expire_minutes * 60,
        httponly=True,
        path=settings.refresh_token_cookie_path,
        **common,
    )
    if credentials.csrf_token:
        response.set_cookie(
            settings.csrf_cookie_name,
            credentials.csrf_token,
            max_age=settings.refresh_token_expire_minutes * 60,
            httponly=False,
            path="/",
            **common,
        )


def _set_pre_auth_cookie(response: Response, user: User, purpose: str) -> None:
    token = create_pre_auth_token(
        user_id=user.id,
        session_id=str(uuid.uuid4()),
        auth_version=user.auth_version,
        purpose=purpose,
    )
    response.set_cookie(
        settings.pre_auth_cookie_name,
        token,
        max_age=settings.pre_auth_expire_minutes * 60,
        httponly=True,
        secure=settings.refresh_token_cookie_secure,
        samesite=settings.refresh_token_cookie_samesite,
        path="/api/auth",
    )


def _clear_auth_cookies(response: Response) -> None:
    response.delete_cookie(settings.access_token_cookie_name, path="/api")
    response.delete_cookie(settings.refresh_token_cookie_name, path=settings.refresh_token_cookie_path)
    response.delete_cookie(settings.csrf_cookie_name, path="/")
    response.delete_cookie(settings.pre_auth_cookie_name, path="/api/auth")


def _pre_auth_user(db: Session, token: Optional[str], *, purposes: set[str]) -> tuple[User, dict[str, Any]]:
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Pre-authentication required")
    claims = decode_typed_token(token, expected_type="pre_auth")
    if claims is None or claims.get("purpose") not in purposes:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid pre-authentication")
    user = db.query(User).filter(User.id == claims.get("uid")).first()
    if not user or not user.is_active or user.auth_version != claims.get("auth_version"):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Pre-authentication expired")
    return user, claims


def _request_context(request: Request) -> tuple[str, Optional[str], Optional[str]]:
    return client_ip(request), request.headers.get("user-agent"), request.headers.get("x-request-id")


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


def _current_auth_session(request: Request, db: Session) -> AuthSession:
    token = request.cookies.get(settings.access_token_cookie_name)
    claims = decode_typed_token(token or "", expected_type="ui_access")
    if claims is None:
        claims = decode_typed_token(token or "", expected_type="s3_access")
    if claims is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="UI session required")
    row = db.query(AuthSession).filter(AuthSession.id == claims.get("sid")).first()
    if not row or row.revoked_at is not None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="UI session required")
    return row


def _require_recent_mfa(request: Request, db: Session) -> AuthSession:
    row = _current_auth_session(request, db)
    if not WebAuthnService(db).is_recent(row):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Recent WebAuthn verification required")
    return row


def _require_recent_primary_auth(request: Request, db: Session) -> AuthSession:
    row = _current_auth_session(request, db)
    if row.created_at < utcnow() - timedelta(minutes=settings.mfa_recent_minutes):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Recent primary authentication required")
    return row


def _finish_user_primary_auth(
    *,
    request: Request,
    response: Response,
    user: User,
    users_service: UsersService,
    auth_type: str,
    redirect_path: Optional[str] = None,
) -> AuthenticationResponse:
    has_passkey = WebAuthnService(users_service.db).has_credentials(user.id)
    if has_passkey or is_admin_ui_role(user.role):
        result_status = "mfa_required" if has_passkey else "mfa_enrollment_required"
        _set_pre_auth_cookie(response, user, "mfa_authentication" if has_passkey else "mfa_enrollment")
        return AuthenticationResponse(status=result_status, user=users_service.user_to_out(user), redirect_path=redirect_path)
    ip_address, user_agent, _ = _request_context(request)
    credentials = AuthSessionService(users_service.db).create_for_user(
        user,
        auth_type=auth_type,
        ip_address=ip_address,
        user_agent=user_agent,
        mfa_verified=False,
    )
    _set_auth_cookies(response, credentials)
    return AuthenticationResponse(
        status="authenticated",
        user=users_service.user_to_out(user),
        redirect_path=redirect_path,
    )


def _to_api_token_info(row) -> ApiTokenInfo:
    return ApiTokenInfo(
        id=row.id,
        name=row.name,
        created_at=row.created_at,
        last_used_at=row.last_used_at,
        expires_at=row.expires_at,
        revoked_at=row.revoked_at,
        scopes=json.loads(row.scopes_json or "[]"),
    )


@router.get("/api-tokens", response_model=list[ApiTokenInfo])
def list_api_tokens(
    request: Request,
    include_revoked: bool = Query(False),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_super_admin),
) -> list[ApiTokenInfo]:
    _require_recent_mfa(request, db)
    return [_to_api_token_info(row) for row in ApiTokenService(db).list_for_user(current_user.id, include_revoked=include_revoked)]


@router.post("/api-tokens", response_model=ApiTokenCreateResponse, status_code=status.HTTP_201_CREATED)
def create_api_token(
    request: Request,
    payload: ApiTokenCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_super_admin),
    audit_service: AuditService = Depends(get_audit_service),
) -> ApiTokenCreateResponse:
    _require_recent_mfa(request, db)
    try:
        token, row = ApiTokenService(db).create_for_user(
            current_user,
            name=payload.name,
            scopes=payload.scopes,
            expires_in_days=payload.expires_in_days,
        )
    except ApiTokenError as exc:
        raise_http_exception_from_exception(status.HTTP_400_BAD_REQUEST, exc)
    audit_service.record_action(
        user=current_user,
        scope="auth",
        action="create_api_token",
        entity_type="api_token",
        entity_id=row.id,
        metadata={"name": row.name, "scopes": payload.scopes, "expires_at": row.expires_at.isoformat()},
    )
    return ApiTokenCreateResponse(access_token=token, api_token=_to_api_token_info(row))


@router.delete("/api-tokens/{token_id}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_api_token(
    request: Request,
    token_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_super_admin),
    audit_service: AuditService = Depends(get_audit_service),
) -> None:
    _require_recent_mfa(request, db)
    try:
        row = ApiTokenService(db).revoke_for_user(user_id=current_user.id, token_id=token_id)
    except ApiTokenNotFoundError as exc:
        raise_http_exception_from_exception(status.HTTP_404_NOT_FOUND, exc)
    audit_service.record_action(
        user=current_user,
        scope="auth",
        action="revoke_api_token",
        entity_type="api_token",
        entity_id=row.id,
        metadata={"name": row.name},
    )


@router.post("/register-admin", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def register_admin(
    request: Request,
    payload: UserCreate,
    users_service: UsersService = Depends(lambda db=Depends(get_db): get_users_service(db)),
    current_user: User = Depends(get_current_ui_superadmin),
    audit_service: AuditService = Depends(get_audit_service),
) -> UserOut:
    _require_recent_mfa(request, users_service.db)
    try:
        user = users_service.create_super_admin(payload)
    except ValueError as exc:
        raise_http_exception_from_exception(status.HTTP_400_BAD_REQUEST, exc)
    audit_service.record_action(
        user=current_user,
        scope="admin",
        action="register_admin",
        entity_type="user",
        entity_id=user.id,
        metadata={"email": user.email, "role": user.role},
    )
    return users_service.user_to_out(user)


@router.post("/login", response_model=AuthenticationResponse)
def login(
    request: Request,
    response: Response,
    form_data: OAuth2PasswordRequestForm = Depends(),
    users_service: UsersService = Depends(lambda db=Depends(get_db): get_users_service(db)),
    audit_service: AuditService = Depends(get_audit_service),
) -> AuthenticationResponse:
    require_trusted_origin(request)
    username = (form_data.username or "").strip()
    ip_address, user_agent, request_id = _request_context(request)
    limiter = AuthRateLimitService(users_service.db, settings=settings)
    try:
        limiter.check(account=username, ip_address=ip_address)
    except LoginRateLimitedError as exc:
        audit_service.record_action(
            user=None,
            user_email=username.lower(),
            scope="auth",
            action="login_rate_limited",
            entity_type="ui_session",
            status="failure",
            message="Login rate limit exceeded",
            ip_address=ip_address,
            user_agent=user_agent,
            request_id=request_id,
        )
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many failed login attempts. Please try again later.",
            headers={"Retry-After": str(exc.retry_after)},
        ) from exc
    user = users_service.authenticate(username, form_data.password)
    if not user:
        limiter.record_failure(account=username, ip_address=ip_address)
        audit_service.record_action(
            user=None,
            user_email=username.lower(),
            scope="auth",
            action="login_failure",
            entity_type="ui_session",
            status="failure",
            message="Invalid credentials",
            ip_address=ip_address,
            user_agent=user_agent,
            request_id=request_id,
        )
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    limiter.clear_account(account=username, ip_address=ip_address)
    result = _finish_user_primary_auth(
        request=request,
        response=response,
        user=user,
        users_service=users_service,
        auth_type="password",
    )
    audit_service.record_action(
        user=user,
        scope="auth",
        action="login_primary_success",
        entity_type="ui_session",
        metadata={"role": user.role, "mfa_status": result.status},
        ip_address=ip_address,
        user_agent=user_agent,
        request_id=request_id,
    )
    return result


@router.get("/ldap/providers", response_model=list[LDAPProviderInfo])
def list_ldap_providers(
    ldap_service: LDAPAuthService = Depends(lambda db=Depends(get_db): get_ldap_auth_service(db)),
) -> list[dict[str, str]]:
    return ldap_service.list_providers()


@router.post("/ldap/{provider_id}/login", response_model=AuthenticationResponse)
def login_with_ldap(
    request: Request,
    response: Response,
    provider_id: str,
    payload: LDAPLoginRequest,
    users_service: UsersService = Depends(lambda db=Depends(get_db): get_users_service(db)),
    ldap_service: LDAPAuthService = Depends(lambda db=Depends(get_db): get_ldap_auth_service(db)),
    audit_service: AuditService = Depends(get_audit_service),
) -> AuthenticationResponse:
    require_trusted_origin(request)
    username = (payload.username or "").strip()
    ip_address, user_agent, request_id = _request_context(request)
    account_key = f"ldap:{provider_id.lower()}:{username.lower()}"
    limiter = AuthRateLimitService(users_service.db, settings=settings)
    try:
        limiter.check(account=account_key, ip_address=ip_address)
    except LoginRateLimitedError as exc:
        audit_service.record_action(
            user=None,
            user_email=account_key,
            scope="auth",
            action="login_rate_limited",
            entity_type="ui_session",
            status="failure",
            message="LDAP login rate limit exceeded",
            ip_address=ip_address,
            user_agent=user_agent,
            request_id=request_id,
        )
        raise HTTPException(status_code=429, detail="Too many failed login attempts", headers={"Retry-After": str(exc.retry_after)}) from exc
    try:
        user, created = ldap_service.authenticate(provider_id.lower(), username, payload.password)
    except ExternalIdentityLinkRequiredError as exc:
        limiter.clear_account(account=account_key, ip_address=ip_address)
        audit_service.record_action(
            user=None,
            user_email=account_key,
            scope="auth",
            action="external_identity_link_requested",
            entity_type="external_identity_link_request",
            entity_id=exc.request_id,
            metadata={"provider_type": "ldap", "provider": provider_id.lower()},
            ip_address=ip_address,
            user_agent=user_agent,
            request_id=request_id,
        )
        return AuthenticationResponse(
            status="link_approval_required",
            link_request_id=exc.request_id,
        )
    except LDAPProviderNotFoundError as exc:
        audit_service.record_action(
            user=None,
            user_email=account_key,
            scope="auth",
            action="login_ldap_provider_not_found",
            entity_type="ui_session",
            status="failure",
            message="LDAP provider is unavailable",
            metadata={"provider": provider_id.lower()},
            ip_address=ip_address,
            user_agent=user_agent,
            request_id=request_id,
        )
        raise_http_exception_from_exception(status.HTTP_404_NOT_FOUND, exc)
    except LDAPConfigurationError as exc:
        audit_service.record_action(
            user=None,
            user_email=account_key,
            scope="auth",
            action="login_ldap_configuration_error",
            entity_type="ui_session",
            status="failure",
            message="LDAP provider configuration error",
            metadata={"provider": provider_id.lower()},
            ip_address=ip_address,
            user_agent=user_agent,
            request_id=request_id,
        )
        raise HTTPException(status_code=400, detail="LDAP provider is unavailable") from exc
    except (LDAPAuthenticationError, LDAPUserConflictError) as exc:
        limiter.record_failure(account=account_key, ip_address=ip_address)
        audit_service.record_action(
            user=None,
            user_email=account_key,
            scope="auth",
            action="login_failure",
            entity_type="ui_session",
            status="failure",
            message="Invalid LDAP credentials",
            metadata={"provider": provider_id.lower()},
            ip_address=ip_address,
            user_agent=user_agent,
            request_id=request_id,
        )
        raise HTTPException(status_code=401, detail="Invalid credentials") from exc
    limiter.clear_account(account=account_key, ip_address=ip_address)
    result = _finish_user_primary_auth(
        request=request,
        response=response,
        user=user,
        users_service=users_service,
        auth_type="ldap",
    )
    audit_service.record_action(
        user=user,
        scope="auth",
        action="login_ldap_primary_success",
        entity_type="ui_session",
        metadata={"provider": provider_id.lower(), "created": created, "mfa_status": result.status},
        ip_address=ip_address,
        user_agent=user_agent,
        request_id=request_id,
    )
    return result


@router.post("/login-s3", response_model=AuthenticationResponse)
def login_with_s3_keys(
    request: Request,
    response: Response,
    payload: S3KeyLogin,
    db: Session = Depends(get_db),
    audit_service: AuditService = Depends(get_audit_service),
) -> AuthenticationResponse:
    require_trusted_origin(request)
    general = load_app_settings().general
    if not general.allow_login_access_keys:
        raise HTTPException(status_code=403, detail="Access-key login is disabled")
    service = get_storage_endpoints_service(db)
    registered = {endpoint.endpoint_url for endpoint in service.list_endpoints()}
    endpoint_url = payload.endpoint_url or service.get_default_endpoint_url()
    custom_endpoint = endpoint_url not in registered
    if settings.require_registered_s3_login_endpoints or not general.allow_login_custom_endpoint:
        if endpoint_url not in registered:
            raise HTTPException(status_code=400, detail="S3 endpoint is not registered")
    elif endpoint_url not in registered:
        try:
            endpoint_url = validate_custom_login_s3_endpoint(endpoint_url)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="Invalid S3 endpoint") from exc
    ip_address, user_agent, request_id = _request_context(request)
    account_key = f"s3:{hashlib.sha256(payload.access_key.encode()).hexdigest()}"
    limiter = AuthRateLimitService(db, settings=settings)
    try:
        limiter.check(account=account_key, ip_address=ip_address)
    except LoginRateLimitedError as exc:
        audit_service.record_action(
            user=None,
            user_email="s3:unknown",
            user_role="s3_session",
            scope="auth",
            action="login_rate_limited",
            entity_type="s3_session",
            status="failure",
            message="S3 login rate limit exceeded",
            ip_address=ip_address,
            user_agent=user_agent,
            request_id=request_id,
        )
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many failed login attempts",
            headers={"Retry-After": str(exc.retry_after)},
        ) from exc
    session_service = SessionService(db)
    try:
        actor_type, account_id, account_name, user_uid, capabilities = session_service.introspect_credentials(
            payload.access_key,
            payload.secret_key,
            endpoint_url,
        )
    except SessionIntrospectionError as exc:
        limiter.record_failure(account=account_key, ip_address=ip_address)
        audit_service.record_action(
            user=None,
            user_email="s3:unknown",
            user_role="s3_session",
            scope="auth",
            action="login_s3_failure",
            entity_type="s3_session",
            status="failure",
            message="Invalid credentials",
            ip_address=ip_address,
            user_agent=user_agent,
            request_id=request_id,
        )
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials") from exc
    limiter.clear_account(account=account_key, ip_address=ip_address)
    principal = session_service.create_session(
        access_key=payload.access_key,
        secret_key=payload.secret_key,
        actor_type=actor_type,
        account_id=account_id,
        account_name=account_name,
        user_uid=user_uid,
        capabilities=capabilities,
    )
    s3_row = db.query(S3Session).filter(S3Session.id == principal.session_id).one()
    credentials = AuthSessionService(db).create_for_s3_session(
        s3_row,
        ip_address=ip_address,
        user_agent=user_agent,
    )
    _set_auth_cookies(response, credentials)
    descriptor = SessionDescriptor(
        session_id=principal.session_id,
        actor_type=principal.actor_type,
        account_id=principal.account_id,
        account_name=principal.account_name,
        user_uid=principal.user_uid,
        capabilities=principal.capabilities,
    )
    audit_service.record_action(
        user=None,
        user_email=principal.email,
        user_role=principal.role,
        scope="auth",
        action="login_s3_custom_endpoint" if custom_endpoint else "login_s3",
        entity_type="s3_session",
        entity_id=principal.session_id,
        metadata={
            "actor_type": principal.actor_type,
            "account_id": principal.account_id,
            **({"endpoint_url": endpoint_url} if custom_endpoint else {}),
        },
        ip_address=ip_address,
        user_agent=user_agent,
        request_id=request_id,
    )
    return AuthenticationResponse(status="authenticated", session=descriptor)


@router.get("/oidc/providers", response_model=list[OIDCProviderInfo])
def list_oidc_providers(
    oidc_service: OidcService = Depends(lambda db=Depends(get_db): get_oidc_service(db)),
) -> list[OIDCProviderInfo]:
    return oidc_service.list_providers()


@router.post("/oidc/{provider_id}/start", response_model=OIDCStartResponse)
def start_oidc_login(
    request: Request,
    provider_id: str,
    payload: Optional[OIDCStartRequest] = None,
    oidc_service: OidcService = Depends(lambda db=Depends(get_db): get_oidc_service(db)),
) -> dict[str, str]:
    require_trusted_origin(request)
    ip_address, _, _ = _request_context(request)
    account_key = f"oidc-start:{provider_id.lower()}"
    limiter = AuthRateLimitService(oidc_service.db, settings=settings)
    try:
        limiter.check(account=account_key, ip_address=ip_address)
    except LoginRateLimitedError as exc:
        raise HTTPException(
            status_code=429,
            detail="Too many authentication attempts",
            headers={"Retry-After": str(exc.retry_after)},
        ) from exc
    try:
        result = oidc_service.start_login(provider_id, payload.redirect_path if payload else None)
        limiter.record_failure(account=account_key, ip_address=ip_address)
        return result
    except OIDCProviderNotFoundError as exc:
        limiter.record_failure(account=account_key, ip_address=ip_address)
        raise_http_exception_from_exception(status.HTTP_404_NOT_FOUND, exc)
    except OIDCConfigurationError as exc:
        limiter.record_failure(account=account_key, ip_address=ip_address)
        raise_http_exception_from_exception(status.HTTP_400_BAD_REQUEST, exc)


@router.post("/oidc/{provider_id}/callback", response_model=AuthenticationResponse)
def complete_oidc_login(
    request: Request,
    response: Response,
    provider_id: str,
    payload: OIDCCallbackRequest,
    oidc_service: OidcService = Depends(lambda db=Depends(get_db): get_oidc_service(db)),
    users_service: UsersService = Depends(lambda db=Depends(get_db): get_users_service(db)),
    audit_service: AuditService = Depends(get_audit_service),
) -> AuthenticationResponse:
    require_trusted_origin(request)
    ip_address, user_agent, request_id = _request_context(request)
    account_key = f"oidc-callback:{provider_id.lower()}"
    limiter = AuthRateLimitService(oidc_service.db, settings=settings)
    try:
        limiter.check(account=account_key, ip_address=ip_address)
    except LoginRateLimitedError as exc:
        audit_service.record_action(
            user=None,
            user_email=f"oidc:{provider_id.lower()}",
            scope="auth",
            action="login_rate_limited",
            entity_type="ui_session",
            status="failure",
            message="OIDC login rate limit exceeded",
            metadata={"provider": provider_id.lower()},
            ip_address=ip_address,
            user_agent=user_agent,
            request_id=request_id,
        )
        raise HTTPException(status_code=429, detail="Too many authentication attempts", headers={"Retry-After": str(exc.retry_after)}) from exc
    try:
        user, redirect_path, created = oidc_service.complete_login(provider_id, payload.code, payload.state)
    except ExternalIdentityLinkRequiredError as exc:
        limiter.clear_account(account=account_key, ip_address=ip_address)
        audit_service.record_action(
            user=None,
            user_email=f"oidc:{provider_id.lower()}",
            scope="auth",
            action="external_identity_link_requested",
            entity_type="external_identity_link_request",
            entity_id=exc.request_id,
            metadata={"provider_type": "oidc", "provider": provider_id.lower()},
            ip_address=ip_address,
            user_agent=user_agent,
            request_id=request_id,
        )
        return AuthenticationResponse(status="link_approval_required", link_request_id=exc.request_id)
    except OIDCProviderNotFoundError as exc:
        limiter.record_failure(account=account_key, ip_address=ip_address)
        audit_service.record_action(
            user=None,
            user_email=f"oidc:{provider_id.lower()}",
            scope="auth",
            action="login_oidc_failure",
            entity_type="ui_session",
            status="failure",
            message="OIDC provider is unavailable",
            metadata={"provider": provider_id.lower(), "error_class": type(exc).__name__},
            ip_address=ip_address,
            user_agent=user_agent,
            request_id=request_id,
        )
        raise HTTPException(status_code=404, detail="OIDC provider is unavailable") from exc
    except OIDCStateError as exc:
        error_status = 400
        public_detail = "Invalid OIDC response"
        error_class = type(exc).__name__
    except OIDCConfigurationError as exc:
        error_status = 503
        public_detail = "OIDC provider is unavailable"
        error_class = type(exc).__name__
    except OIDCAuthenticationError as exc:
        error_status = 401
        public_detail = "OIDC authentication failed"
        error_class = type(exc).__name__
    else:
        error_status = None
        public_detail = None
        error_class = None
    if error_status is not None:
        limiter.record_failure(account=account_key, ip_address=ip_address)
        audit_service.record_action(
            user=None,
            user_email=f"oidc:{provider_id.lower()}",
            scope="auth",
            action="login_oidc_failure",
            entity_type="ui_session",
            status="failure",
            message=public_detail,
            metadata={"provider": provider_id.lower(), "error_class": error_class},
            ip_address=ip_address,
            user_agent=user_agent,
            request_id=request_id,
        )
        raise HTTPException(status_code=error_status, detail=public_detail)
    limiter.clear_account(account=account_key, ip_address=ip_address)
    result = _finish_user_primary_auth(
        request=request,
        response=response,
        user=user,
        users_service=users_service,
        auth_type="oidc",
        redirect_path=redirect_path,
    )
    audit_service.record_action(
        user=user,
        scope="auth",
        action="login_oidc_primary_success",
        entity_type="ui_session",
        metadata={"provider": provider_id.lower(), "created": created, "mfa_status": result.status},
        ip_address=ip_address,
        user_agent=user_agent,
        request_id=request_id,
    )
    return result


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
        raise HTTPException(status_code=401, detail="User is unavailable")
    codes = service.issue_recovery_codes(user)
    ip_address, user_agent, _ = _request_context(request)
    credentials = AuthSessionService(db).create_for_user(
        user,
        auth_type="password+webauthn",
        ip_address=ip_address,
        user_agent=user_agent,
        mfa_verified=True,
    )
    _set_auth_cookies(response, credentials)
    response.delete_cookie(settings.pre_auth_cookie_name, path="/api/auth")
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
        raise HTTPException(status_code=401, detail="Invalid WebAuthn authentication response") from exc
    ip_address, user_agent, _ = _request_context(request)
    credentials = AuthSessionService(db).create_for_user(
        user,
        auth_type="webauthn",
        ip_address=ip_address,
        user_agent=user_agent,
        mfa_verified=True,
    )
    _set_auth_cookies(response, credentials)
    response.delete_cookie(settings.pre_auth_cookie_name, path="/api/auth")
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
        raise HTTPException(status_code=401, detail="Invalid recovery code")
    ip_address, user_agent, _ = _request_context(request)
    credentials = AuthSessionService(db).create_for_user(
        user,
        auth_type="recovery_code",
        ip_address=ip_address,
        user_agent=user_agent,
        mfa_verified=True,
    )
    _set_auth_cookies(response, credentials)
    response.delete_cookie(settings.pre_auth_cookie_name, path="/api/auth")
    audit_service.record_action(
        user=user,
        scope="auth",
        action="recovery_code_authentication_success",
        entity_type="ui_session",
        entity_id=credentials.session.id,
    )
    return AuthenticationResponse(status="authenticated", user=get_users_service(db).user_to_out(user))


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
        _clear_auth_cookies(response)
        raise HTTPException(status_code=401, detail="Refresh token replay detected") from exc
    except AuthSessionError as exc:
        _clear_auth_cookies(response)
        raise HTTPException(status_code=401, detail="Session expired or invalid") from exc
    _set_auth_cookies(response, credentials)
    return RefreshResponse()


@router.get("/session", response_model=CurrentSessionResponse)
def current_session(
    request: Request,
    actor=Depends(get_current_actor),
    db: Session = Depends(get_db),
) -> CurrentSessionResponse:
    row = _current_auth_session(request, db)
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
    current = _current_auth_session(request, db)
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
    _require_recent_mfa(request, db) if is_admin_ui_role(current_user.role) else None
    current_id = _current_auth_session(request, db).id
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
        _clear_auth_cookies(response)


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
    _clear_auth_cookies(response)
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
        _require_recent_mfa(request, db)
    AuthSessionService(db).revoke_all_for_user(current_user, "global_logout")
    audit_service.record_action(
        user=current_user,
        scope="security",
        action="logout_all_sessions",
        entity_type="user",
        entity_id=str(current_user.id),
    )
    _clear_auth_cookies(response)


@router.get("/external-link-requests")
def list_external_link_requests(
    request: Request,
    include_decided: bool = Query(False),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_ui_superadmin),
) -> list[dict[str, Any]]:
    _require_recent_mfa(request, db)
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
    _require_recent_mfa(request, db)
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
    rows = db.query(WebAuthnCredential).filter(
        WebAuthnCredential.user_id == current_user.id,
        WebAuthnCredential.revoked_at.is_(None),
    ).order_by(WebAuthnCredential.created_at.asc()).all()
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
    _require_recent_mfa(request, db)
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
    _clear_auth_cookies(response)


@router.post("/security/webauthn/registration/options")
def profile_webauthn_registration_options(
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    service = WebAuthnService(db)
    if service.has_credentials(current_user.id):
        _require_recent_mfa(request, db)
    else:
        _require_recent_primary_auth(request, db)
    return service.begin_registration(current_user, binding_sid=_current_auth_session(request, db).id)


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
        _require_recent_mfa(request, db)
    else:
        _require_recent_primary_auth(request, db)
    current_session_id = _current_auth_session(request, db).id
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
    _require_recent_mfa(request, db)
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
    _clear_auth_cookies(response)


@router.post("/security/recovery-codes")
def regenerate_recovery_codes(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    audit_service: AuditService = Depends(get_audit_service),
) -> dict[str, list[str]]:
    _require_recent_mfa(request, db)
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
    _clear_auth_cookies(response)
    return {"codes": codes}


@router.get("/admin/sessions", response_model=list[SessionInfo])
def list_all_sessions(
    request: Request,
    include_revoked: bool = Query(False),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_ui_superadmin),
) -> list[SessionInfo]:
    _require_recent_mfa(request, db)
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
    _require_recent_mfa(request, db)
    AuthSessionService(db).revoke_session(session_id, "administrator_revoked")
    audit_service.record_action(
        user=current_user,
        scope="security",
        action="administrator_revoke_session",
        entity_type="auth_session",
        entity_id=session_id,
    )
