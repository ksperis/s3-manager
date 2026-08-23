# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import logging
import re
from collections.abc import Callable, Mapping

from app.db import StorageEndpoint, StorageProvider
from app.models.storage_endpoint import StorageEndpointAdminOpsPermissions
from app.services.rgw_admin import RGWAdminClient, RGWAdminError
from app.utils.storage_endpoint_features import resolve_admin_endpoint

logger = logging.getLogger(__name__)

RGWAdminClientFactory = Callable[..., RGWAdminClient]


def _empty_permissions() -> StorageEndpointAdminOpsPermissions:
    return StorageEndpointAdminOpsPermissions()


def _parse_caps_payload(raw_caps: object) -> dict[str, set[str]]:
    parsed: dict[str, set[str]] = {}
    if not raw_caps:
        return parsed

    def append(scope: str, permissions: str) -> None:
        normalized_scope = scope.strip().lower()
        if not normalized_scope:
            return
        scope_permissions = parsed.setdefault(normalized_scope, set())
        tokens = [
            token.strip().lower()
            for token in re.split(r"[,\s]+", permissions)
            if token.strip()
        ]
        if not tokens:
            scope_permissions.add("*")
            return
        scope_permissions.update(tokens)

    if isinstance(raw_caps, str):
        for item in raw_caps.split(";"):
            scope, separator, permissions = item.partition("=")
            if separator:
                append(scope, permissions)
        return parsed

    if isinstance(raw_caps, list):
        for item in raw_caps:
            if isinstance(item, str):
                scope, separator, permissions = item.partition("=")
                if separator:
                    append(scope, permissions)
                continue
            if isinstance(item, dict):
                scope = str(item.get("type") or item.get("scope") or "").strip()
                permissions = str(
                    item.get("perm") or item.get("permissions") or "*"
                ).strip()
                append(scope, permissions)
        return parsed

    if isinstance(raw_caps, dict):
        for scope, permissions in raw_caps.items():
            append(str(scope), str(permissions))
    return parsed


def _allows(scope_permissions: set[str], permission: str) -> bool:
    normalized_permission = permission.strip().lower()
    return bool(
        normalized_permission
        and (
            "*" in scope_permissions
            or normalized_permission in scope_permissions
        )
    )


def _permissions_from_caps(raw_caps: object) -> StorageEndpointAdminOpsPermissions:
    parsed_caps = _parse_caps_payload(raw_caps)
    users_permissions = parsed_caps.get("users", set())
    accounts_permissions = parsed_caps.get("accounts", set())
    users_write = _allows(users_permissions, "write")
    accounts_write = _allows(accounts_permissions, "write")
    return StorageEndpointAdminOpsPermissions(
        users_read=_allows(users_permissions, "read") or users_write,
        users_write=users_write,
        accounts_read=_allows(accounts_permissions, "read") or accounts_write,
        accounts_write=accounts_write,
    )


def resolve_storage_endpoint_admin_ops_permissions(
    endpoint: StorageEndpoint,
    *,
    provider: StorageProvider,
    capabilities: Mapping[str, bool],
    client_factory: RGWAdminClientFactory,
) -> StorageEndpointAdminOpsPermissions:
    if provider != StorageProvider.CEPH or not capabilities.get("admin"):
        return _empty_permissions()
    if not endpoint.admin_access_key or not endpoint.admin_secret_key:
        return _empty_permissions()

    admin_endpoint = resolve_admin_endpoint(endpoint)
    if not admin_endpoint:
        return _empty_permissions()

    try:
        admin_client = client_factory(
            access_key=endpoint.admin_access_key,
            secret_key=endpoint.admin_secret_key,
            endpoint=admin_endpoint,
            region=endpoint.region,
            verify_tls=endpoint.verify_tls,
        )
        user_payload = admin_client.get_user_by_access_key(
            endpoint.admin_access_key,
            allow_not_found=True,
        )
        if not user_payload:
            return _empty_permissions()
        return _permissions_from_caps(user_payload.get("caps"))
    except RGWAdminError as exc:
        logger.warning(
            "Unable to evaluate admin ops permissions for endpoint id=%s name=%s: %s",
            endpoint.id,
            endpoint.name,
            exc,
        )
        return _empty_permissions()
