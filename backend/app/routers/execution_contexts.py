# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from app.utils.time import utcnow
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.db import S3Account, S3Connection, S3User, User, is_admin_ui_role
from app.models.execution_context import (
    ExecutionContext,
    ExecutionContextCapabilities,
    WorkspaceAccess,
    WorkspaceAvailability,
)
from app.routers.dependencies import get_current_account_user
from app.services import app_settings_service
from app.services.effective_access_service import EffectiveAccessService
from app.services.tags_service import TagsService
from app.utils.s3_connection_capabilities import s3_connection_can_manage_iam
from app.utils.s3_connection_endpoint import resolve_connection_details
from app.utils.storage_endpoint_features import features_to_capabilities, normalize_features_config

router = APIRouter(prefix="/me", tags=["me"])


def _provider_value(provider: object | None) -> Optional[str]:
    if provider is None:
        return None
    value = getattr(provider, "value", provider)
    text = str(value).strip().lower()
    return text or None


def _connection_can_manage_iam(connection: S3Connection) -> bool:
    return s3_connection_can_manage_iam(connection.capabilities_json)


def _build_account_context(
    account: S3Account,
    quota_max_size_gb: Optional[float],
    quota_max_objects: Optional[int],
    max_buckets: Optional[int],
    max_users: Optional[int],
    max_roles: Optional[int],
    max_groups: Optional[int],
    *,
    tags_service: TagsService,
    role: Optional[str] = None,
    manager_account_is_admin: Optional[bool] = None,
) -> ExecutionContext:
    endpoint = account.storage_endpoint
    endpoint_caps = features_to_capabilities(
        normalize_features_config(endpoint.provider, endpoint.features_config)
    )
    sts_capable = bool(endpoint_caps.get("sts"))
    return ExecutionContext(
        kind="account",
        id=str(account.id),
        display_name=account.name,
        role=role,
        manager_account_is_admin=manager_account_is_admin,
        rgw_account_id=account.rgw_account_id,
        max_buckets=max_buckets,
        max_users=max_users,
        max_roles=max_roles,
        max_groups=max_groups,
        quota_max_size_gb=quota_max_size_gb,
        quota_max_objects=quota_max_objects,
        endpoint_id=endpoint.id,
        endpoint_name=endpoint.name,
        endpoint_is_default=bool(endpoint.is_default),
        endpoint_provider=_provider_value(endpoint.provider),
        endpoint_url=endpoint.endpoint_url,
        storage_endpoint_capabilities=endpoint_caps,
        tags=tags_service.filter_selector_visible(tags_service.get_account_tags(account)),
        endpoint_tags=tags_service.filter_selector_visible(tags_service.get_storage_endpoint_tags(endpoint)),
        capabilities=ExecutionContextCapabilities(
            can_manage_iam=True,
            sts_capable=sts_capable,
            admin_api_capable=True,
        ),
    )


def _build_portal_account_context(
    account: S3Account,
    *,
    tags_service: TagsService,
    role: str,
    manager_account_is_admin: bool,
) -> ExecutionContext:
    endpoint = account.storage_endpoint
    endpoint_caps = features_to_capabilities(
        normalize_features_config(endpoint.provider, endpoint.features_config)
    )
    return ExecutionContext(
        kind="portal_account",
        id=str(account.id),
        display_name=account.name,
        role=role,
        manager_account_is_admin=manager_account_is_admin,
        rgw_account_id=account.rgw_account_id,
        endpoint_id=endpoint.id,
        endpoint_name=endpoint.name,
        endpoint_is_default=bool(endpoint.is_default),
        endpoint_provider=_provider_value(endpoint.provider),
        endpoint_url=endpoint.endpoint_url,
        storage_endpoint_capabilities=endpoint_caps,
        tags=tags_service.filter_selector_visible(tags_service.get_account_tags(account)),
        endpoint_tags=tags_service.filter_selector_visible(tags_service.get_storage_endpoint_tags(endpoint)),
        capabilities=ExecutionContextCapabilities(
            can_manage_iam=False,
            sts_capable=False,
            admin_api_capable=False,
        ),
    )


def _build_s3_user_context(
    s3_user: S3User,
    quota_max_size_gb: Optional[float],
    quota_max_objects: Optional[int],
    max_buckets: Optional[int],
    *,
    tags_service: TagsService,
) -> ExecutionContext:
    endpoint = s3_user.storage_endpoint
    endpoint_caps = features_to_capabilities(
        normalize_features_config(endpoint.provider, endpoint.features_config)
    )
    return ExecutionContext(
        kind="s3_user",
        id=f"s3u-{s3_user.id}",
        display_name=s3_user.name,
        max_buckets=max_buckets,
        quota_max_size_gb=quota_max_size_gb,
        quota_max_objects=quota_max_objects,
        endpoint_id=endpoint.id,
        endpoint_name=endpoint.name,
        endpoint_is_default=bool(endpoint.is_default),
        endpoint_provider=_provider_value(endpoint.provider),
        endpoint_url=endpoint.endpoint_url,
        storage_endpoint_capabilities=endpoint_caps,
        tags=tags_service.filter_selector_visible(tags_service.get_s3_user_tags(s3_user)),
        endpoint_tags=tags_service.filter_selector_visible(tags_service.get_storage_endpoint_tags(endpoint)),
        capabilities=ExecutionContextCapabilities(
            can_manage_iam=False,
            sts_capable=False,
            admin_api_capable=False,
        ),
    )


def _build_connection_context(
    connection: S3Connection,
    *,
    tags_service: TagsService,
    hidden: bool = False,
) -> ExecutionContext:
    details = resolve_connection_details(connection)
    can_manage_iam = _connection_can_manage_iam(connection)
    endpoint = connection.storage_endpoint
    endpoint_caps = None
    if endpoint:
        endpoint_caps = features_to_capabilities(
            normalize_features_config(endpoint.provider, endpoint.features_config)
        )
        endpoint_caps["iam"] = can_manage_iam
    else:
        endpoint_caps = {
            "admin": False,
            "sts": False,
            "usage": False,
            "metrics": False,
            "static_website": False,
            "iam": can_manage_iam,
            "sns": False,
            "sse": False,
            "replication": False,
        }

    return ExecutionContext(
        kind="connection",
        id=f"conn-{connection.id}",
        display_name=connection.name,
        hidden=hidden,
        endpoint_id=endpoint.id if endpoint else None,
        endpoint_name=(endpoint.name if endpoint else (details.endpoint_name or details.provider or "Custom endpoint")),
        endpoint_is_default=bool(endpoint.is_default) if endpoint else False,
        endpoint_provider=_provider_value(endpoint.provider if endpoint else None),
        endpoint_url=details.endpoint_url,
        storage_endpoint_capabilities=endpoint_caps,
        tags=tags_service.filter_selector_visible(tags_service.get_connection_tags(connection)),
        endpoint_tags=tags_service.filter_selector_visible(tags_service.get_storage_endpoint_tags(endpoint)) if endpoint else [],
        capabilities=ExecutionContextCapabilities(
            can_manage_iam=can_manage_iam,
            sts_capable=False,
            admin_api_capable=False,
        ),
    )


@router.get("/execution-contexts", response_model=list[ExecutionContext])
def list_execution_contexts(
    workspace: Optional[str] = Query(default=None, pattern="^(manager|browser)$"),
    user: User = Depends(get_current_account_user),
    db: Session = Depends(get_db),
) -> list[ExecutionContext]:
    tags_service = TagsService(db)
    access_service = EffectiveAccessService(db)
    effective = access_service.resolve_user(user)
    links = effective.account_links
    account_ids = {link.account_id for link in links}
    accounts = (
        db.query(S3Account).filter(S3Account.id.in_(account_ids)).all()
        if account_ids
        else []
    )

    s3_ids = set(effective.s3_user_ids)
    s3_users = (
        db.query(S3User).filter(S3User.id.in_(s3_ids)).all()
        if s3_ids
        else []
    )

    connection_workspace = workspace or "manager"
    connections = access_service.list_workspace_connections(
        user,
        workspace=connection_workspace,
        resolved=effective,
    )

    results: list[ExecutionContext] = []
    account_by_id = {account.id: account for account in accounts}
    if workspace == "manager":
        for link in links:
            if not access_service.manager_account_allowed(link.role):
                continue
            account = account_by_id.get(link.account_id)
            if account is not None:
                results.append(
                    _build_account_context(
                        account,
                        None,
                        None,
                        None,
                        None,
                        None,
                        None,
                        tags_service=tags_service,
                        role=link.role,
                        manager_account_is_admin=True,
                    )
                )
    elif workspace is None:
        for account in accounts:
            results.append(
                _build_account_context(
                    account,
                    None,
                    None,
                    None,
                    None,
                    None,
                    None,
                    tags_service=tags_service,
                )
            )
    elif workspace == "browser":
        for account, link in access_service.list_browser_portal_accounts(
            user,
            resolved=effective,
        ):
            portal_role = link.portal_role
            if portal_role is None:  # pragma: no cover - filtered by the service
                continue
            results.append(
                _build_portal_account_context(
                    account,
                    tags_service=tags_service,
                    role=portal_role,
                    manager_account_is_admin=access_service.manager_account_allowed(link.role),
                )
            )
    if workspace in {None, "manager"}:
        for s3_user in s3_users:
            results.append(
                _build_s3_user_context(
                    s3_user,
                    None,
                    None,
                    None,
                    tags_service=tags_service,
                )
            )

    for connection in connections:
        if workspace == "manager" and not bool(connection.access_manager):
            continue
        if workspace == "browser" and not bool(connection.access_browser):
            continue
        results.append(
            _build_connection_context(
                connection,
                tags_service=tags_service,
                hidden=bool(connection.is_temporary),
            )
        )
    return results


@router.get("/workspace-access", response_model=WorkspaceAccess)
def get_workspace_access(
    user: User = Depends(get_current_account_user),
    db: Session = Depends(get_db),
) -> WorkspaceAccess:
    settings = app_settings_service.load_app_settings().general
    service = EffectiveAccessService(db)
    effective = service.resolve_user(user)
    manager_count = sum(
        1 for link in effective.account_links if service.manager_account_allowed(link.role)
    ) + len(effective.s3_user_ids) + len(
        service.list_workspace_connections(user, workspace="manager", resolved=effective)
    )
    browser_count = len(
        service.list_workspace_connections(user, workspace="browser", resolved=effective)
    ) + len(service.list_browser_portal_accounts(user, resolved=effective))
    portal_count = len(service.list_portal_accounts(user, resolved=effective))
    admin_available = is_admin_ui_role(user.role)
    ceph_admin_available = bool(settings.ceph_admin_enabled and effective.can_access_ceph_admin)
    storage_ops_available = bool(
        settings.storage_ops_enabled and effective.can_access_storage_ops and manager_count
    )
    manager_available = bool(settings.manager_enabled and manager_count)
    browser_available = bool(settings.browser_enabled and settings.browser_root_enabled and browser_count)
    portal_available = bool(settings.portal_enabled and portal_count)
    if admin_available:
        default_workspace = "admin"
    elif manager_available:
        default_workspace = "manager"
    elif storage_ops_available:
        default_workspace = "storage-ops"
    elif portal_available:
        default_workspace = "portal"
    elif browser_available:
        default_workspace = "browser"
    elif ceph_admin_available:
        default_workspace = "ceph-admin"
    else:
        default_workspace = None
    return WorkspaceAccess(
        admin=WorkspaceAvailability(available=admin_available, context_count=1 if admin_available else 0),
        ceph_admin=WorkspaceAvailability(
            available=ceph_admin_available,
            context_count=1 if ceph_admin_available else 0,
        ),
        storage_ops=WorkspaceAvailability(
            available=storage_ops_available,
            context_count=manager_count if storage_ops_available else 0,
        ),
        manager=WorkspaceAvailability(available=manager_available, context_count=manager_count),
        browser=WorkspaceAvailability(available=browser_available, context_count=browser_count),
        portal=WorkspaceAvailability(available=portal_available, context_count=portal_count),
        default_workspace=default_workspace,
    )
