# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Canonicalize optional billing operation breakdowns.

Revision ID: 0086_canonical_billing_ops_breakdown
Revises: 0085_canonical_bucket_usage_stats_json
Create Date: 2026-08-02 00:00:00.000000
"""

from __future__ import annotations

import json

from alembic import op
import sqlalchemy as sa


revision = "0086_canonical_billing_ops_breakdown"
down_revision = "0085_canonical_bucket_usage_stats_json"
branch_labels = None
depends_on = None


def _normalize_breakdown(raw: object) -> str | None:
    try:
        payload = json.loads(raw) if isinstance(raw, str) else None
    except (TypeError, ValueError):
        return None
    if not isinstance(payload, dict):
        return None

    normalized: dict[str, int] = {}
    for key, value in payload.items():
        try:
            normalized[str(key)] = int(value)
        except (TypeError, ValueError):
            normalized[str(key)] = 0
    if not normalized:
        return None
    return json.dumps(normalized, separators=(",", ":"), sort_keys=True)


def upgrade() -> None:
    bind = op.get_bind()
    rows = bind.execute(
        sa.text(
            "SELECT id, ops_breakdown FROM billing_usage_daily "
            "WHERE ops_breakdown IS NOT NULL"
        )
    ).mappings()
    for row in rows:
        bind.execute(
            sa.text(
                "UPDATE billing_usage_daily SET ops_breakdown = :breakdown "
                "WHERE id = :id"
            ),
            {
                "id": row["id"],
                "breakdown": _normalize_breakdown(row["ops_breakdown"]),
            },
        )


def downgrade() -> None:
    pass
