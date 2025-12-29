# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from datetime import timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import get_db
from app.core.security import create_access_token
from app.models.session import S3KeyLogin, SessionDescriptor
from app.models.oidc import (
    OIDCCallbackRequest,
    OIDCProviderInfo,
    OIDCStartRequest,
    OIDCStartResponse,
)
from app.models.user import UserCreate, UserOut
from app.routers.dependencies import get_audit_logger, get_current_super_admin
from app.services.audit_service import AuditService
from app.services.oidc_service import (
    OIDCAuthenticationError,
    OIDCConfigurationError,
    OIDCProviderNotFoundError,
    OIDCStateError,
    OidcService,
    get_oidc_service,
)
from app.services.session_service import SessionIntrospectionError, SessionService
from app.services.users_service import UsersService, get_users_service
from app.services.app_settings_service import load_app_settings
from app.services.storage_endpoints_service import get_storage_endpoints_service

router = APIRouter(prefix="/auth", tags=["auth"])
settings = get_settings()


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


class LoginResponse(Token):
    user: UserOut


class SessionLoginResponse(Token):
    session: SessionDescriptor


class OidcCallbackResponse(LoginResponse):
    redirect_path: Optional[str] = None


@router.post("/register-admin", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def register_admin(
    payload: UserCreate,
    users_service: UsersService = Depends(lambda db=Depends(get_db): get_users_service(db)),
    _: dict = Depends(get_current_super_admin),
) -> UserOut:
    try:
        user = users_service.create_super_admin(payload)
        return users_service.user_to_out(user)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post("/login", response_model=LoginResponse)
def login(
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
    payload: S3KeyLogin,
    db: Session = Depends(get_db),
    audit_service: AuditService = Depends(get_audit_logger),
) -> SessionLoginResponse:
    session_service = SessionService(db)
    endpoint_url = payload.endpoint_url
    if endpoint_url:
        general = load_app_settings().general
        if general.allow_login_custom_endpoint:
            pass
        elif general.allow_login_endpoint_list:
            service = get_storage_endpoints_service(db)
            if not any(endpoint.endpoint_url == endpoint_url for endpoint in service.list_endpoints()):
                endpoint_url = None
        else:
            endpoint_url = None
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
    token = create_access_token({"sid": principal.session_id, "auth_type": "rgw"})
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
        entity_type="rgw_session",
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
