# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Canonicalize S3 session capability snapshots.

Revision ID: 0075_canonical_s3_session_capabilities
Revises: 0074_timezone_aware_utc_timestamps
Create Date: 2026-08-02 00:00:00.000000
"""

from __future__ import annotations

import json

from alembic import op
import sqlalchemy as sa


revision = "0075_canonical_s3_session_capabilities"
down_revision = "0074_timezone_aware_utc_timestamps"
branch_labels = None
depends_on = None


CAPABILITY_DEFAULTS: dict[str, bool | None] = {
    "can_manage_iam": False,
    "can_manage_buckets": True,
    "can_view_traffic": False,
    "access_browser": True,
    "endpoint_url": None,
}
BOOLEAN_CAPABILITY_KEYS = (
    "can_manage_iam",
    "can_manage_buckets",
    "can_view_traffic",
    "access_browser",
)


def _serialize_capabilities(value: dict[str, bool | str | None]) -> str:
    return json.dumps(value, separators=(",", ":"), sort_keys=True)


def _normalize_capabilities(raw: object) -> str:
    try:
        payload = json.loads(raw) if isinstance(raw, str) and raw.strip() else {}
    except (TypeError, ValueError):
        payload = {}
    if not isinstance(payload, dict):
        payload = {}

    normalized: dict[str, bool | str | None] = dict(CAPABILITY_DEFAULTS)
    for key in BOOLEAN_CAPABILITY_KEYS:
        value = payload.get(key, CAPABILITY_DEFAULTS[key])
        if not isinstance(value, bool):
            return _serialize_capabilities(dict(CAPABILITY_DEFAULTS))
        normalized[key] = value

    endpoint_url = payload.get("endpoint_url")
    if endpoint_url is not None and not isinstance(endpoint_url, str):
        return _serialize_capabilities(dict(CAPABILITY_DEFAULTS))
    if isinstance(endpoint_url, str):
        normalized["endpoint_url"] = endpoint_url.strip().rstrip("/") or None

    return _serialize_capabilities(normalized)


def upgrade() -> None:
    bind = op.get_bind()
    rows = bind.execute(sa.text("SELECT id, capabilities FROM s3_sessions")).mappings()
    for row in rows:
        bind.execute(
            sa.text("UPDATE s3_sessions SET capabilities = :capabilities WHERE id = :id"),
            {
                "id": row["id"],
                "capabilities": _normalize_capabilities(row["capabilities"]),
            },
        )

    with op.batch_alter_table("s3_sessions", schema=None) as batch_op:
        batch_op.alter_column(
            "capabilities",
            existing_type=sa.Text(),
            nullable=False,
        )


def downgrade() -> None:
    with op.batch_alter_table("s3_sessions", schema=None) as batch_op:
        batch_op.alter_column(
            "capabilities",
            existing_type=sa.Text(),
            nullable=True,
        )
