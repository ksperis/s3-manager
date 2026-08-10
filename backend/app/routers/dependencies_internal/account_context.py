# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Optional

from fastapi import Depends, HTTPException, Query, Request, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.access_context import EffectiveAccountLink, ManagerActor
from app.models.account_capabilities import AccountCapabilities
from app.db import S3Account, S3Connection, S3User, StorageEndpoint, User, UserS3Account
from app.models.session import ManagerSessionPrincipal
from app.services import app_settings_service, effective_access_service
from app.services.effective_access_service import EffectiveAccessService
from app.services.s3_execution_context import S3ExecutionContext
from app.services.storage_endpoints_service import get_storage_endpoints_service
from app.utils.s3_connection_capabilities import s3_connection_can_manage_iam
from app.utils.s3_endpoint import normalize_s3_endpoint, resolve_s3_endpoint
from app.utils.time import utcnow

from .auth_session import get_current_actor, settings
from .ceph_admin_context import _resolve_default_endpoint


def _resolve_ceph_admin_browser_context(
    db: Session,
    actor: User,
    endpoint_id: int,
    *,
    surface: str,
) -> S3ExecutionContext:
    from .ceph_admin_context import _resolve_ceph_admin_browser_context as resolve_context

    return resolve_context(db, actor, endpoint_id, surface=surface)


def _is_portal_browser_request(request: Optional[Request], surface: str) -> bool:
    from .portal_access import _is_portal_browser_request as is_portal_browser_request

    return is_portal_browser_request(request, surface)


def _resolve_portal_browser_context(
    db: Session,
    user: User,
    account: S3Account,
    link: UserS3Account | EffectiveAccountLink,
    *,
    request: Request,
) -> S3ExecutionContext:
    from .portal_access import _resolve_portal_browser_context as resolve_context

    return resolve_context(db, user, account, link, request=request)

def _parse_account_selector(account_ref: Optional[str]) -> tuple[Optional[int], Optional[int], Optional[int], Optional[int]]:
    if account_ref is None or account_ref == "":
        return None, None, None, None
    if isinstance(account_ref, str) and account_ref.lower() in {"-1", "null"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid account identifier")
    if isinstance(account_ref, str) and account_ref.startswith("conn-"):
        suffix = account_ref.split("conn-", 1)[1]
        if not suffix.isdigit():
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid connection identifier")
        return None, None, int(suffix), None
    if isinstance(account_ref, str) and account_ref.startswith("s3u-"):
        suffix = account_ref.split("s3u-", 1)[1]
        if not suffix.isdigit():
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid S3 user identifier")
        return None, int(suffix), None, None
    if isinstance(account_ref, str) and account_ref.startswith("ceph-admin-"):
        suffix = account_ref.split("ceph-admin-", 1)[1]
        if not suffix.isdigit():
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid Ceph Admin endpoint identifier")
        return None, None, None, int(suffix)
    try:
        value = int(account_ref)
        if value <= 0:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid account identifier")
        return value, None, None, None
    except (TypeError, ValueError):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid account identifier")


def _build_s3_connection_context(
    connection: S3Connection,
    *,
    capabilities: Optional[AccountCapabilities] = None,
) -> S3ExecutionContext:
    return S3ExecutionContext.from_connection(
        connection,
        manager_capabilities=capabilities,
    )


def _connection_iam_capable(conn: S3Connection) -> bool:
    return s3_connection_can_manage_iam(conn.capabilities_json)


def _build_s3_user_context(
    s3_user: S3User,
    *,
    capabilities: Optional[AccountCapabilities] = None,
) -> S3ExecutionContext:
    return S3ExecutionContext.from_legacy_user(
        s3_user,
        manager_capabilities=capabilities,
    )


def _resolve_s3_user_context(
    db: Session,
    user: User,
    s3_user_id: int,
    *,
    surface: str,
) -> S3ExecutionContext:
    if surface not in {"manager", "manager-browser"}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="S3 users are not available in Browser")
    effective = effective_access_service.EffectiveAccessService(db).resolve_user(user)
    if not effective.has_s3_user(s3_user_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized for this S3 user")
    if surface == "manager-browser" and not effective.can_browse_s3_user(s3_user_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Manager Browser data access is not allowed for this S3 user",
        )

    s3_user = db.query(S3User).filter(S3User.id == s3_user_id).first()
    if not s3_user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="S3 user not found")

    return _build_s3_user_context(
        s3_user,
        capabilities=AccountCapabilities(
            can_manage_buckets=True,
            can_manage_iam=False,
            can_view_root_key=False,
            using_root_key=False,
        ),
    )

def _resolve_connection_context(
    db: Session,
    user: User,
    connection_id: int,
    *,
    surface: str,
    touch_usage: bool = True,
) -> S3ExecutionContext:
    """Resolve a connection through the same policy used by the catalogue."""
    conn = db.query(S3Connection).filter(S3Connection.id == connection_id).first()
    if not conn:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="S3Connection not found")
    service = effective_access_service.EffectiveAccessService(db)
    effective = service.resolve_user(user)
    allowed = (
        service.manager_browser_connection_is_allowed(user, conn)
        if surface == "manager-browser"
        else service.connection_is_allowed(user, conn, workspace=surface, resolved=effective)
    )
    if not allowed:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Connection is not authorized in this workspace")

    # Keep a minimal usage signal for UX (recently used sorting / hints).
    if touch_usage:
        try:
            now = utcnow()
            db.query(S3Connection).filter(S3Connection.id == conn.id).update(
                {S3Connection.last_used_at: now, S3Connection.updated_at: now},
                synchronize_session=False,
            )
            db.commit()
            db.refresh(conn)
        except Exception:
            db.rollback()
    can_manage_iam = _connection_iam_capable(conn)
    return _build_s3_connection_context(
        conn,
        capabilities=AccountCapabilities(
            can_manage_buckets=True,
            can_manage_iam=can_manage_iam,
            can_view_root_key=False,
            using_root_key=False,
        ),
    )

def _resolve_workspace_surface(request: Optional[Request]) -> str:
    if not request:
        return "manager"
    path = str(request.url.path)
    browser_prefix = f"{settings.api_v1_prefix}/browser"
    if path.startswith(browser_prefix):
        if (request.headers.get("X-S3-Workspace") or "").strip().lower() == "manager-browser":
            return "manager-browser"
        return "browser"
    return "manager"


def _resolve_default_account_id(db: Session, user: User) -> int:
    links = effective_access_service.EffectiveAccessService(db).resolve_user(user).account_links
    if len(links) == 1:
        return links[0].account_id
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="S3Account id required")


def _resolve_account_by_id(db: Session, account_id: int) -> S3Account:
    account = db.query(S3Account).filter(S3Account.id == account_id).first()
    if not account:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="S3Account not found")
    return account


def _resolve_user_account_link(
    db: Session,
    user: User,
    account_id: Optional[int],
    allow_default: bool,
) -> tuple[S3Account, UserS3Account | EffectiveAccountLink]:
    if account_id is None or account_id <= 0:
        if not allow_default:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="S3Account id required")
        account_id = _resolve_default_account_id(db, user)
    account = _resolve_account_by_id(db, account_id)
    link = effective_access_service.EffectiveAccessService(db).resolve_user(user).account_link_for(account.id)
    if not link:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized for this account")
    return account, link


def manager_membership_capabilities(
    link: UserS3Account | EffectiveAccountLink,
) -> AccountCapabilities:
    is_account_admin = EffectiveAccessService.manager_account_allowed(link.role)
    if not is_account_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized for this account")
    return AccountCapabilities(
        can_manage_buckets=True,
        can_manage_iam=True,
        can_view_root_key=True,
        using_root_key=True,
    )


def _resolve_session_account(
    db: Session,
    actor: ManagerSessionPrincipal,
    account_id: Optional[int],
    requested_endpoint: Optional[str] = None,
) -> S3ExecutionContext:
    if not actor.account_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="S3Account context unavailable for session")
    account: Optional[S3Account] = None
    if account_id and account_id > 0:
        account = _resolve_account_by_id(db, account_id)
        if account.rgw_account_id and account.rgw_account_id.lower() != actor.account_id.lower():
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized for this account")
    else:
        account = (
            db.query(S3Account)
            .filter(S3Account.rgw_account_id == actor.account_id)
            .first()
        )
    context_name = account.name if account is not None else actor.account_name or actor.account_id
    context_rgw_account_id = account.rgw_account_id if account is not None else actor.account_id
    context_rgw_user_uid = account.rgw_user_uid if account is not None else actor.user_uid
    context_email = account.email if account is not None else None
    context_endpoint = account.storage_endpoint if account is not None else None
    context_endpoint_id = account.storage_endpoint_id if account is not None else None
    resolved_endpoint: Optional[StorageEndpoint] = None
    if not requested_endpoint and not resolve_s3_endpoint(account):
        endpoint = _resolve_default_endpoint(db)
        requested_endpoint = endpoint.endpoint_url
        resolved_endpoint = endpoint
    elif requested_endpoint:
        resolved_endpoint = (
            db.query(StorageEndpoint)
            .filter(StorageEndpoint.endpoint_url == requested_endpoint)
            .first()
        )
    if resolved_endpoint:
        context_endpoint_id = resolved_endpoint.id
        context_endpoint = resolved_endpoint
    return S3ExecutionContext(
        context_id=str(account.id) if account is not None else f"session:{actor.account_id}",
        context_kind="session",
        id=account.id if account is not None else None,
        name=context_name,
        rgw_account_id=context_rgw_account_id,
        email=context_email,
        rgw_user_uid=context_rgw_user_uid,
        access_key=actor.access_key,
        secret_key=actor.secret_key,
        storage_endpoint_id=context_endpoint_id,
        storage_endpoint=context_endpoint,
        session_endpoint=requested_endpoint,
        manager_capabilities=AccountCapabilities(
            can_manage_buckets=actor.capabilities.can_manage_buckets,
            can_manage_iam=actor.capabilities.can_manage_iam,
            can_view_root_key=False,
            using_root_key=False,
        ),
    )


def _resolve_requested_session_endpoint(
    db: Session,
    actor: ManagerSessionPrincipal,
    requested_endpoint: Optional[str],
) -> Optional[str]:
    pinned_endpoint = normalize_s3_endpoint(getattr(actor.capabilities, "endpoint_url", None))
    if pinned_endpoint:
        if requested_endpoint and requested_endpoint != pinned_endpoint:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Endpoint override is not allowed for this session")
        return pinned_endpoint
    if not requested_endpoint:
        return None
    general = app_settings_service.load_app_settings().general
    if general.allow_login_custom_endpoint:
        return requested_endpoint
    if general.allow_login_endpoint_list:
        service = get_storage_endpoints_service(db)
        if any(endpoint.endpoint_url == requested_endpoint for endpoint in service.list_endpoints()):
            return requested_endpoint
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Endpoint is not allowed for this session")


def get_account_context(
    request: Request,
    account_ref: Optional[str] = Query(default=None, alias="account_id"),
    actor: ManagerActor = Depends(get_current_actor),
    db: Session = Depends(get_db),
) -> S3ExecutionContext:
    account_id, s3_user_id, connection_id, ceph_admin_endpoint_id = _parse_account_selector(account_ref)
    surface = _resolve_workspace_surface(request)
    requested_endpoint = normalize_s3_endpoint(request.headers.get("X-S3-Endpoint")) if request else None
    if isinstance(actor, ManagerSessionPrincipal):
        requested_endpoint = _resolve_requested_session_endpoint(db, actor, requested_endpoint)
    else:
        # UI users are bound to the endpoint configured on the selected account.
        requested_endpoint = None
    is_storage_ops_surface = bool(request and str(request.url.path).startswith(f"{settings.api_v1_prefix}/storage-ops"))
    if isinstance(actor, User):
        if ceph_admin_endpoint_id is not None:
            if surface == "manager-browser":
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Ceph Admin contexts are not available in Manager Browser",
                )
            return _resolve_ceph_admin_browser_context(db, actor, ceph_admin_endpoint_id, surface=surface)
        if connection_id is not None:
            return _resolve_connection_context(
                db,
                actor,
                connection_id,
                surface=surface,
                touch_usage=not is_storage_ops_surface,
            )
        if s3_user_id is not None:
            return _resolve_s3_user_context(db, actor, s3_user_id, surface=surface)
        if surface == "browser" and not _is_portal_browser_request(request, surface):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Accounts are not available in standard Browser",
            )
        account, link = _resolve_user_account_link(db, actor, account_id, allow_default=False)
        if _is_portal_browser_request(request, surface):
            return _resolve_portal_browser_context(db, actor, account, link, request=request)
        if surface == "manager-browser" and not (
            isinstance(link, EffectiveAccountLink) and link.manager_browser_allowed
        ):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Manager Browser data access requires account administrator and explicit data access on the same association",
            )
        capabilities = manager_membership_capabilities(link)
        if not capabilities.can_manage_buckets:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized for this account")
        access_key, secret_key = account.effective_rgw_credentials()
        if not access_key or not secret_key:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Admin credentials are not configured for this account",
            )
        return S3ExecutionContext.from_account(
            account,
            access_key=access_key,
            secret_key=secret_key,
            manager_capabilities=capabilities,
        )

    if s3_user_id is not None or connection_id is not None or ceph_admin_endpoint_id is not None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Sessions cannot assume this context")

    if surface == "manager-browser" and not actor.capabilities.access_browser:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Browser access is not allowed for this session",
        )
    return _resolve_session_account(db, actor, account_id, requested_endpoint=requested_endpoint)
