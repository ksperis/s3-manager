# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Password and first-administrator authentication routes."""

from __future__ import annotations

from typing import Optional

from fastapi import (
    APIRouter,
    Depends,
    Header,
    HTTPException,
    Request,
    Response,
    status,
)
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.auth import AuthenticationResponse
from app.models.first_admin_bootstrap import (
    FirstAdminBootstrapCreate,
    FirstAdminBootstrapStatus,
)
from app.routers.auth_common import _finish_user_primary_auth, settings
from app.routers.auth_request_context import request_context
from app.routers.dependencies import (
    get_audit_service,
    get_users_service_dependency,
)
from app.services.audit_service import AuditService
from app.services.auth_rate_limit_service import AuthRateLimitService, LoginRateLimitedError
from app.services.first_admin_bootstrap_service import (
    FirstAdminBootstrapError,
    FirstAdminBootstrapService,
    FirstAdminBootstrapUnavailableError,
)
from app.services.users_service import UsersService
from app.utils.http_errors import raise_http_exception_from_exception
from app.utils.request_security import require_trusted_origin


router = APIRouter()


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
    ip_address, user_agent, request_id = request_context(request, settings=settings)
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
    ip_address, user_agent, request_id = request_context(request, settings=settings)
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
