# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Optional
from urllib.parse import unquote

from fastapi import Depends, HTTPException, Query, Request, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.db import AccountRole, S3Account, StorageProvider, User, UserS3Account
from app.models.access_context import AccountAccess, EffectiveAccountLink
from app.models.account_capabilities import AccountCapabilities
from app.utils.http_errors import raise_http_exception_from_exception
from app.services import app_settings_service
from app.services.s3_execution_context import S3ExecutionContext
from app.utils.storage_endpoint_features import resolve_feature_flags
from app.utils.account_roles import portal_role_for

from .account_context import _parse_account_selector, _resolve_user_account_link, _resolve_workspace_surface
from .auth_session import get_current_account_user, settings

def _portal_membership_capabilities(
    link: Optional[UserS3Account | EffectiveAccountLink],
) -> tuple[Optional[str], AccountCapabilities]:
    if not link:
        return None, AccountCapabilities()
    role = portal_role_for(link.role)
    if role is None:
        return role, AccountCapabilities()
    can_manage_portal_users = role == AccountRole.PORTAL_MANAGER.value
    can_manage_buckets = role == AccountRole.PORTAL_MANAGER.value
    return role, AccountCapabilities(
        can_manage_buckets=can_manage_buckets,
        can_manage_portal_users=can_manage_portal_users,
        can_manage_iam=False,
        can_view_root_key=False,
        using_root_key=False,
    )


def _validate_portal_account_surface(account: S3Account) -> None:
    endpoint = getattr(account, "storage_endpoint", None)
    if endpoint is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal requires a storage endpoint")
    if StorageProvider(str(endpoint.provider)) != StorageProvider.CEPH:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal requires a Ceph RGW account")
    if not resolve_feature_flags(endpoint).iam_enabled:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal is disabled for this endpoint")


def _is_portal_browser_request(request: Optional[Request], surface: str) -> bool:
    if surface != "browser" or request is None:
        return False
    workspace = (request.headers.get("X-S3-Workspace") or "").strip().lower()
    return workspace == "portal"


def _portal_browser_relative_segments(request: Request) -> list[str]:
    browser_prefix = f"{settings.api_v1_prefix}/browser"
    path = str(request.url.path)
    if path.startswith(browser_prefix):
        relative = path[len(browser_prefix) :]
    elif path.startswith("/browser"):
        relative = path[len("/browser") :]
    else:
        relative = path
    return [segment for segment in relative.strip("/").split("/") if segment]


def _is_portal_browser_basic_route_allowed(request: Request) -> bool:
    method = request.method.upper()
    if method in {"HEAD", "OPTIONS"}:
        return True
    segments = _portal_browser_relative_segments(request)
    if method == "GET" and segments == ["settings"]:
        return True
    if method == "GET" and segments == ["buckets", "search"]:
        return True
    if method == "GET" and segments == ["usage-summary"]:
        return True
    if len(segments) < 3 or segments[0] != "buckets":
        return False

    operation = segments[2]
    if len(segments) == 3:
        if method == "GET" and operation in {
            "objects",
            "cors",
            "download",
            "versioning",
            "versions",
        }:
            return True
        if method == "POST" and operation in {"presign", "delete", "folders", "proxy-upload"}:
            return True
        return False

    if operation != "multipart":
        return False
    if method == "POST" and len(segments) == 4 and segments[3] == "initiate":
        return True
    if method == "POST" and len(segments) == 5 and segments[4] in {"presign", "complete"}:
        return True
    if method == "DELETE" and len(segments) == 4:
        return True
    return False


def _portal_browser_target_bucket(request: Request) -> Optional[str]:
    segments = _portal_browser_relative_segments(request)
    if len(segments) >= 2 and segments[0] == "buckets" and segments[1] != "search":
        return unquote(segments[1])
    return None


def require_portal_browser_basic_route(request: Request) -> None:
    if not _is_portal_browser_request(request, _resolve_workspace_surface(request)):
        return
    if _is_portal_browser_basic_route_allowed(request):
        return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Endpoint is not available in Portal browser profile",
    )


def _resolve_portal_browser_context(
    db: Session,
    user: User,
    account: S3Account,
    link: UserS3Account,
    *,
    request: Request,
) -> S3ExecutionContext:
    app_settings = app_settings_service.load_app_settings()
    if not app_settings.general.portal_enabled:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal feature is disabled")
    if not app_settings.general.browser_portal_enabled:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Browser is disabled for Portal workspace")

    _validate_portal_account_surface(account)
    role, portal_capabilities = _portal_membership_capabilities(link)
    if role is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized for this account")

    from app.services.portal_service import PortalService

    portal_service = PortalService(db)
    portal_access = AccountAccess(account=account, actor=user, membership=link, capabilities=portal_capabilities, role=role)
    try:
        access_key, secret_key = portal_service.get_portal_credentials(user, account, role)
    except RuntimeError as exc:
        raise_http_exception_from_exception(status.HTTP_502_BAD_GATEWAY, exc)
    if not access_key or not secret_key:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Portal credentials are not configured for this account",
        )

    try:
        visible_spaces = portal_service.list_storage_spaces(user, portal_access)
    except RuntimeError as exc:
        raise_http_exception_from_exception(status.HTTP_502_BAD_GATEWAY, exc)
    browse_spaces = [space for space in visible_spaces if space.can_browse]
    allowed_buckets = {
        space.internal_bucket_name or space.id
        for space in browse_spaces
        if (space.internal_bucket_name or space.id)
    }
    target_bucket = _portal_browser_target_bucket(request)
    if target_bucket and target_bucket not in allowed_buckets:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Storage Space is not available in Portal")

    context = S3ExecutionContext.from_account(
        account,
        context_kind="portal_account",
        access_key=access_key,
        secret_key=secret_key,
        manager_capabilities=AccountCapabilities(
            can_manage_buckets=True,
            can_manage_portal_users=portal_capabilities.can_manage_portal_users,
            can_manage_iam=False,
            can_view_root_key=False,
            using_root_key=False,
        ),
    )
    context.portal_browser_role = role
    context.portal_browser_access = portal_access
    context.portal_allowed_buckets = allowed_buckets
    context.portal_storage_spaces = browse_spaces
    return context


def get_portal_account_access(
    account_ref: Optional[str] = Query(default=None, alias="account_id"),
    user: User = Depends(get_current_account_user),
    db: Session = Depends(get_db),
) -> AccountAccess:
    account_id, s3_user_id, connection_id, ceph_admin_endpoint_id = _parse_account_selector(account_ref)
    if s3_user_id is not None or connection_id is not None or ceph_admin_endpoint_id is not None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="S3 user context is not supported here")

    account, link = _resolve_user_account_link(db, user, account_id, allow_default=False)
    _validate_portal_account_surface(account)

    role, capabilities = _portal_membership_capabilities(link)
    if role is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized for this account")
    return AccountAccess(account=account, actor=user, membership=link, capabilities=capabilities, role=role)


def require_portal_manager(access: AccountAccess = Depends(get_portal_account_access)) -> AccountAccess:
    if access.role != AccountRole.PORTAL_MANAGER.value:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Manager rights required for this account")
    return access
