# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Remove the dead Portal key setting from persisted JSON.

Revision ID: 0093_remove_dead_portal_key_setting
Revises: 0092_canonical_user_roles
Create Date: 2026-08-02
"""

from __future__ import annotations

import json

from alembic import op
import sqlalchemy as sa


revision = "0093_remove_dead_portal_key_setting"
down_revision = "0092_canonical_user_roles"
branch_labels = None
depends_on = None


_REMOVED_FIELD = "allow_portal_key"


def _load_object(raw: object, *, location: str) -> dict:
    try:
        payload = json.loads(raw) if isinstance(raw, str) else None
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{location} must contain a JSON object") from exc
    if not isinstance(payload, dict):
        raise ValueError(f"{location} must contain a JSON object")
    return payload


def _dump_object(payload: dict) -> str:
    return json.dumps(payload, separators=(",", ":"), sort_keys=True)


def upgrade() -> None:
    bind = op.get_bind()

    account_rows = bind.execute(
        sa.text(
            "SELECT id, portal_settings_override FROM s3_accounts "
            "WHERE portal_settings_override IS NOT NULL"
        )
    ).mappings()
    for row in account_rows:
        payload = _load_object(
            row["portal_settings_override"],
            location=f"s3_accounts[{row['id']}].portal_settings_override",
        )
        if _REMOVED_FIELD not in payload:
            continue
        payload.pop(_REMOVED_FIELD)
        bind.execute(
            sa.text(
                "UPDATE s3_accounts "
                "SET portal_settings_override = :portal_settings_override "
                "WHERE id = :id"
            ),
            {
                "id": row["id"],
                "portal_settings_override": _dump_object(payload) if payload else None,
            },
        )

    settings_rows = bind.execute(
        sa.text("SELECT key, payload_json FROM app_settings")
    ).mappings()
    for row in settings_rows:
        payload = _load_object(
            row["payload_json"],
            location=f"app_settings[{row['key']}].payload_json",
        )
        portal = payload.get("portal")
        if not isinstance(portal, dict) or _REMOVED_FIELD not in portal:
            continue
        portal.pop(_REMOVED_FIELD)
        bind.execute(
            sa.text(
                "UPDATE app_settings SET payload_json = :payload_json "
                "WHERE key = :key"
            ),
            {
                "key": row["key"],
                "payload_json": _dump_object(payload),
            },
        )


def downgrade() -> None:
    # The setting never affected application behavior, and discarded values
    # cannot be reconstructed meaningfully.
    pass
