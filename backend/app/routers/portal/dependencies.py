# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from dataclasses import dataclass

from fastapi import Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.db_models import IamIdentity, PortalMembership, PortalRoleKey, S3Account, S3AccountKind, StorageEndpoint, User
from app.routers.dependencies import get_current_account_user
from app.services.portal_rbac_service import PortalRbacService
from app.utils.storage_endpoint_features import resolve_feature_flags


@dataclass(frozen=True)
class PortalEndpointCapabilities:
    sts_enabled: bool
    presign_enabled: bool
    allow_external_access: bool
    max_session_duration: int
    allowed_packages: tuple[str, ...]


@dataclass(frozen=True)
class PortalContext:
    actor: User
    account: S3Account
    membership: PortalMembership
    role_key: str
    permissions: frozenset[str]
    endpoint: StorageEndpoint
    endpoint_capabilities: PortalEndpointCapabilities
    external_enabled: bool

    def can(self, permission: str) -> bool:
        return permission in self.permissions


def _resolve_portal_account_id(db: Session, user: User, account_id: int | None) -> int:
    if account_id is not None:
        if account_id <= 0:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid account_id")
        return account_id
    memberships = (
        db.query(PortalMembership)
        .join(S3Account, S3Account.id == PortalMembership.account_id)
        .filter(
            PortalMembership.user_id == user.id,
            S3Account.kind == S3AccountKind.IAM_ACCOUNT.value,
        )
        .all()
    )
    if len(memberships) == 1:
        return memberships[0].account_id
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="account_id is required")


def get_portal_context(
    account_id: int | None = Query(default=None, alias="account_id"),
    user: User = Depends(get_current_account_user),
    db: Session = Depends(get_db),
) -> PortalContext:
    resolved_account_id = _resolve_portal_account_id(db, user, account_id)
    account = db.query(S3Account).filter(S3Account.id == resolved_account_id).first()
    if not account:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account not found")
    if account.kind != S3AccountKind.IAM_ACCOUNT.value:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal supports IAM accounts only")
    membership = (
        db.query(PortalMembership)
        .filter(PortalMembership.user_id == user.id, PortalMembership.account_id == account.id)
        .first()
    )
    if not membership:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized for this account")
    endpoint = getattr(account, "storage_endpoint", None)
    if endpoint is None and getattr(account, "storage_endpoint_id", None):
        endpoint = db.query(StorageEndpoint).filter(StorageEndpoint.id == account.storage_endpoint_id).first()
    if not endpoint:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Storage endpoint is not configured")

    permissions = frozenset(PortalRbacService(db).permissions_for_user(user_id=user.id, account_id=account.id))
    role_key = membership.role_key or PortalRoleKey.VIEWER.value
    flags = resolve_feature_flags(endpoint)
    allowed_packages = endpoint.allowed_packages or []
    if not isinstance(allowed_packages, list):
        allowed_packages = []
    endpoint_caps = PortalEndpointCapabilities(
        sts_enabled=bool(flags.sts_enabled),
        presign_enabled=bool(getattr(endpoint, "presign_enabled", True)),
        allow_external_access=bool(getattr(endpoint, "allow_external_access", False)),
        max_session_duration=int(getattr(endpoint, "max_session_duration", 3600) or 3600),
        allowed_packages=tuple(str(p) for p in allowed_packages if isinstance(p, str) and p.strip()),
    )
    identity = (
        db.query(IamIdentity)
        .filter(IamIdentity.user_id == user.id, IamIdentity.account_id == account.id, IamIdentity.is_enabled.is_(True))
        .first()
    )
    external_enabled = bool(identity and (identity.iam_username or identity.iam_user_id))
    return PortalContext(
        actor=user,
        account=account,
        membership=membership,
        role_key=role_key,
        permissions=permissions,
        endpoint=endpoint,
        endpoint_capabilities=endpoint_caps,
        external_enabled=external_enabled,
    )


def require_portal_permission(permission: str):
    def _dep(ctx: PortalContext = Depends(get_portal_context)) -> PortalContext:
        if not ctx.can(permission):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")
        return ctx

    return _dep
