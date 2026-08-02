# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Canonicalize persisted audit metadata as JSON objects.

Revision ID: 0087_canonical_audit_metadata
Revises: 0086_canonical_billing_ops_breakdown
Create Date: 2026-08-02 00:00:00.000000
"""

from __future__ import annotations

import json

from alembic import op
import sqlalchemy as sa


revision = "0087_canonical_audit_metadata"
down_revision = "0086_canonical_billing_ops_breakdown"
branch_labels = None
depends_on = None


def _normalize_metadata(raw: object) -> str:
    if not isinstance(raw, str):
        payload: object = {"unparsed": str(raw)}
    else:
        try:
            payload = json.loads(raw)
        except (TypeError, ValueError):
            payload = {"unparsed": raw}
        else:
            if not isinstance(payload, dict):
                payload = {"value": payload}
    return json.dumps(payload, separators=(",", ":"), sort_keys=True)


def upgrade() -> None:
    bind = op.get_bind()
    rows = bind.execute(
        sa.text(
            "SELECT id, metadata_json FROM audit_logs "
            "WHERE metadata_json IS NOT NULL"
        )
    ).mappings()
    for row in rows:
        bind.execute(
            sa.text(
                "UPDATE audit_logs SET metadata_json = :metadata_json "
                "WHERE id = :id"
            ),
            {
                "id": row["id"],
                "metadata_json": _normalize_metadata(row["metadata_json"]),
            },
        )


def downgrade() -> None:
    pass
