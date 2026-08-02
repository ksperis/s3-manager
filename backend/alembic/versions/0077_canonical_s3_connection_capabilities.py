# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Canonicalize S3 connection capability profiles.

Revision ID: 0077_canonical_s3_connection_capabilities
Revises: 0076_remove_redundant_provider_indexes
Create Date: 2026-08-02 00:00:00.000000
"""

from __future__ import annotations

import json

from alembic import op
import sqlalchemy as sa


revision = "0077_canonical_s3_connection_capabilities"
down_revision = "0076_remove_redundant_provider_indexes"
branch_labels = None
depends_on = None


DEFAULT_CAPABILITIES = {"can_manage_iam": False}
DEFAULT_CAPABILITIES_JSON = '{"can_manage_iam":false}'


def _normalize_capabilities(raw: object) -> str:
    try:
        payload = json.loads(raw) if isinstance(raw, str) else {}
    except (TypeError, ValueError):
        payload = {}
    if not isinstance(payload, dict):
        payload = {}

    payload.pop("iam_capable", None)
    if not isinstance(payload.get("can_manage_iam"), bool):
        payload["can_manage_iam"] = False
    return json.dumps(payload, separators=(",", ":"), sort_keys=True)


def upgrade() -> None:
    bind = op.get_bind()
    rows = bind.execute(
        sa.text("SELECT id, capabilities_json FROM s3_connections")
    ).mappings()
    for row in rows:
        bind.execute(
            sa.text(
                "UPDATE s3_connections "
                "SET capabilities_json = :capabilities_json WHERE id = :id"
            ),
            {
                "id": row["id"],
                "capabilities_json": _normalize_capabilities(
                    row["capabilities_json"]
                ),
            },
        )

    with op.batch_alter_table("s3_connections", schema=None) as batch_op:
        batch_op.alter_column(
            "capabilities_json",
            existing_type=sa.Text(),
            nullable=False,
            server_default=DEFAULT_CAPABILITIES_JSON,
        )


def downgrade() -> None:
    with op.batch_alter_table("s3_connections", schema=None) as batch_op:
        batch_op.alter_column(
            "capabilities_json",
            existing_type=sa.Text(),
            nullable=False,
            server_default="{}",
        )
