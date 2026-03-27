# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from app.utils.time import utcnow
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.db import S3Account, S3Connection, S3User, User, UserS3Account, UserS3Connection, UserS3User
from app.models.execution_context import ExecutionContext, ExecutionContextCapabilities
from app.routers.dependencies import get_current_account_user
from app.services.s3_users_service import S3UsersService
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
    return s3_connection_can_manage_iam(getattr(connection, "capabilities_json", None))


def _build_account_context(
    account: S3Account,
    *,
    tags_service: TagsService,
    manager_account_is_admin: Optional[bool] = None,
) -> ExecutionContext:
    endpoint = account.storage_endpoint
    endpoint_caps = (
        features_to_capabilities(normalize_features_config(endpoint.provider, endpoint.features_config))
        if endpoint
        else None
    )
    sts_capable = bool(endpoint_caps.get("sts")) if endpoint_caps else False
    return ExecutionContext(
        kind="account",
        id=str(account.id),
        display_name=account.name,
        manager_account_is_admin=manager_account_is_admin,
        rgw_account_id=account.rgw_account_id,
        endpoint_id=endpoint.id if endpoint else None,
        endpoint_name=endpoint.name if endpoint else None,
        endpoint_provider=_provider_value(endpoint.provider if endpoint else None),
        endpoint_url=endpoint.endpoint_url if endpoint else None,
        storage_endpoint_capabilities=endpoint_caps,
        tags=tags_service.filter_selector_visible(tags_service.get_account_tags(account)),
        endpoint_tags=tags_service.filter_selector_visible(tags_service.get_storage_endpoint_tags(endpoint)) if endpoint else [],
        capabilities=ExecutionContextCapabilities(
            can_manage_iam=True,
            sts_capable=sts_capable,
            admin_api_capable=True,
        ),
    )


def _build_legacy_user_context(
    s3_user: S3User,
    quota_max_size_gb: Optional[float],
    quota_max_objects: Optional[int],
    *,
    tags_service: TagsService,
) -> ExecutionContext:
    endpoint = s3_user.storage_endpoint
    endpoint_caps = (
        features_to_capabilities(normalize_features_config(endpoint.provider, endpoint.features_config))
        if endpoint
        else None
    )
    return ExecutionContext(
        kind="legacy_user",
        id=f"s3u-{s3_user.id}",
        display_name=s3_user.name,
        quota_max_size_gb=quota_max_size_gb,
        quota_max_objects=quota_max_objects,
        endpoint_id=endpoint.id if endpoint else None,
        endpoint_name=endpoint.name if endpoint else None,
        endpoint_provider=_provider_value(endpoint.provider if endpoint else None),
        endpoint_url=endpoint.endpoint_url if endpoint else None,
        storage_endpoint_capabilities=endpoint_caps,
        tags=tags_service.filter_selector_visible(tags_service.get_s3_user_tags(s3_user)),
        endpoint_tags=tags_service.filter_selector_visible(tags_service.get_storage_endpoint_tags(endpoint)) if endpoint else [],
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
        }

    return ExecutionContext(
        kind="connection",
        id=f"conn-{connection.id}",
        display_name=connection.name,
        hidden=hidden,
        endpoint_id=endpoint.id if endpoint else None,
        endpoint_name=(endpoint.name if endpoint else (details.endpoint_name or details.provider or "Custom endpoint")),
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


def _manager_account_allowed(link: UserS3Account) -> bool:
    return bool(link.account_admin or link.is_root)


@router.get("/execution-contexts", response_model=list[ExecutionContext])
def list_execution_contexts(
    workspace: Optional[str] = Query(default=None, pattern="^(manager|browser)$"),
    user: User = Depends(get_current_account_user),
    db: Session = Depends(get_db),
) -> list[ExecutionContext]:
    s3_users_service = S3UsersService(db)
    tags_service = TagsService(db)
    links = (
        db.query(UserS3Account)
        .filter(UserS3Account.user_id == user.id)
        .all()
    )
    account_ids = {link.account_id for link in links}
    accounts = (
        db.query(S3Account).filter(S3Account.id.in_(account_ids)).all()
        if account_ids
        else []
    )

    s3_links = (
        db.query(UserS3User)
        .filter(UserS3User.user_id == user.id)
        .all()
    )
    s3_ids = {link.s3_user_id for link in s3_links}
    s3_users = (
        db.query(S3User).filter(S3User.id.in_(s3_ids)).all()
        if s3_ids
        else []
    )

    user_connection_ids = (
        db.query(UserS3Connection.s3_connection_id)
        .filter(UserS3Connection.user_id == user.id)
    )
    now = utcnow()
    connections = (
        db.query(S3Connection)
        .filter(
            ((S3Connection.is_shared.is_(False)) & (S3Connection.created_by_user_id == user.id))
            | ((S3Connection.is_shared.is_(True)) & (S3Connection.id.in_(user_connection_ids)))
        )
        .filter(S3Connection.is_active.is_(True))
        .filter(
            (S3Connection.is_temporary.is_(False))
            | (S3Connection.expires_at.is_(None))
            | (S3Connection.expires_at > now)
        )
        .all()
    )

    results: list[ExecutionContext] = []
    account_by_id = {account.id: account for account in accounts}
    if workspace == "manager":
        for link in links:
            if not _manager_account_allowed(link):
                continue
            account = account_by_id.get(link.account_id)
            if account is not None:
                results.append(
                    _build_account_context(
                        account,
                        tags_service=tags_service,
                        manager_account_is_admin=bool(link.account_admin or link.is_root),
                    )
                )
    elif workspace is None:
        for account in accounts:
            results.append(_build_account_context(account, tags_service=tags_service))

    if workspace in {None, "manager", "browser"}:
        for s3_user in s3_users:
            quota_max_size_gb, quota_max_objects = s3_users_service.get_user_quota(s3_user)
            results.append(
                _build_legacy_user_context(
                    s3_user,
                    quota_max_size_gb,
                    quota_max_objects,
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
