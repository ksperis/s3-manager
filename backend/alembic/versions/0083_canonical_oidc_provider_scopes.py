# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Canonicalize UI-managed OIDC provider scopes.

Revision ID: 0083_canonical_oidc_provider_scopes
Revises: 0082_canonical_app_settings_payload
Create Date: 2026-08-02 00:00:00.000000
"""

from __future__ import annotations

import json

from alembic import op
import sqlalchemy as sa


revision = "0083_canonical_oidc_provider_scopes"
down_revision = "0082_canonical_app_settings_payload"
branch_labels = None
depends_on = None


DEFAULT_SCOPES = ["openid", "email", "profile"]


def _normalize_scopes(raw: object) -> str:
    try:
        payload = json.loads(raw) if isinstance(raw, str) else []
    except (TypeError, ValueError):
        payload = []
    scopes = (
        [item.strip() for item in payload if isinstance(item, str) and item.strip()]
        if isinstance(payload, list)
        else []
    )
    return json.dumps(
        scopes or DEFAULT_SCOPES,
        separators=(",", ":"),
    )


def upgrade() -> None:
    bind = op.get_bind()
    rows = bind.execute(
        sa.text("SELECT id, scopes_json FROM oidc_providers")
    ).mappings()
    for row in rows:
        bind.execute(
            sa.text(
                "UPDATE oidc_providers SET scopes_json = :scopes WHERE id = :id"
            ),
            {
                "id": row["id"],
                "scopes": _normalize_scopes(row["scopes_json"]),
            },
        )


def downgrade() -> None:
    pass
