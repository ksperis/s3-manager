# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from app.db import StorageEndpoint as DBStorageEndpoint
from app.db import StorageProvider
from app.models.storage_endpoint import (
    StorageEndpoint,
    StorageEndpointAdminOpsPermissions,
)
from app.models.tagging import TagDefinitionSummary


def storage_endpoint_from_db(
    endpoint: DBStorageEndpoint,
    *,
    provider: StorageProvider,
    features: dict[str, dict[str, object]],
    capabilities: dict[str, bool],
    admin_ops_permissions: StorageEndpointAdminOpsPermissions,
    tags: list[TagDefinitionSummary] | None = None,
) -> StorageEndpoint:
    return StorageEndpoint(
        id=endpoint.id,
        name=endpoint.name,
        endpoint_url=endpoint.endpoint_url,
        admin_endpoint=features.get("admin", {}).get("endpoint"),
        region=endpoint.region,
        force_path_style=bool(getattr(endpoint, "force_path_style", False)),
        verify_tls=bool(getattr(endpoint, "verify_tls", True)),
        latitude=endpoint.latitude,
        longitude=endpoint.longitude,
        provider=provider,
        admin_access_key=endpoint.admin_access_key,
        supervision_access_key=endpoint.supervision_access_key,
        ceph_admin_access_key=endpoint.ceph_admin_access_key,
        capabilities=capabilities,
        admin_ops_permissions=admin_ops_permissions,
        is_default=bool(endpoint.is_default),
        is_editable=bool(endpoint.is_editable),
        created_at=endpoint.created_at,
        updated_at=endpoint.updated_at,
        tags=tags or [],
        has_admin_secret=bool(endpoint.admin_secret_key),
        has_supervision_secret=bool(endpoint.supervision_secret_key),
        has_ceph_admin_secret=bool(endpoint.ceph_admin_secret_key),
        features_config=endpoint.features_config,
        features=features,
    )
