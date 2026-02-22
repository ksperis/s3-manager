# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from datetime import timedelta
from typing import Optional

from fastapi import APIRouter, Cookie, Depends, HTTPException, Query, Response, status
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import get_db
from app.core.security import create_access_token
from app.db import User
from app.models.api_token import ApiTokenCreateRequest, ApiTokenCreateResponse, ApiTokenInfo
from app.models.session import S3KeyLogin, SessionDescriptor
from app.models.oidc import (
    OIDCCallbackRequest,
    OIDCProviderInfo,
    OIDCStartRequest,
    OIDCStartResponse,
)
from app.models.user import UserCreate, UserOut
from app.routers.dependencies import get_audit_logger, get_current_super_admin, get_current_ui_superadmin
from app.services.audit_service import AuditService
from app.services.api_token_service import ApiTokenError, ApiTokenNotFoundError, ApiTokenService
from app.services.oidc_service import (
    OIDCAuthenticationError,
    OIDCConfigurationError,
    OIDCProviderNotFoundError,
    OIDCStateError,
    OidcService,
    get_oidc_service,
)
from app.services.session_service import SessionIntrospectionError, SessionService
from app.services.refresh_session_service import RefreshSessionService
from app.services.users_service import UsersService, get_users_service
from app.services.app_settings_service import load_app_settings
from app.services.storage_endpoints_service import get_storage_endpoints_service

router = APIRouter(prefix="/auth", tags=["auth"])
settings = get_settings()


def _set_refresh_cookie(response: Response, token: str) -> None:
    max_age = settings.refresh_token_expire_minutes * 60
    response.set_cookie(
        key=settings.refresh_token_cookie_name,
        value=token,
        max_age=max_age,
        expires=max_age,
        httponly=True,
        secure=settings.refresh_token_cookie_secure,
        samesite=settings.refresh_token_cookie_samesite,
        path=settings.refresh_token_cookie_path,
        domain=settings.refresh_token_cookie_domain,
    )


def _clear_refresh_cookie(response: Response) -> None:
    response.delete_cookie(
        key=settings.refresh_token_cookie_name,
        path=settings.refresh_token_cookie_path,
        domain=settings.refresh_token_cookie_domain,
    )


def _to_api_token_info(payload) -> ApiTokenInfo:
    return ApiTokenInfo(
        id=payload.id,
        name=payload.name,
        created_at=payload.created_at,
        last_used_at=payload.last_used_at,
        expires_at=payload.expires_at,
        revoked_at=payload.revoked_at,
    )


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


class LoginResponse(Token):
    user: UserOut


class SessionLoginResponse(Token):
    session: SessionDescriptor


class OidcCallbackResponse(LoginResponse):
    redirect_path: Optional[str] = None


@router.get("/api-tokens", response_model=list[ApiTokenInfo])
def list_api_tokens(
    include_revoked: bool = Query(False),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_super_admin),
) -> list[ApiTokenInfo]:
    service = ApiTokenService(db)
    rows = service.list_for_user(current_user.id, include_revoked=include_revoked)
    return [_to_api_token_info(row) for row in rows]


@router.post("/api-tokens", response_model=ApiTokenCreateResponse, status_code=status.HTTP_201_CREATED)
def create_api_token(
    payload: ApiTokenCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_super_admin),
    audit_service: AuditService = Depends(get_audit_logger),
) -> ApiTokenCreateResponse:
    service = ApiTokenService(db)
    try:
        token, row = service.create_for_user(
            current_user,
            name=payload.name,
            expires_in_days=payload.expires_in_days,
        )
    except ApiTokenError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    audit_service.record_action(
        user=current_user,
        scope="auth",
        action="create_api_token",
        entity_type="api_token",
        entity_id=row.id,
        metadata={
            "name": row.name,
            "expires_at": row.expires_at.isoformat(),
        },
    )
    return ApiTokenCreateResponse(access_token=token, api_token=_to_api_token_info(row))


@router.delete("/api-tokens/{token_id}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_api_token(
    token_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_super_admin),
    audit_service: AuditService = Depends(get_audit_logger),
) -> None:
    service = ApiTokenService(db)
    try:
        row = service.revoke_for_user(user_id=current_user.id, token_id=token_id)
    except ApiTokenNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
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
    payload: UserCreate,
    users_service: UsersService = Depends(lambda db=Depends(get_db): get_users_service(db)),
    _: dict = Depends(get_current_ui_superadmin),
) -> UserOut:
    try:
        user = users_service.create_super_admin(payload)
        return users_service.user_to_out(user)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post("/login", response_model=LoginResponse)
def login(
    response: Response,
    form_data: OAuth2PasswordRequestForm = Depends(),
    users_service: UsersService = Depends(lambda db=Depends(get_db): get_users_service(db)),
    audit_service: AuditService = Depends(get_audit_logger),
) -> LoginResponse:
    user = users_service.authenticate(form_data.username, form_data.password)
    if not user:
        existing_user = users_service.get_by_email(form_data.username)
        audit_service.record_action(
            user=existing_user,
            user_email=form_data.username,
            user_role=existing_user.role if existing_user else None,
            scope="auth",
            action="login_failure",
            entity_type="ui_session",
            status="failure",
            message="Invalid credentials",
            metadata={"username": form_data.username},
        )
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    access_token_expires = timedelta(minutes=settings.access_token_expire_minutes)
    token = create_access_token(
        data={"sub": user.email, "role": user.role, "uid": user.id},
        expires_delta=access_token_expires,
    )
    refresh_service = RefreshSessionService(users_service.db)
    refresh_token, _ = refresh_service.create_for_user(user.id, auth_type="password")
    _set_refresh_cookie(response, refresh_token)
    audit_service.record_action(
        user=user,
        scope="auth",
        action="login_success",
        entity_type="ui_session",
        metadata={"role": user.role, "username": user.email},
    )
    return LoginResponse(access_token=token, user=users_service.user_to_out(user))


@router.post("/login-s3", response_model=SessionLoginResponse)
def login_with_s3_keys(
    response: Response,
    payload: S3KeyLogin,
    db: Session = Depends(get_db),
    audit_service: AuditService = Depends(get_audit_logger),
) -> SessionLoginResponse:
    session_service = SessionService(db)
    general = load_app_settings().general
    if not general.allow_login_access_keys:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access-key login is disabled")
    endpoint_url = payload.endpoint_url
    endpoint_provided = bool(endpoint_url)
    if endpoint_url:
        if general.allow_login_custom_endpoint:
            pass
        elif general.allow_login_endpoint_list:
            service = get_storage_endpoints_service(db)
            if not any(endpoint.endpoint_url == endpoint_url for endpoint in service.list_endpoints()):
                endpoint_url = None
        else:
            endpoint_url = None
    if not endpoint_url and not endpoint_provided:
        service = get_storage_endpoints_service(db)
        endpoint_url = service.get_default_endpoint_url()
    try:
        actor_type, account_id, account_name, user_uid, capabilities = session_service.introspect_credentials(
            payload.access_key,
            payload.secret_key,
            endpoint_url,
        )
    except SessionIntrospectionError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc

    principal = session_service.create_session(
        access_key=payload.access_key,
        secret_key=payload.secret_key,
        actor_type=actor_type,
        account_id=account_id,
        account_name=account_name,
        user_uid=user_uid,
        capabilities=capabilities,
    )
    access_token_expires = timedelta(minutes=settings.access_token_expire_minutes)
    token = create_access_token(
        {"sid": principal.session_id, "auth_type": "s3_session"},
        expires_delta=access_token_expires,
    )
    refresh_service = RefreshSessionService(db)
    refresh_token, _ = refresh_service.create_for_s3_session(principal.session_id, auth_type="s3_session")
    _set_refresh_cookie(response, refresh_token)
    descriptor = SessionDescriptor(
        session_id=principal.session_id,
        actor_type=principal.actor_type,
        account_id=principal.account_id,
        account_name=principal.account_name,
        user_uid=principal.user_uid,
        capabilities=principal.capabilities,
    )
    email, role = principal.audit_fallbacks()
    audit_service.record_action(
        user=None,
        user_email=email,
        user_role=role,
        scope="auth",
        action="login_s3",
        entity_type="s3_session",
        metadata={
            "actor_type": principal.actor_type,
            "account_id": principal.account_id,
        },
    )
    return SessionLoginResponse(access_token=token, session=descriptor)


@router.get("/oidc/providers", response_model=list[OIDCProviderInfo])
def list_oidc_providers(
    oidc_service: OidcService = Depends(lambda db=Depends(get_db): get_oidc_service(db)),
) -> list[OIDCProviderInfo]:
    return oidc_service.list_providers()


@router.post("/oidc/{provider_id}/start", response_model=OIDCStartResponse)
def start_oidc_login(
    provider_id: str,
    payload: Optional[OIDCStartRequest] = None,
    oidc_service: OidcService = Depends(lambda db=Depends(get_db): get_oidc_service(db)),
) -> dict[str, str]:
    redirect_path = payload.redirect_path if payload else None
    try:
        return oidc_service.start_login(provider_id, redirect_path)
    except OIDCProviderNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except OIDCConfigurationError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post("/oidc/{provider_id}/callback", response_model=OidcCallbackResponse)
def complete_oidc_login(
    response: Response,
    provider_id: str,
    payload: OIDCCallbackRequest,
    oidc_service: OidcService = Depends(lambda db=Depends(get_db): get_oidc_service(db)),
    users_service: UsersService = Depends(lambda db=Depends(get_db): get_users_service(db)),
    audit_service: AuditService = Depends(get_audit_logger),
) -> OidcCallbackResponse:
    try:
        user, redirect_path, created = oidc_service.complete_login(provider_id, payload.code, payload.state)
    except OIDCProviderNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except OIDCStateError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except (OIDCConfigurationError, OIDCAuthenticationError) as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc

    access_token_expires = timedelta(minutes=settings.access_token_expire_minutes)
    token = create_access_token(
        data={
            "sub": user.email,
            "role": user.role,
            "uid": user.id,
            "auth_type": "oidc",
            "provider": provider_id.lower(),
        },
        expires_delta=access_token_expires,
    )
    refresh_service = RefreshSessionService(users_service.db)
    refresh_token, _ = refresh_service.create_for_user(user.id, auth_type="oidc")
    _set_refresh_cookie(response, refresh_token)
    audit_service.record_action(
        user=user,
        scope="auth",
        action="login_oidc_success",
        entity_type="ui_session",
        metadata={
            "provider": provider_id.lower(),
            "email": user.email,
            "created": created,
        },
    )
    return OidcCallbackResponse(access_token=token, user=users_service.user_to_out(user), redirect_path=redirect_path)


@router.post("/refresh", response_model=Token)
def refresh_access_token(
    response: Response,
    db: Session = Depends(get_db),
    refresh_token: Optional[str] = Cookie(None, alias=settings.refresh_token_cookie_name),
) -> Token:
    if not refresh_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing refresh token")
    refresh_service = RefreshSessionService(db)
    session = refresh_service.get_by_token(refresh_token)
    if not session or refresh_service.is_expired(session):
        if session:
            refresh_service.revoke(session)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token")
    access_token_expires = timedelta(minutes=settings.access_token_expire_minutes)
    if session.user_id:
        user = db.query(User).filter(User.id == session.user_id).first()
        if not user or not user.is_active:
            refresh_service.revoke(session)
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not available")
        token = create_access_token(
            data={"sub": user.email, "role": user.role, "uid": user.id},
            expires_delta=access_token_expires,
        )
    elif session.s3_session_id:
        principal = SessionService(db).get_principal(session.s3_session_id)
        if not principal:
            refresh_service.revoke(session)
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session expired or invalid")
        token = create_access_token(
            data={"sid": principal.session_id, "auth_type": "s3_session"},
            expires_delta=access_token_expires,
        )
    else:
        refresh_service.revoke(session)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid session")
    new_refresh_token = refresh_service.rotate(session)
    _set_refresh_cookie(response, new_refresh_token)
    return Token(access_token=token)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(
    response: Response,
    db: Session = Depends(get_db),
    refresh_token: Optional[str] = Cookie(None, alias=settings.refresh_token_cookie_name),
) -> None:
    if refresh_token:
        refresh_service = RefreshSessionService(db)
        session = refresh_service.get_by_token(refresh_token)
        if session:
            refresh_service.revoke(session)
    _clear_refresh_cookie(response)
