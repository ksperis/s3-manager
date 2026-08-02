# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Canonicalize account Portal settings overrides.

Revision ID: 0088_canonical_portal_settings_override
Revises: 0087_canonical_audit_metadata
Create Date: 2026-08-02 00:00:00.000000
"""

from __future__ import annotations

import json

from alembic import op
import sqlalchemy as sa


revision = "0088_canonical_portal_settings_override"
down_revision = "0087_canonical_audit_metadata"
branch_labels = None
depends_on = None


BOOLEAN_FIELDS = (
    "allow_portal_key",
    "browser_access_enabled",
    "allow_private_storage_space_create",
    "allow_portal_named_bucket_create",
    "allow_portal_user_access_key_create",
    "server_access_logging_enabled",
    "storage_space_version_cleanup_enabled",
)
BUCKET_BOOLEAN_FIELDS = (
    "versioning",
    "enable_cors",
    "enable_lifecycle",
)


def _normalize_bucket_defaults(raw: object) -> dict[str, object]:
    if not isinstance(raw, dict):
        return {}
    normalized: dict[str, object] = {}
    for field in BUCKET_BOOLEAN_FIELDS:
        value = raw.get(field)
        if isinstance(value, bool):
            normalized[field] = value

    expiration_days = raw.get("noncurrent_version_expiration_days")
    if (
        isinstance(expiration_days, int)
        and not isinstance(expiration_days, bool)
        and expiration_days >= 1
    ):
        normalized["noncurrent_version_expiration_days"] = expiration_days

    origins = raw.get("cors_allowed_origins")
    if isinstance(origins, list) and all(isinstance(item, str) for item in origins):
        normalized["cors_allowed_origins"] = origins
    return normalized


def _normalize_override(raw: object) -> str | None:
    try:
        payload = json.loads(raw) if isinstance(raw, str) else None
    except (TypeError, ValueError):
        return None
    if not isinstance(payload, dict):
        return None

    source = payload.get("admin") if "admin" in payload else payload
    if not isinstance(source, dict):
        return None

    normalized: dict[str, object] = {}
    for field in BOOLEAN_FIELDS:
        value = source.get(field)
        if isinstance(value, bool):
            normalized[field] = value

    bucket_defaults = _normalize_bucket_defaults(source.get("bucket_defaults"))
    if bucket_defaults:
        normalized["bucket_defaults"] = bucket_defaults
    if not normalized:
        return None
    return json.dumps(normalized, separators=(",", ":"), sort_keys=True)


def upgrade() -> None:
    bind = op.get_bind()
    rows = bind.execute(
        sa.text(
            "SELECT id, portal_settings_override FROM s3_accounts "
            "WHERE portal_settings_override IS NOT NULL"
        )
    ).mappings()
    for row in rows:
        bind.execute(
            sa.text(
                "UPDATE s3_accounts "
                "SET portal_settings_override = :portal_settings_override "
                "WHERE id = :id"
            ),
            {
                "id": row["id"],
                "portal_settings_override": _normalize_override(
                    row["portal_settings_override"]
                ),
            },
        )


def downgrade() -> None:
    pass
