# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""LDAP authentication routes."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.auth import AuthenticationResponse
from app.models.ldap import LDAPLoginRequest, LDAPProviderInfo
from app.routers.auth_common import _finish_user_primary_auth, settings
from app.routers.auth_request_context import request_context
from app.routers.dependencies import (
    get_audit_service,
    get_users_service_dependency,
)
from app.services.audit_service import AuditService
from app.services.auth_rate_limit_service import AuthRateLimitService, LoginRateLimitedError
from app.services.external_identity_user_service import ExternalIdentityLinkRequiredError
from app.services.ldap_service import (
    LDAPAuthenticationError,
    LDAPAuthService,
    LDAPConfigurationError,
    LDAPProviderNotFoundError,
    LDAPUserConflictError,
    get_ldap_auth_service,
)
from app.services.users_service import UsersService
from app.utils.http_errors import raise_http_exception_from_exception
from app.utils.request_security import require_trusted_origin


router = APIRouter()


def get_ldap_auth_service_dependency(
    db: Session = Depends(get_db),
) -> LDAPAuthService:
    return get_ldap_auth_service(db)


@router.get("/ldap/providers", response_model=list[LDAPProviderInfo])
def list_ldap_providers(
    ldap_service: LDAPAuthService = Depends(get_ldap_auth_service_dependency),
) -> list[dict[str, str]]:
    return ldap_service.list_providers()


@router.post("/ldap/{provider_id}/login", response_model=AuthenticationResponse)
def login_with_ldap(
    request: Request,
    response: Response,
    provider_id: str,
    payload: LDAPLoginRequest,
    users_service: UsersService = Depends(get_users_service_dependency),
    ldap_service: LDAPAuthService = Depends(get_ldap_auth_service_dependency),
    audit_service: AuditService = Depends(get_audit_service),
) -> AuthenticationResponse:
    require_trusted_origin(request)
    username = (payload.username or "").strip()
    ip_address, user_agent, request_id = request_context(request, settings=settings)
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
