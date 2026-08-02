# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Canonicalize user notification payload objects.

Revision ID: 0080_canonical_user_notification_payloads
Revises: 0079_canonical_user_ui_preferences
Create Date: 2026-08-02 00:00:00.000000
"""

from __future__ import annotations

import json

from alembic import op
import sqlalchemy as sa


revision = "0080_canonical_user_notification_payloads"
down_revision = "0079_canonical_user_ui_preferences"
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
        sa.text("SELECT id, payload_json FROM user_notifications")
    ).mappings()
    for row in rows:
        bind.execute(
            sa.text(
                "UPDATE user_notifications SET payload_json = :payload WHERE id = :id"
            ),
            {
                "id": row["id"],
                "payload": _normalize_payload(row["payload_json"]),
            },
        )

    with op.batch_alter_table("user_notifications", schema=None) as batch_op:
        batch_op.alter_column(
            "payload_json",
            existing_type=sa.Text(),
            nullable=False,
            server_default="{}",
        )


def downgrade() -> None:
    with op.batch_alter_table("user_notifications", schema=None) as batch_op:
        batch_op.alter_column(
            "payload_json",
            existing_type=sa.Text(),
            nullable=True,
            server_default=None,
        )
