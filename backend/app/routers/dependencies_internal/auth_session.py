# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Optional

from fastapi import Depends, Header, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import get_db
from app.core.security import constant_time_equal, decode_token
from app.db import User, UserRole, is_admin_ui_role, is_superadmin_ui_role
from app.models.session import ManagerSessionPrincipal
from app.services.api_token_service import ApiTokenService
from app.services.session_service import SessionService

from . import service_loaders
from .types import ManagerActor

settings = get_settings()
oauth2_scheme = OAuth2PasswordBearer(tokenUrl=f"{settings.api_v1_prefix}/auth/login")

def _resolve_actor(db: Session, token: str) -> ManagerActor:
    payload = decode_token(token)
    if not payload:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    session_id = payload.get("sid")
    if session_id:
        principal = SessionService(db).get_principal(session_id)
        if not principal:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session expired or invalid")
        return principal
    api_token_user = ApiTokenService(db).resolve_user_from_claims(payload, token=token)
    if api_token_user:
        return api_token_user
    if payload.get("typ") == "api_admin" or payload.get("auth_type") == "api_token":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="API token expired or invalid")
    if "sub" not in payload:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    email = payload["sub"]
    user = db.query(User).filter(User.email == email).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="User inactive")
    return user


def get_current_actor(db: Session = Depends(get_db), token: str = Depends(oauth2_scheme)) -> ManagerActor:
    return _resolve_actor(db, token)


def get_current_user(db: Session = Depends(get_db), token: str = Depends(oauth2_scheme)) -> User:
    actor = _resolve_actor(db, token)
    if isinstance(actor, ManagerSessionPrincipal):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Session token not allowed for this endpoint")
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
    effective = service_loaders.get_effective_access_service(db).resolve_user(user)
    if not is_admin_ui_role(user.role) or not effective.can_access_ceph_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")
    return user


def get_current_storage_ops_admin(user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> User:
    effective = service_loaders.get_effective_access_service(db).resolve_user(user)
    if user.role not in {
        UserRole.UI_SUPERADMIN.value,
        UserRole.UI_ADMIN.value,
        UserRole.UI_USER.value,
    } or not effective.can_access_storage_ops:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")
    return user


def get_current_account_admin(actor: ManagerActor = Depends(get_current_actor)) -> ManagerActor:
    if isinstance(actor, User):
        if actor.role not in {UserRole.UI_SUPERADMIN.value, UserRole.UI_ADMIN.value, UserRole.UI_USER.value}:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")
        return actor
    return actor


def get_current_account_user(user: User = Depends(get_current_user)) -> User:
    if user.role not in {
        UserRole.UI_SUPERADMIN.value,
        UserRole.UI_ADMIN.value,
        UserRole.UI_USER.value,
    }:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")
    return user


def require_internal_cron_token(x_internal_token: Optional[str] = Header(None, alias="X-Internal-Token")) -> None:
    expected = settings.internal_cron_token
    if not expected:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Internal token is not configured")
    if not constant_time_equal(x_internal_token, expected):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid internal token")
