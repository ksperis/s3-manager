# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Migrate legacy Portal application settings.

Revision ID: 0099_migrate_legacy_portal_app_settings
Revises: 0098_encrypt_plaintext_secrets
Create Date: 2026-08-10
"""

from __future__ import annotations

import json

from alembic import op
import sqlalchemy as sa


revision = "0099_migrate_legacy_portal_app_settings"
down_revision = "0098_encrypt_plaintext_secrets"
branch_labels = None
depends_on = None


_LEGACY_CREATE_FIELD = "allow_portal_user_bucket_create"
_CURRENT_CREATE_FIELD = "allow_private_storage_space_create"
_REMOVED_POLICY_FIELDS = (
    "bucket_access_policy",
    "iam_group_manager_policy",
    "iam_group_user_policy",
)


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


def _migrate_payload(raw: object, *, location: str) -> tuple[dict, bool]:
    payload = _load_object(raw, location=location)
    if "portal" not in payload:
        return payload, False

    portal = payload["portal"]
    if not isinstance(portal, dict):
        raise ValueError(f"{location}.portal must contain a JSON object")

    changed = False
    if _LEGACY_CREATE_FIELD in portal:
        legacy_value = portal[_LEGACY_CREATE_FIELD]
        if not isinstance(legacy_value, bool):
            raise ValueError(
                f"{location}.portal.{_LEGACY_CREATE_FIELD} must be a boolean"
            )
        portal.setdefault(_CURRENT_CREATE_FIELD, legacy_value)
        portal.pop(_LEGACY_CREATE_FIELD)
        changed = True

    for field in _REMOVED_POLICY_FIELDS:
        if field in portal:
            portal.pop(field)
            changed = True

    return payload, changed


def upgrade() -> None:
    bind = op.get_bind()
    rows = bind.execute(
        sa.text("SELECT key, payload_json FROM app_settings")
    ).mappings().all()

    # Validate and transform every row before issuing the first update so an
    # invalid legacy payload cannot leave a partially migrated settings table.
    updates: list[dict[str, str]] = []
    for row in rows:
        payload, changed = _migrate_payload(
            row["payload_json"],
            location=f"app_settings[{row['key']}].payload_json",
        )
        if changed:
            updates.append(
                {
                    "key": row["key"],
                    "payload_json": _dump_object(payload),
                }
            )

    for values in updates:
        bind.execute(
            sa.text(
                "UPDATE app_settings SET payload_json = :payload_json "
                "WHERE key = :key"
            ),
            values,
        )


def downgrade() -> None:
    # Removed policy values cannot be reconstructed, and the current create
    # setting may have existed before the legacy field was migrated.
    pass
