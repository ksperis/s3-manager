# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Replace private connection setting with explicit UI permissions.

Revision ID: 0100_private_connection_creation_permissions
Revises: 0099_migrate_legacy_portal_app_settings
Create Date: 2026-08-10
"""

from __future__ import annotations

import json

from alembic import op
import sqlalchemy as sa


revision = "0100_private_connection_creation_permissions"
down_revision = "0099_migrate_legacy_portal_app_settings"
branch_labels = None
depends_on = None


_LEGACY_FIELD = "allow_user_private_connections"
_MANUAL_COLUMN = "can_create_manual_private_connections"
_MANAGED_COLUMN = "can_provision_managed_private_connections"


def _load_settings_payload(raw: object, *, location: str) -> dict:
    try:
        payload = json.loads(raw) if isinstance(raw, str) else None
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{location} must contain a JSON object") from exc
    if not isinstance(payload, dict):
        raise ValueError(f"{location} must contain a JSON object")
    general = payload.get("general")
    if general is not None and not isinstance(general, dict):
        raise ValueError(f"{location}.general must contain a JSON object")
    if isinstance(general, dict) and _LEGACY_FIELD in general:
        if not isinstance(general[_LEGACY_FIELD], bool):
            raise ValueError(f"{location}.general.{_LEGACY_FIELD} must be a boolean")
    return payload


def _dump_settings_payload(payload: dict) -> str:
    return json.dumps(payload, separators=(",", ":"), sort_keys=True)


def upgrade() -> None:
    bind = op.get_bind()
    rows = bind.execute(
        sa.text("SELECT key, payload_json FROM app_settings")
    ).mappings().all()

    # Parse and validate every settings row before the first schema or data
    # mutation. A malformed row must not leave a partially upgraded database.
    settings_updates: list[dict[str, str]] = []
    legacy_default_enabled = False
    for row in rows:
        location = f"app_settings[{row['key']}].payload_json"
        payload = _load_settings_payload(row["payload_json"], location=location)
        general = payload.get("general")
        if row["key"] == "default" and isinstance(general, dict):
            legacy_default_enabled = bool(general.get(_LEGACY_FIELD, False))
        if isinstance(general, dict) and _LEGACY_FIELD in general:
            general.pop(_LEGACY_FIELD)
            settings_updates.append(
                {"key": row["key"], "payload_json": _dump_settings_payload(payload)}
            )

    for table_name in ("users", "ui_groups"):
        with op.batch_alter_table(table_name, schema=None) as batch_op:
            batch_op.add_column(
                sa.Column(_MANUAL_COLUMN, sa.Boolean(), nullable=False, server_default="0")
            )
            batch_op.add_column(
                sa.Column(_MANAGED_COLUMN, sa.Boolean(), nullable=False, server_default="0")
            )

    eligible_roles = ["ui_admin", "ui_superadmin"]
    if legacy_default_enabled:
        eligible_roles.append("ui_user")
    role_parameters = {f"role_{index}": role for index, role in enumerate(eligible_roles)}
    role_placeholders = ", ".join(f":role_{index}" for index in range(len(eligible_roles)))
    bind.execute(
        sa.text(
            f"UPDATE users SET {_MANUAL_COLUMN} = 1, {_MANAGED_COLUMN} = 1 "
            f"WHERE role IN ({role_placeholders})"
        ),
        role_parameters,
    )

    for values in settings_updates:
        bind.execute(
            sa.text(
                "UPDATE app_settings SET payload_json = :payload_json WHERE key = :key"
            ),
            values,
        )


def downgrade() -> None:
    # Per-subject grants and the removed global setting cannot be reconstructed.
    for table_name in ("ui_groups", "users"):
        with op.batch_alter_table(table_name, schema=None) as batch_op:
            batch_op.drop_column(_MANAGED_COLUMN)
            batch_op.drop_column(_MANUAL_COLUMN)
