# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import TypedDict

from app.db import S3Account, S3Connection, S3User, StorageEndpoint
from app.models.execution_context import ExecutionContext, ExecutionContextCapabilities
from app.services.tags_service import TagsService
from app.utils.account_roles import ManagerAccountRoleValue, PortalAccountRoleValue
from app.utils.s3_connection_capabilities import s3_connection_can_manage_iam
from app.utils.s3_connection_endpoint import resolve_connection_details
from app.utils.storage_endpoint_features import features_to_capabilities, normalize_features_config


class _EndpointProjection(TypedDict):
    endpoint_id: int | None
    endpoint_name: str
    endpoint_is_default: bool
    endpoint_provider: str | None
    endpoint_url: str
    storage_endpoint_capabilities: dict[str, bool]


def _provider_value(provider: object | None) -> str | None:
    if provider is None:
        return None
    value = getattr(provider, "value", provider)
    text = str(value).strip().lower()
    return text or None


def _storage_endpoint_projection(
    endpoint: StorageEndpoint,
    *,
    endpoint_url: str | None = None,
    capability_overrides: dict[str, bool] | None = None,
) -> _EndpointProjection:
    capabilities = features_to_capabilities(
        normalize_features_config(endpoint.provider, endpoint.features_config)
    )
    if capability_overrides:
        capabilities.update(capability_overrides)
    return {
        "endpoint_id": endpoint.id,
        "endpoint_name": endpoint.name,
        "endpoint_is_default": bool(endpoint.is_default),
        "endpoint_provider": _provider_value(endpoint.provider),
        "endpoint_url": endpoint.endpoint_url if endpoint_url is None else endpoint_url,
        "storage_endpoint_capabilities": capabilities,
    }


def account_execution_context_from_db(
    account: S3Account,
    *,
    tags_service: TagsService,
    manager_role: ManagerAccountRoleValue | None = None,
) -> ExecutionContext:
    endpoint = account.storage_endpoint
    endpoint_projection = _storage_endpoint_projection(endpoint)
    return ExecutionContext(
        kind="account",
        id=str(account.id),
        display_name=account.name,
        manager_role=manager_role,
        rgw_account_id=account.rgw_account_id,
        **endpoint_projection,
        tags=tags_service.filter_selector_visible(tags_service.get_account_tags(account)),
        endpoint_tags=tags_service.filter_selector_visible(tags_service.get_storage_endpoint_tags(endpoint)),
        capabilities=ExecutionContextCapabilities(
            can_manage_iam=True,
            sts_capable=bool(endpoint_projection["storage_endpoint_capabilities"].get("sts")),
            admin_api_capable=True,
        ),
    )


def portal_account_execution_context_from_db(
    account: S3Account,
    *,
    tags_service: TagsService,
    portal_role: PortalAccountRoleValue,
    manager_role: ManagerAccountRoleValue | None,
) -> ExecutionContext:
    endpoint = account.storage_endpoint
    return ExecutionContext(
        kind="portal_account",
        id=str(account.id),
        display_name=account.name,
        manager_role=manager_role,
        portal_role=portal_role,
        rgw_account_id=account.rgw_account_id,
        **_storage_endpoint_projection(endpoint),
        tags=tags_service.filter_selector_visible(tags_service.get_account_tags(account)),
        endpoint_tags=tags_service.filter_selector_visible(tags_service.get_storage_endpoint_tags(endpoint)),
        capabilities=ExecutionContextCapabilities(
            can_manage_iam=False,
            sts_capable=False,
            admin_api_capable=False,
        ),
    )


def s3_user_execution_context_from_db(
    s3_user: S3User,
    *,
    tags_service: TagsService,
) -> ExecutionContext:
    endpoint = s3_user.storage_endpoint
    return ExecutionContext(
        kind="s3_user",
        id=f"s3u-{s3_user.id}",
        display_name=s3_user.name,
        **_storage_endpoint_projection(endpoint),
        tags=tags_service.filter_selector_visible(tags_service.get_s3_user_tags(s3_user)),
        endpoint_tags=tags_service.filter_selector_visible(tags_service.get_storage_endpoint_tags(endpoint)),
        capabilities=ExecutionContextCapabilities(
            can_manage_iam=False,
            sts_capable=False,
            admin_api_capable=False,
        ),
    )


def connection_execution_context_from_db(
    connection: S3Connection,
    *,
    tags_service: TagsService,
) -> ExecutionContext:
    details = resolve_connection_details(connection)
    can_manage_iam = s3_connection_can_manage_iam(connection.capabilities_json)
    endpoint = connection.storage_endpoint
    if endpoint:
        endpoint_projection = _storage_endpoint_projection(
            endpoint,
            endpoint_url=details.endpoint_url,
            capability_overrides={"iam": can_manage_iam},
        )
        endpoint_tags = tags_service.filter_selector_visible(tags_service.get_storage_endpoint_tags(endpoint))
    else:
        endpoint_projection: _EndpointProjection = {
            "endpoint_id": None,
            "endpoint_name": details.endpoint_name or details.provider or "Custom endpoint",
            "endpoint_is_default": False,
            "endpoint_provider": None,
            "endpoint_url": details.endpoint_url,
            "storage_endpoint_capabilities": {
                "admin": False,
                "sts": False,
                "usage": False,
                "metrics": False,
                "static_website": False,
                "iam": can_manage_iam,
                "sns": False,
                "sse": False,
                "replication": False,
            },
        }
        endpoint_tags = []

    return ExecutionContext(
        kind="connection",
        id=f"conn-{connection.id}",
        display_name=connection.name,
        **endpoint_projection,
        tags=tags_service.filter_selector_visible(tags_service.get_connection_tags(connection)),
        endpoint_tags=endpoint_tags,
        capabilities=ExecutionContextCapabilities(
            can_manage_iam=can_manage_iam,
            sts_capable=False,
            admin_api_capable=False,
        ),
    )
