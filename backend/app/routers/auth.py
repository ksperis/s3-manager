# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import hashlib
from typing import Any, Optional

from fastapi import (
    APIRouter,
    Cookie,
    Depends,
    Header,
    HTTPException,
    Request,
    Response,
    status,
)
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import get_db
from app.core.security import decode_typed_token
from app.db import S3Session, User, is_admin_ui_role
from app.models.auth import (
    AuthenticationResponse,
    RecoveryCodeRequest,
    WebAuthnAuthenticationRequest,
    WebAuthnCredentialRequest,
)
from app.models.first_admin_bootstrap import (
    FirstAdminBootstrapCreate,
    FirstAdminBootstrapStatus,
)
from app.models.ldap import LDAPLoginRequest, LDAPProviderInfo
from app.models.oidc import OIDCCallbackRequest, OIDCProviderInfo, OIDCStartRequest, OIDCStartResponse
from app.models.session import S3KeyLogin, SessionDescriptor
from app.models.user import UserCreate, UserOut
from app.routers import auth_api_tokens, auth_sessions
from app.routers.auth_cookies import set_auth_cookies, set_pre_auth_cookie
from app.routers.auth_session_guards import require_recent_mfa
from app.routers.dependencies import (
    get_audit_service,
    get_current_ui_superadmin,
    get_users_service_dependency,
)
from app.services.app_settings_service import load_app_settings
from app.services.audit_service import AuditService
from app.services.auth_rate_limit_service import AuthRateLimitService, LoginRateLimitedError
from app.services.auth_session_service import AuthSessionService
from app.services.external_identity_user_service import ExternalIdentityLinkRequiredError, ExternalIdentityUserService
from app.services.first_admin_bootstrap_service import (
    FirstAdminBootstrapError,
    FirstAdminBootstrapService,
    FirstAdminBootstrapUnavailableError,
)
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


router = APIRouter(prefix="/auth", tags=["auth"])
router.include_router(auth_api_tokens.router)
settings = get_settings()


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
        set_pre_auth_cookie(response, user, "mfa_authentication" if has_passkey else "mfa_enrollment")
        return AuthenticationResponse(status=result_status, user=users_service.user_to_out(user), redirect_path=redirect_path)
    ip_address, user_agent, _ = _request_context(request)
    credentials = AuthSessionService(users_service.db).create_for_user(
        user,
        auth_type=auth_type,
        ip_address=ip_address,
        user_agent=user_agent,
        mfa_verified=False,
    )
    set_auth_cookies(response, credentials)
    return AuthenticationResponse(
        status="authenticated",
        user=users_service.user_to_out(user),
        redirect_path=redirect_path,
    )


@router.get(
    "/bootstrap/first-admin/status",
    response_model=FirstAdminBootstrapStatus,
)
def first_admin_bootstrap_status(
    db: Session = Depends(get_db),
) -> FirstAdminBootstrapStatus:
    return FirstAdminBootstrapStatus(
        available=FirstAdminBootstrapService(db).is_available()
    )


@router.post(
    "/bootstrap/first-admin",
    response_model=AuthenticationResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_first_admin_from_bootstrap(
    request: Request,
    response: Response,
    payload: FirstAdminBootstrapCreate,
    bootstrap_token: Optional[str] = Header(
        None,
        alias="X-BucketReef-Bootstrap-Token",
    ),
    users_service: UsersService = Depends(get_users_service_dependency),
    audit_service: AuditService = Depends(get_audit_service),
) -> AuthenticationResponse:
    require_trusted_origin(request)
    ip_address, user_agent, request_id = _request_context(request)
    limiter = AuthRateLimitService(users_service.db, settings=settings)
    rate_limit_account = "first-admin-bootstrap"
    try:
        limiter.check(account=rate_limit_account, ip_address=ip_address)
    except LoginRateLimitedError as exc:
        audit_service.record_action(
            user=None,
            scope="security",
            action="first_admin_bootstrap_rate_limited",
            entity_type="first_admin_bootstrap",
            status="failure",
            message="First administrator bootstrap rate limit exceeded",
            ip_address=ip_address,
            user_agent=user_agent,
            request_id=request_id,
        )
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many bootstrap attempts. Please try again later.",
            headers={"Retry-After": str(exc.retry_after)},
        ) from exc

    try:
        created = FirstAdminBootstrapService(users_service.db).create_with_token(
            token=bootstrap_token or "",
            email=str(payload.email),
            full_name=payload.full_name,
            password=payload.password,
            ip_address=ip_address,
            user_agent=user_agent,
            request_id=request_id,
        )
    except FirstAdminBootstrapUnavailableError as exc:
        limiter.record_failure(
            account=rate_limit_account,
            ip_address=ip_address,
        )
        audit_service.record_action(
            user=None,
            user_email=str(payload.email).lower(),
            scope="security",
            action="first_admin_bootstrap_failure",
            entity_type="first_admin_bootstrap",
            status="failure",
            message="First administrator bootstrap unavailable",
            ip_address=ip_address,
            user_agent=user_agent,
            request_id=request_id,
        )
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="First administrator bootstrap is unavailable.",
        ) from exc
    except FirstAdminBootstrapError as exc:
        raise_http_exception_from_exception(status.HTTP_400_BAD_REQUEST, exc)
    except ValueError as exc:
        raise_http_exception_from_exception(status.HTTP_400_BAD_REQUEST, exc)

    limiter.clear_account(account=rate_limit_account, ip_address=ip_address)
    user = users_service.get_by_id(created.user_id)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Created administrator is unavailable",
        )
    return _finish_user_primary_auth(
        request=request,
        response=response,
        user=user,
        users_service=users_service,
        auth_type="bootstrap",
    )


@router.post("/register-admin", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def register_admin(
    request: Request,
    payload: UserCreate,
    users_service: UsersService = Depends(get_users_service_dependency),
    current_user: User = Depends(get_current_ui_superadmin),
    audit_service: AuditService = Depends(get_audit_service),
) -> UserOut:
    require_recent_mfa(request, users_service.db)
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
    users_service: UsersService = Depends(get_users_service_dependency),
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
    users_service: UsersService = Depends(get_users_service_dependency),
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
    set_auth_cookies(response, credentials)
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
    users_service: UsersService = Depends(get_users_service_dependency),
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
    set_auth_cookies(response, credentials)
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
    set_auth_cookies(response, credentials)
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
    set_auth_cookies(response, credentials)
    response.delete_cookie(settings.pre_auth_cookie_name, path="/api/auth")
    audit_service.record_action(
        user=user,
        scope="auth",
        action="recovery_code_authentication_success",
        entity_type="ui_session",
        entity_id=credentials.session.id,
    )
    return AuthenticationResponse(status="authenticated", user=get_users_service(db).user_to_out(user))


router.include_router(auth_sessions.router)
