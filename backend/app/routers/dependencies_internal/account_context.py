# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Optional

from fastapi import Depends, HTTPException, Query, Request, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.db import S3Account, S3Connection, S3User, StorageEndpoint, User, UserS3Account
from app.models.session import ManagerSessionPrincipal
from app.routers.dependencies_internal.settings_loader import load_app_settings
from app.services.effective_access_service import EffectiveAccountLink
from app.services.storage_endpoints_service import get_storage_endpoints_service
from app.utils.s3_connection_capabilities import s3_connection_can_manage_iam
from app.utils.s3_connection_endpoint import resolve_connection_endpoint
from app.utils.s3_endpoint import normalize_s3_endpoint, resolve_s3_endpoint
from app.utils.time import utcnow

from .auth_session import get_current_actor, settings
from .ceph_admin_context import _resolve_default_endpoint
from .service_loaders import get_effective_access_service
from .types import AccountAccess, AccountCapabilities, ManagerActor


def _resolve_ceph_admin_browser_context(db: Session, actor: User, endpoint_id: int, *, surface: str) -> S3Account:
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
) -> S3Account:
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


def _build_s3_connection_account(conn: S3Connection) -> S3Account:
    """Builds an S3Account-like context for a user-scoped connection.

    We intentionally keep manager routers and services working with S3Account
    for now. This wrapper is an implementation detail and must remain hidden
    from the admin UX.
    """
    account = S3Account(
        name=conn.name,
        rgw_account_id=None,
        email=None,
        rgw_user_uid=None,
    )
    # Use an out-of-band negative id range to avoid clashes with s3_users.
    account.id = -(1_000_000 + conn.id)
    account.rgw_access_key = conn.access_key_id
    account.rgw_secret_key = conn.secret_access_key
    account.storage_endpoint_id = conn.storage_endpoint_id
    account.storage_endpoint = conn.storage_endpoint
    # Let resolve_s3_endpoint() pick it up.
    endpoint_url, region, force_path_style, verify_tls = resolve_connection_endpoint(conn)
    account.storage_endpoint_url = endpoint_url  # type: ignore[attr-defined]
    account._session_region = region  # type: ignore[attr-defined]
    account._session_force_path_style = force_path_style  # type: ignore[attr-defined]
    account._session_verify_tls = verify_tls  # type: ignore[attr-defined]
    account.s3_connection_id = conn.id  # type: ignore[attr-defined]
    account._session_token = conn.session_token  # type: ignore[attr-defined]
    account._source_connection = conn  # type: ignore[attr-defined]
    return account


def _connection_iam_capable(conn: S3Connection) -> bool:
    return s3_connection_can_manage_iam(getattr(conn, "capabilities_json", None))


def _build_s3_user_account(s3_user: S3User) -> S3Account:
    account = S3Account(
        name=s3_user.name,
        rgw_account_id=None,
        email=s3_user.email,
        rgw_user_uid=s3_user.rgw_user_uid,
    )
    # Keep an out-of-band negative id to avoid collisions with RGW account ids.
    account.id = -(100_000 + s3_user.id)
    account.rgw_access_key = s3_user.rgw_access_key
    account.rgw_secret_key = s3_user.rgw_secret_key
    account.storage_endpoint_id = s3_user.storage_endpoint_id
    account.storage_endpoint = s3_user.storage_endpoint
    account.allow_manager_bucket_quota = bool(s3_user.allow_manager_bucket_quota)
    account.allow_manager_ceph_s3_user_keys = bool(s3_user.allow_manager_ceph_s3_user_keys)  # type: ignore[attr-defined]
    account.s3_user_id = s3_user.id  # type: ignore[attr-defined]
    return account


def _resolve_s3_user_context(db: Session, user: User, s3_user_id: int) -> S3Account:
    effective = get_effective_access_service(db).resolve_user(user)
    if not effective.has_s3_user(s3_user_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized for this S3 user")

    s3_user = db.query(S3User).filter(S3User.id == s3_user_id).first()
    if not s3_user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="S3 user not found")

    account = _build_s3_user_account(s3_user)
    account.set_session_credentials(s3_user.rgw_access_key, s3_user.rgw_secret_key)
    account._manager_capabilities = AccountCapabilities(  # type: ignore[attr-defined]
        can_manage_buckets=True,
        can_manage_iam=False,
        can_view_root_key=False,
        using_root_key=False,
    )
    return account

def _resolve_connection_context(
    db: Session,
    user: User,
    connection_id: int,
    *,
    surface: str,
    touch_usage: bool = True,
) -> S3Account:
    """Resolve an S3Connection context.

    Access is granted if:
    - user is the creator for private connections, or
    - the user is explicitly linked for shared connections.
    """
    conn = db.query(S3Connection).filter(S3Connection.id == connection_id).first()
    if not conn:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="S3Connection not found")
    if not bool(conn.is_active):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="S3Connection is disabled")
    if conn.is_temporary and conn.expires_at and conn.expires_at <= utcnow():
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="S3Connection expired")
    if surface == "manager" and not bool(conn.access_manager):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="This S3Connection cannot be used in manager workspace")
    if surface == "browser" and not bool(conn.access_browser):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="This S3Connection cannot be used in browser workspace")
    if not conn.is_shared and conn.created_by_user_id != user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized for this connection")
    if conn.is_shared:
        effective = get_effective_access_service(db).resolve_user(user)
        if not effective.has_s3_connection(conn.id):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized for this connection")

    # Keep a minimal usage signal for UX (recently used sorting / hints).
    if touch_usage:
        try:
            now = utcnow()
            conn.last_used_at = now
            conn.updated_at = now
            db.commit()
        except Exception:
            db.rollback()
    account = _build_s3_connection_account(conn)
    account.set_session_credentials(conn.access_key_id, conn.secret_access_key)
    can_manage_iam = _connection_iam_capable(conn)
    account._manager_capabilities = AccountCapabilities(  # type: ignore[attr-defined]
        can_manage_buckets=True,
        can_manage_iam=can_manage_iam,
        can_view_root_key=False,
        using_root_key=False,
    )
    return account

def _resolve_workspace_surface(request: Optional[Request]) -> str:
    if not request:
        return "manager"
    path = str(request.url.path)
    browser_prefix = f"{settings.api_v1_prefix}/browser"
    if path.startswith(browser_prefix):
        return "browser"
    return "manager"


def _resolve_default_account_id(db: Session, user: User) -> int:
    links = get_effective_access_service(db).resolve_user(user).account_links
    if len(links) == 1:
        return links[0].account_id
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="S3Account id required")


def _resolve_account_by_id(db: Session, account_id: int) -> S3Account:
    account = db.query(S3Account).filter(S3Account.id == account_id).first()
    if not account:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="S3Account not found")
    account.clear_session_credentials()
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
    link = get_effective_access_service(db).resolve_user(user).account_link_for(account.id)
    if not link:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized for this account")
    return account, link


def _manager_membership_capabilities(
    link: UserS3Account | EffectiveAccountLink,
) -> AccountCapabilities:
    is_account_admin = bool(link.account_admin or link.is_root)
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
) -> S3Account:
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
        if not account:
            account = S3Account(
                name=actor.account_name or actor.account_id,
                rgw_account_id=actor.account_id,
            )
    account.set_session_credentials(actor.access_key, actor.secret_key)
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
        account.storage_endpoint_id = resolved_endpoint.id
        account.storage_endpoint = resolved_endpoint
    if requested_endpoint:
        account._session_endpoint = requested_endpoint  # type: ignore[attr-defined]
    return account


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
    general = load_app_settings().general
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
) -> S3Account:
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
            return _resolve_s3_user_context(db, actor, s3_user_id)
        account, link = _resolve_user_account_link(db, actor, account_id, allow_default=False)
        if _is_portal_browser_request(request, surface):
            return _resolve_portal_browser_context(db, actor, account, link, request=request)
        capabilities = _manager_membership_capabilities(link)
        if not capabilities.can_manage_buckets:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized for this account")
        access_key, secret_key = account.effective_rgw_credentials()
        if not access_key or not secret_key:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Admin credentials are not configured for this account",
            )
        account.set_session_credentials(access_key, secret_key)
        account._manager_capabilities = capabilities  # type: ignore[attr-defined]
        return account

    if s3_user_id is not None or connection_id is not None or ceph_admin_endpoint_id is not None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Sessions cannot assume this context")

    account = _resolve_session_account(db, actor, account_id, requested_endpoint=requested_endpoint)
    account._manager_capabilities = AccountCapabilities(  # type: ignore[attr-defined]
        can_manage_buckets=actor.capabilities.can_manage_buckets,
        can_manage_iam=actor.capabilities.can_manage_iam,
        can_view_root_key=False,
        using_root_key=False,
    )
    return account


def _membership_capabilities(link: Optional[UserS3Account | EffectiveAccountLink], actor: ManagerActor) -> AccountCapabilities:
    if link:
        is_account_admin = bool(link.account_admin or link.is_root)
        if not is_account_admin:
            return AccountCapabilities()
        return AccountCapabilities(
            can_manage_buckets=True,
            can_manage_iam=True,
            can_view_root_key=True,
            using_root_key=is_account_admin,
        )
    if isinstance(actor, ManagerSessionPrincipal):
        return AccountCapabilities(
            can_manage_buckets=actor.capabilities.can_manage_buckets,
            can_manage_iam=actor.capabilities.can_manage_iam,
            can_view_root_key=False,
            using_root_key=False,
        )
    return AccountCapabilities()


def get_account_access(
    account_ref: Optional[str] = Query(default=None, alias="account_id"),
    actor: ManagerActor = Depends(get_current_actor),
    db: Session = Depends(get_db),
) -> AccountAccess:
    account_id, s3_user_id, connection_id, ceph_admin_endpoint_id = _parse_account_selector(account_ref)
    if s3_user_id is not None or connection_id is not None or ceph_admin_endpoint_id is not None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="S3 user context is not supported here")

    # Resolve target account
    if isinstance(actor, User):
        account, link = _resolve_user_account_link(db, actor, account_id, allow_default=True)
        capabilities = _membership_capabilities(link, actor)
        if not capabilities.can_manage_buckets:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized for this account")
        return AccountAccess(account=account, actor=actor, membership=link, capabilities=capabilities)

    # Session principal
    account = _resolve_session_account(db, actor, account_id)
    capabilities = _membership_capabilities(None, actor)
    return AccountAccess(account=account, actor=actor, membership=None, capabilities=capabilities)
