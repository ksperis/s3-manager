# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Canonicalize persisted application settings JSON objects.

Revision ID: 0082_canonical_app_settings_payload
Revises: 0081_canonical_portal_request_json
Create Date: 2026-08-02 00:00:00.000000
"""

from __future__ import annotations

import json

from alembic import op
import sqlalchemy as sa


revision = "0082_canonical_app_settings_payload"
down_revision = "0081_canonical_portal_request_json"
branch_labels = None
depends_on = None


def _normalize_payload(raw: object) -> str:
    try:
        payload = json.loads(raw) if isinstance(raw, str) else {}
    except (TypeError, ValueError):
        payload = {}
    if not isinstance(payload, dict):
        payload = {}
    return json.dumps(payload, separators=(",", ":"), sort_keys=True)


def upgrade() -> None:
    bind = op.get_bind()
    rows = bind.execute(
        sa.text("SELECT key, payload_json FROM app_settings")
    ).mappings()
    for row in rows:
        bind.execute(
            sa.text(
                "UPDATE app_settings SET payload_json = :payload WHERE key = :key"
            ),
            {
                "key": row["key"],
                "payload": _normalize_payload(row["payload_json"]),
            },
        )


def downgrade() -> None:
    pass
