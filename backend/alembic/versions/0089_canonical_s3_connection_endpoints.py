# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Canonicalize custom S3 connection endpoints.

Revision ID: 0089_canonical_s3_connection_endpoints
Revises: 0088_canonical_portal_settings_override
Create Date: 2026-08-02 00:00:00.000000
"""

from __future__ import annotations

import json

from alembic import op
import sqlalchemy as sa


revision = "0089_canonical_s3_connection_endpoints"
down_revision = "0088_canonical_portal_settings_override"
branch_labels = None
depends_on = None


def _optional_text(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized or None


def _normalize_custom_endpoint(raw: object) -> str:
    try:
        payload = json.loads(raw) if isinstance(raw, str) else None
    except (TypeError, ValueError) as exc:
        raise ValueError("configuration is not valid JSON") from exc
    if not isinstance(payload, dict):
        raise ValueError("configuration is not a JSON object")

    endpoint_url = _optional_text(payload.get("endpoint_url"))
    if endpoint_url is None:
        raise ValueError("endpoint_url is missing")
    endpoint_url = endpoint_url.rstrip("/")
    if not endpoint_url:
        raise ValueError("endpoint_url is empty")

    provider = _optional_text(payload.get("provider"))
    if provider is None:
        provider = _optional_text(payload.get("provider_hint"))
    normalized = {
        "endpoint_url": endpoint_url,
        "force_path_style": (
            payload["force_path_style"]
            if isinstance(payload.get("force_path_style"), bool)
            else False
        ),
        "provider": provider,
        "region": _optional_text(payload.get("region")),
        "verify_tls": (
            payload["verify_tls"]
            if isinstance(payload.get("verify_tls"), bool)
            else True
        ),
    }
    return json.dumps(normalized, separators=(",", ":"), sort_keys=True)


def upgrade() -> None:
    bind = op.get_bind()
    rows = bind.execute(
        sa.text(
            "SELECT id, storage_endpoint_id, custom_endpoint_config "
            "FROM s3_connections"
        )
    ).mappings()
    for row in rows:
        if row["storage_endpoint_id"] is not None:
            normalized = None
        else:
            try:
                normalized = _normalize_custom_endpoint(
                    row["custom_endpoint_config"]
                )
            except ValueError as exc:
                raise RuntimeError(
                    f"S3 connection {row['id']} has no usable custom endpoint: {exc}"
                ) from exc
        bind.execute(
            sa.text(
                "UPDATE s3_connections "
                "SET custom_endpoint_config = :custom_endpoint_config "
                "WHERE id = :id"
            ),
            {
                "id": row["id"],
                "custom_endpoint_config": normalized,
            },
        )


def downgrade() -> None:
    pass
