# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Canonicalize Portal request payload and result objects.

Revision ID: 0081_canonical_portal_request_json
Revises: 0080_canonical_user_notification_payloads
Create Date: 2026-08-02 00:00:00.000000
"""

from __future__ import annotations

import json

from alembic import op
import sqlalchemy as sa


revision = "0081_canonical_portal_request_json"
down_revision = "0080_canonical_user_notification_payloads"
branch_labels = None
depends_on = None


def _normalize_object(raw: object) -> str:
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
        sa.text(
            "SELECT id, payload_json, result_json FROM portal_admin_requests"
        )
    ).mappings()
    for row in rows:
        bind.execute(
            sa.text(
                "UPDATE portal_admin_requests "
                "SET payload_json = :payload, result_json = :result WHERE id = :id"
            ),
            {
                "id": row["id"],
                "payload": _normalize_object(row["payload_json"]),
                "result": (
                    _normalize_object(row["result_json"])
                    if row["result_json"] is not None
                    else None
                ),
            },
        )


def downgrade() -> None:
    pass
