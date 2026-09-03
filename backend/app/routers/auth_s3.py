# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Direct S3 credential authentication routes."""

from __future__ import annotations

import hashlib

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.db import S3Session
from app.models.auth import AuthenticationResponse
from app.models.session import S3KeyLogin, SessionDescriptor
from app.routers.auth_common import settings
from app.routers.auth_cookies import set_auth_cookies
from app.routers.auth_request_context import request_context
from app.routers.dependencies import get_audit_service
from app.services.app_settings_service import load_app_settings
from app.services.audit_service import AuditService
from app.services.auth_rate_limit_service import AuthRateLimitService, LoginRateLimitedError
from app.services.auth_session_service import AuthSessionService
from app.services.session_service import SessionIntrospectionError, SessionService
from app.services.storage_endpoints_service import get_storage_endpoints_service
from app.utils.request_security import require_trusted_origin
from app.utils.s3_endpoint import validate_custom_login_s3_endpoint


router = APIRouter()


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
    ip_address, user_agent, request_id = request_context(request, settings=settings)
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
