# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from app.db import StorageEndpoint
from app.services.rgw_admin import RGWAdminClient, get_rgw_admin_client
from app.utils.storage_endpoint_features import resolve_admin_endpoint


def get_endpoint_admin_rgw_client(endpoint: StorageEndpoint) -> RGWAdminClient:
    return get_rgw_admin_client(
        access_key=endpoint.admin_access_key,
        secret_key=endpoint.admin_secret_key,
        endpoint=resolve_admin_endpoint(endpoint),
        region=endpoint.region,
        verify_tls=endpoint.verify_tls,
    )
