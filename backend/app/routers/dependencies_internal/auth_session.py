# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Optional

from fastapi import Depends, Header, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import get_db
from app.core.security import constant_time_equal, decode_typed_token
from app.db import AuthSession, User, UserRole, is_admin_ui_role, is_superadmin_ui_role
from app.models.access_context import ManagerActor
from app.models.session import ManagerSessionPrincipal
from app.services import effective_access_service
from app.services.api_token_service import ApiTokenService
from app.services.auth_session_service import AuthSessionError, AuthSessionService
from app.services.session_service import SessionService
from app.utils.request_security import require_trusted_origin


settings = get_settings()
bearer_scheme = HTTPBearer(auto_error=False)
_UNSAFE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


def _required_api_scope(request: Request) -> Optional[str]:
    path = request.url.path
    access = "read" if request.method in {"GET", "HEAD", "OPTIONS"} else "write"
    mappings = (
        (f"{settings.api_v1_prefix}/admin/", "admin"),
        (f"{settings.api_v1_prefix}/manager/", "manager"),
        (f"{settings.api_v1_prefix}/browser", "browser"),
        (f"{settings.api_v1_prefix}/portal", "portal"),
        (f"{settings.api_v1_prefix}/ceph-admin/", "ceph-admin"),
        (f"{settings.api_v1_prefix}/storage-ops", "storage-ops"),
        (f"{settings.api_v1_prefix}/users/me", "profile"),
        (f"{settings.api_v1_prefix}/me", "profile"),
        (f"{settings.api_v1_prefix}/connections", "browser"),
    )
    for prefix, domain in mappings:
        if path == prefix.rstrip("/") or path.startswith(prefix):
            return f"{domain}:{access}"
    return None


def _resolve_bearer(db: Session, token: str, request: Request) -> User:
    claims = decode_typed_token(token, expected_type="api_access")
    if claims is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid API token")
    required_scope = _required_api_scope(request)
    if required_scope is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="API tokens are not allowed for this route")
    user = ApiTokenService(db).resolve_user_from_claims(claims, token=token)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="API token expired or revoked")
    if required_scope not in (claims.get("scopes") or []):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="API token scope is insufficient")
    return user


def _resolve_cookie(db: Session, token: str, request: Request) -> ManagerActor:
    claims = decode_typed_token(token, expected_type="ui_access")
    token_type = "ui_access"
    if claims is None:
        claims = decode_typed_token(token, expected_type="s3_access")
        token_type = "s3_access"
    if claims is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid UI session")
    try:
        auth_session, principal = AuthSessionService(db).validate_access(
            str(claims["sid"]),
            expected_type=token_type,
        )
    except AuthSessionError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session expired or invalid") from exc
    if claims.get("auth_version") != auth_session.auth_version:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session authentication version changed")
    if request.method in _UNSAFE_METHODS:
        require_trusted_origin(request)
        submitted = request.headers.get("x-csrf-token")
        cookie_value = request.cookies.get(settings.csrf_cookie_name)
        if not submitted or not constant_time_equal(submitted, cookie_value):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid CSRF token")
        if not AuthSessionService(db).validate_csrf(auth_session, submitted):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid CSRF token")
    if token_type == "s3_access":
        return SessionService(db)._to_principal(principal)
    return principal


def get_current_actor(
    request: Request,
    db: Session = Depends(get_db),
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
) -> ManagerActor:
    cookie_token = request.cookies.get(settings.access_token_cookie_name)
    bearer_token = credentials.credentials if credentials else None
    if cookie_token and bearer_token:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cookie and Bearer authentication cannot be combined")
    if bearer_token:
        return _resolve_bearer(db, bearer_token, request)
    if cookie_token:
        return _resolve_cookie(db, cookie_token, request)
    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")


def get_current_user(actor: ManagerActor = Depends(get_current_actor)) -> User:
    if isinstance(actor, ManagerSessionPrincipal):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="S3 session not allowed for this endpoint")
    return actor


def get_current_super_admin(user: User = Depends(get_current_user)) -> User:
    if not is_admin_ui_role(user.role):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")
    return user


def get_current_ui_superadmin(user: User = Depends(get_current_user)) -> User:
    if not is_superadmin_ui_role(user.role):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")
    return user


def get_current_ceph_admin(user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> User:
    effective = effective_access_service.EffectiveAccessService(db).resolve_user(user)
    if not is_admin_ui_role(user.role) or not effective.can_access_ceph_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")
    return user


def get_current_storage_ops_admin(user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> User:
    effective = effective_access_service.EffectiveAccessService(db).resolve_user(user)
    if user.role not in {UserRole.UI_SUPERADMIN.value, UserRole.UI_ADMIN.value, UserRole.UI_USER.value} or not effective.can_access_storage_ops:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")
    return user


def get_current_account_admin(actor: ManagerActor = Depends(get_current_actor)) -> ManagerActor:
    if isinstance(actor, User) and actor.role not in {
        UserRole.UI_SUPERADMIN.value,
        UserRole.UI_ADMIN.value,
        UserRole.UI_USER.value,
    }:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")
    return actor


def get_current_account_user(user: User = Depends(get_current_user)) -> User:
    if user.role not in {UserRole.UI_SUPERADMIN.value, UserRole.UI_ADMIN.value, UserRole.UI_USER.value}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")
    return user


def require_internal_cron_token(x_internal_token: Optional[str] = Header(None, alias="X-Internal-Token")) -> None:
    expected = settings.internal_cron_token
    if not expected:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Internal token is not configured")
    if not constant_time_equal(x_internal_token, expected):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid internal token")
