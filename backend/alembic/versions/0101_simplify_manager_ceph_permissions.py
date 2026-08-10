# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Simplify Manager Ceph quota and access-key permissions.

Revision ID: 0101_simplify_manager_ceph_permissions
Revises: 0100_private_connection_creation_permissions
Create Date: 2026-08-10
"""

from __future__ import annotations

import json

from alembic import op
import sqlalchemy as sa


revision = "0101_simplify_manager_ceph_permissions"
down_revision = "0100_private_connection_creation_permissions"
branch_labels = None
depends_on = None


_OLD_KEY_SETTING = "manager_ceph_s3_user_keys_enabled"
_KEY_SETTING = "ceph_s3_user_access_key_management_enabled"
_QUOTA_SETTING = "bucket_quota_management_enabled"


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
    if isinstance(general, dict):
        for field in (_OLD_KEY_SETTING, _KEY_SETTING, _QUOTA_SETTING):
            if field in general and not isinstance(general[field], bool):
                raise ValueError(f"{location}.general.{field} must be a boolean")
    return payload


def _dump_settings_payload(payload: dict) -> str:
    return json.dumps(payload, separators=(",", ":"), sort_keys=True)


def _settings_updates(*, downgrade: bool) -> list[dict[str, str]]:
    bind = op.get_bind()
    rows = bind.execute(sa.text("SELECT key, payload_json FROM app_settings")).mappings().all()
    updates: list[dict[str, str]] = []
    for row in rows:
        payload = _load_settings_payload(
            row["payload_json"],
            location=f"app_settings[{row['key']}].payload_json",
        )
        general = payload.get("general")
        if not isinstance(general, dict):
            if downgrade:
                continue
            general = {}
            payload["general"] = general
            changed = True
        else:
            changed = False
        if downgrade:
            if _KEY_SETTING in general:
                general[_OLD_KEY_SETTING] = general.pop(_KEY_SETTING)
                changed = True
            if _QUOTA_SETTING in general:
                general.pop(_QUOTA_SETTING)
                changed = True
        else:
            if _OLD_KEY_SETTING in general:
                general[_KEY_SETTING] = general.pop(_OLD_KEY_SETTING)
                changed = True
            if _KEY_SETTING not in general:
                general[_KEY_SETTING] = True
                changed = True
            if _QUOTA_SETTING not in general:
                general[_QUOTA_SETTING] = True
                changed = True
        if changed:
            updates.append({"key": row["key"], "payload_json": _dump_settings_payload(payload)})
    return updates


def _apply_settings_updates(updates: list[dict[str, str]]) -> None:
    bind = op.get_bind()
    for values in updates:
        bind.execute(
            sa.text("UPDATE app_settings SET payload_json = :payload_json WHERE key = :key"),
            values,
        )


def upgrade() -> None:
    # Validate every persisted settings row before the first schema mutation.
    settings_updates = _settings_updates(downgrade=False)

    with op.batch_alter_table("s3_accounts", schema=None) as batch_op:
        batch_op.alter_column(
            "allow_manager_bucket_quota",
            new_column_name="allow_bucket_quota_management",
            existing_type=sa.Boolean(),
            existing_nullable=False,
        )

    with op.batch_alter_table("s3_users", schema=None) as batch_op:
        batch_op.alter_column(
            "allow_manager_bucket_quota",
            new_column_name="allow_bucket_quota_management",
            existing_type=sa.Boolean(),
            existing_nullable=False,
        )
        batch_op.alter_column(
            "allow_manager_ceph_s3_user_keys",
            new_column_name="allow_access_key_management",
            existing_type=sa.Boolean(),
            existing_nullable=False,
        )
        batch_op.add_column(
            sa.Column(
                "allow_managed_private_connection_provisioning",
                sa.Boolean(),
                nullable=False,
                server_default="0",
            )
        )

    op.execute(
        "UPDATE s3_users "
        "SET allow_managed_private_connection_provisioning = allow_access_key_management"
    )

    for table_name in ("users", "ui_groups"):
        with op.batch_alter_table(table_name, schema=None) as batch_op:
            batch_op.drop_column("can_access_manager_ceph_s3_user_keys")
            batch_op.drop_column("can_access_manager_bucket_quota")

    _apply_settings_updates(settings_updates)


def downgrade() -> None:
    settings_updates = _settings_updates(downgrade=True)

    for table_name in ("ui_groups", "users"):
        with op.batch_alter_table(table_name, schema=None) as batch_op:
            batch_op.add_column(
                sa.Column(
                    "can_access_manager_bucket_quota",
                    sa.Boolean(),
                    nullable=False,
                    server_default="0",
                )
            )
            batch_op.add_column(
                sa.Column(
                    "can_access_manager_ceph_s3_user_keys",
                    sa.Boolean(),
                    nullable=False,
                    server_default="0",
                )
            )

    op.execute(
        "UPDATE s3_users SET allow_access_key_management = "
        "CASE WHEN allow_access_key_management IS TRUE "
        "AND allow_managed_private_connection_provisioning IS TRUE THEN TRUE ELSE FALSE END"
    )

    with op.batch_alter_table("s3_users", schema=None) as batch_op:
        batch_op.drop_column("allow_managed_private_connection_provisioning")
        batch_op.alter_column(
            "allow_access_key_management",
            new_column_name="allow_manager_ceph_s3_user_keys",
            existing_type=sa.Boolean(),
            existing_nullable=False,
        )
        batch_op.alter_column(
            "allow_bucket_quota_management",
            new_column_name="allow_manager_bucket_quota",
            existing_type=sa.Boolean(),
            existing_nullable=False,
        )

    with op.batch_alter_table("s3_accounts", schema=None) as batch_op:
        batch_op.alter_column(
            "allow_bucket_quota_management",
            new_column_name="allow_manager_bucket_quota",
            existing_type=sa.Boolean(),
            existing_nullable=False,
        )

    _apply_settings_updates(settings_updates)
