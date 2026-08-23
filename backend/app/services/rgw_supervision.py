# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from app.db import StorageEndpoint
from app.services.rgw_admin import RGWAdminClient, get_rgw_admin_client
from app.services.s3_execution_context import S3ExecutionTarget
from app.utils.storage_endpoint_features import resolve_rgw_admin_api_endpoint


def _supervision_credentials_from_endpoint(endpoint: StorageEndpoint | None) -> tuple[str, str] | None:
    if endpoint is None:
        return None
    access_key = endpoint.supervision_access_key
    secret_key = endpoint.supervision_secret_key
    if not access_key or not secret_key:
        return None
    return access_key, secret_key


def get_supervision_credentials(account: S3ExecutionTarget) -> tuple[str, str] | None:
    return _supervision_credentials_from_endpoint(account.storage_endpoint)


def has_supervision_credentials(account: S3ExecutionTarget) -> bool:
    return get_supervision_credentials(account) is not None


def get_supervision_rgw_client(endpoint: StorageEndpoint) -> RGWAdminClient:
    credentials = _supervision_credentials_from_endpoint(endpoint)
    if not credentials:
        raise ValueError("Supervision credentials are not configured for this endpoint")
    access_key, secret_key = credentials
    admin_endpoint = resolve_rgw_admin_api_endpoint(endpoint)
    if not admin_endpoint:
        raise ValueError("Admin endpoint is not configured for this endpoint")
    return get_rgw_admin_client(
        access_key=access_key,
        secret_key=secret_key,
        endpoint=admin_endpoint,
        region=endpoint.region,
        verify_tls=endpoint.verify_tls,
    )
