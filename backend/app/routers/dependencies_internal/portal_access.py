# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Optional
from urllib.parse import unquote

from fastapi import Depends, HTTPException, Query, Request, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.db import AccountRole, S3Account, StorageProvider, User, UserS3Account
from app.models.browser import BrowserBucket
from app.routers.http_errors import raise_http_exception_from_exception
from app.routers.dependencies_internal.settings_loader import load_app_settings
from app.services.effective_access_service import EffectiveAccountLink
from app.utils.storage_endpoint_features import resolve_feature_flags

from .account_context import _parse_account_selector, _resolve_user_account_link, _resolve_workspace_surface
from .auth_session import get_current_account_user, settings
from .types import AccountAccess, AccountCapabilities

def _portal_membership_capabilities(link: Optional[UserS3Account | EffectiveAccountLink]) -> tuple[str, AccountCapabilities]:
    if not link:
        return AccountRole.PORTAL_NONE.value, AccountCapabilities()
    role = link.account_role or AccountRole.PORTAL_NONE.value
    if role == AccountRole.PORTAL_NONE.value:
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
    if not account.rgw_account_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal requires an RGW account")
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
        if method == "GET" and operation in {"objects", "cors", "download"}:
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


def _parse_project_selector(account_ref: Optional[str]) -> Optional[int]:
    if not isinstance(account_ref, str) or not account_ref.startswith("proj-"):
        return None
    suffix = account_ref.split("proj-", 1)[1]
    if not suffix.isdigit():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid project identifier")
    return int(suffix)


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
) -> S3Account:
    app_settings = load_app_settings()
    if not app_settings.general.portal_enabled:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal feature is disabled")
    if not app_settings.general.browser_portal_enabled:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Browser is disabled for Portal workspace")

    _validate_portal_account_surface(account)
    role, portal_capabilities = _portal_membership_capabilities(link)
    if role == AccountRole.PORTAL_NONE.value:
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

    account.set_session_credentials(access_key, secret_key)
    account._manager_capabilities = AccountCapabilities(  # type: ignore[attr-defined]
        can_manage_buckets=True,
        can_manage_portal_users=portal_capabilities.can_manage_portal_users,
        can_manage_iam=False,
        can_view_root_key=False,
        using_root_key=False,
    )
    account._portal_browser_role = role  # type: ignore[attr-defined]
    account._portal_browser_access = portal_access  # type: ignore[attr-defined]
    account._portal_allowed_buckets = allowed_buckets  # type: ignore[attr-defined]
    account._portal_storage_spaces = browse_spaces  # type: ignore[attr-defined]
    return account


def _resolve_portal_project_browser_context(
    db: Session,
    user: User,
    project_id: int,
    *,
    request: Request,
) -> S3Account:
    app_settings = load_app_settings()
    if not app_settings.general.portal_enabled:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal feature is disabled")
    if not app_settings.general.browser_portal_enabled:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Browser is disabled for Portal workspace")

    from app.services.portal_service import PortalService
    from app.services.projects_service import get_projects_service

    projects_service = get_projects_service(db)
    try:
        project_access = projects_service.resolve_portal_project_access(user, project_id)
    except ValueError as exc:
        detail = str(exc)
        status_code = status.HTTP_403_FORBIDDEN if "Not authorized" in detail else status.HTTP_404_NOT_FOUND
        raise HTTPException(status_code=status_code, detail=detail) from exc

    portal_service = PortalService(db)
    project_buckets: list[BrowserBucket] = []
    target_bucket = _portal_browser_target_bucket(request)
    target_candidates: list[tuple[S3Account, str, object]] = []
    for project_account_link in project_access.account_links:
        account_access = projects_service.account_access_for_project(project_access, project_account_link.account_id)
        account = account_access.account
        _validate_portal_account_surface(account)
        try:
            spaces = portal_service.list_storage_spaces(user, account_access)
        except RuntimeError as exc:
            raise_http_exception_from_exception(status.HTTP_502_BAD_GATEWAY, exc)
        for space in spaces:
            if not space.can_browse:
                continue
            bucket_name = space.internal_bucket_name or space.id
            if not bucket_name:
                continue
            project_buckets.append(
                BrowserBucket(
                    name=bucket_name,
                    display_name=space.name,
                    workspace_label=project_account_link.display_name,
                    used_bytes=space.used_bytes,
                    object_count=space.object_count,
                    quota_max_size_bytes=space.quota_max_size_bytes,
                    quota_max_objects=space.quota_max_objects,
                    status=space.status,
                    role=space.role,
                    internal_bucket_name=bucket_name,
                )
            )
            if target_bucket and target_bucket == bucket_name:
                target_candidates.append((account, account_access.role, space))

    if not target_bucket:
        synthetic = S3Account(name=project_access.project.name, rgw_account_id=None)
        synthetic.id = -(2_000_000 + project_access.project.id)
        synthetic._portal_browser_role = project_access.role  # type: ignore[attr-defined]
        synthetic._portal_project_buckets = sorted(  # type: ignore[attr-defined]
            project_buckets,
            key=lambda bucket: ((bucket.workspace_label or "").lower(), (bucket.display_name or bucket.name).lower()),
        )
        return synthetic

    if len(target_candidates) != 1:
        detail = "Storage Space is not available in Portal project"
        if len(target_candidates) > 1:
            detail = "Storage Space name is ambiguous in this project"
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=detail)

    account, role, _space = target_candidates[0]
    try:
        access_key, secret_key = portal_service.get_portal_credentials(user, account, role)
    except RuntimeError as exc:
        raise_http_exception_from_exception(status.HTTP_502_BAD_GATEWAY, exc)
    if not access_key or not secret_key:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Portal credentials are not configured for this account",
        )
    account.set_session_credentials(access_key, secret_key)
    can_manage_portal_users = role == AccountRole.PORTAL_MANAGER.value
    account._manager_capabilities = AccountCapabilities(  # type: ignore[attr-defined]
        can_manage_buckets=True,
        can_manage_portal_users=can_manage_portal_users,
        can_manage_iam=False,
        can_view_root_key=False,
        using_root_key=False,
    )
    account._portal_browser_role = role  # type: ignore[attr-defined]
    account._portal_allowed_buckets = {target_bucket}  # type: ignore[attr-defined]
    account._portal_project_id = project_access.project.id  # type: ignore[attr-defined]
    return account


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
    if role == AccountRole.PORTAL_NONE.value:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized for this account")
    return AccountAccess(account=account, actor=user, membership=link, capabilities=capabilities, role=role)


def require_portal_manager(access: AccountAccess = Depends(get_portal_account_access)) -> AccountAccess:
    if not access.capabilities.can_manage_portal_users:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Manager rights required for this account")
    return access


def require_portal_buckets(access: AccountAccess = Depends(get_portal_account_access)) -> AccountAccess:
    if not access.capabilities.can_manage_buckets:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Bucket management not allowed for this account")
    return access
