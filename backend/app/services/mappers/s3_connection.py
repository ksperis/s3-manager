# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Any

from app.db.s3_connection import S3Connection as DBS3Connection
from app.models.s3_connection import S3Connection
from app.models.tagging import TagDefinitionSummary
from app.utils.s3_connection_endpoint import resolve_connection_details


def mask_access_key_id(value: str) -> str:
    if not value:
        return ""
    trimmed = value.strip()
    if len(trimmed) <= 8:
        return "***" + trimmed[-2:]
    return f"{trimmed[:4]}***{trimmed[-4:]}"


def s3_connection_from_db(
    row: DBS3Connection,
    *,
    capabilities: dict[str, Any],
    tags: list[TagDefinitionSummary] | None = None,
) -> S3Connection:
    details = resolve_connection_details(row)
    return S3Connection(
        id=row.id,
        name=row.name,
        provider_hint=details.provider,
        storage_endpoint_id=row.storage_endpoint_id,
        created_by_user_id=row.created_by_user_id,
        is_shared=bool(row.is_shared),
        is_active=bool(row.is_active),
        access_manager=bool(row.access_manager),
        access_browser=bool(row.access_browser),
        server_managed=bool(row.server_managed),
        managed_access_state=(
            row.managed_private_access.state
            if getattr(row, "managed_private_access", None) is not None
            else None
        ),
        credential_owner_type=row.credential_owner_type,
        credential_owner_identifier=row.credential_owner_identifier,
        endpoint_url=details.endpoint_url or "",
        region=details.region,
        access_key_id=mask_access_key_id(row.access_key_id),
        force_path_style=details.force_path_style,
        verify_tls=details.verify_tls,
        capabilities=capabilities,
        tags=tags or [],
        created_at=row.created_at,
        updated_at=row.updated_at,
        last_used_at=row.last_used_at,
    )
