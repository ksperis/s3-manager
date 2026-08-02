# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Canonicalize persisted user UI preferences.

Revision ID: 0079_canonical_user_ui_preferences
Revises: 0078_remove_legacy_tags_json
Create Date: 2026-08-02 00:00:00.000000
"""

from __future__ import annotations

import json

from alembic import op
import sqlalchemy as sa


revision = "0079_canonical_user_ui_preferences"
down_revision = "0078_remove_legacy_tags_json"
branch_labels = None
depends_on = None


VALID_THEMES = {"light", "dark"}


def _normalize_preferences(raw: object) -> str:
    try:
        payload = json.loads(raw) if isinstance(raw, str) else {}
    except (TypeError, ValueError):
        return "{}"
    if not isinstance(payload, dict):
        return "{}"

    normalized: dict[str, str] = {}
    theme = payload.get("theme")
    if theme is not None:
        if theme not in VALID_THEMES:
            return "{}"
        normalized["theme"] = theme

    selected_account = payload.get("selected_portal_account_id")
    if selected_account is not None:
        if not isinstance(selected_account, str):
            return "{}"
        selected_account = selected_account.strip()
        if selected_account:
            normalized["selected_portal_account_id"] = selected_account

    return json.dumps(normalized, separators=(",", ":"), sort_keys=True)


def upgrade() -> None:
    bind = op.get_bind()
    rows = bind.execute(
        sa.text("SELECT id, ui_preferences_json FROM users")
    ).mappings()
    for row in rows:
        bind.execute(
            sa.text(
                "UPDATE users SET ui_preferences_json = :preferences WHERE id = :id"
            ),
            {
                "id": row["id"],
                "preferences": _normalize_preferences(row["ui_preferences_json"]),
            },
        )


def downgrade() -> None:
    pass
