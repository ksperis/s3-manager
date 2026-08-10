# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Reorganize Manager global feature settings.

Revision ID: 0102_reorganize_manager_global_settings
Revises: 0101_simplify_manager_ceph_permissions
Create Date: 2026-08-10
"""

from __future__ import annotations

import json

from alembic import op
import sqlalchemy as sa


revision = "0102_reorganize_manager_global_settings"
down_revision = "0101_simplify_manager_ceph_permissions"
branch_labels = None
depends_on = None


_OLD_METRICS_SETTING = "allow_manager_user_usage_stats"
_METRICS_SETTING = "manager_rgw_usage_metrics_enabled"
_INTERMEDIATE_KEY_SETTING = "ceph_s3_user_access_key_management_enabled"
_KEY_SETTING = "manager_ceph_s3_user_keys_enabled"


def _load_settings_payload(raw: object, *, location: str) -> dict:
    try:
        payload = json.loads(raw) if isinstance(raw, str) else None
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{location} must contain a JSON object") from exc
    if not isinstance(payload, dict):
        raise ValueError(f"{location} must contain a JSON object")

    sections = {
        "general": (_INTERMEDIATE_KEY_SETTING, _KEY_SETTING),
        "manager": (_OLD_METRICS_SETTING, _METRICS_SETTING),
    }
    for section_name, fields in sections.items():
        section = payload.get(section_name)
        if section is not None and not isinstance(section, dict):
            raise ValueError(f"{location}.{section_name} must contain a JSON object")
        if isinstance(section, dict):
            for field in fields:
                if field in section and not isinstance(section[field], bool):
                    raise ValueError(f"{location}.{section_name}.{field} must be a boolean")
    return payload


def _dump_settings_payload(payload: dict) -> str:
    return json.dumps(payload, separators=(",", ":"), sort_keys=True)


def _rename_setting(section: dict, *, source: str, target: str, default: bool) -> bool:
    if source in section:
        section[target] = section.pop(source)
        return True
    if target not in section:
        section[target] = default
        return True
    return False


def _settings_updates(*, downgrade: bool) -> list[dict[str, str]]:
    bind = op.get_bind()
    rows = bind.execute(sa.text("SELECT key, payload_json FROM app_settings")).mappings().all()
    updates: list[dict[str, str]] = []
    for row in rows:
        payload = _load_settings_payload(
            row["payload_json"],
            location=f"app_settings[{row['key']}].payload_json",
        )
        changed = False
        if downgrade:
            general = payload.get("general")
            if isinstance(general, dict) and _KEY_SETTING in general:
                general[_INTERMEDIATE_KEY_SETTING] = general.pop(_KEY_SETTING)
                changed = True
            manager = payload.get("manager")
            if isinstance(manager, dict) and _METRICS_SETTING in manager:
                manager[_OLD_METRICS_SETTING] = manager.pop(_METRICS_SETTING)
                changed = True
        else:
            general = payload.get("general")
            if not isinstance(general, dict):
                general = {}
                payload["general"] = general
                changed = True
            manager = payload.get("manager")
            if not isinstance(manager, dict):
                manager = {}
                payload["manager"] = manager
                changed = True
            changed = _rename_setting(
                general,
                source=_INTERMEDIATE_KEY_SETTING,
                target=_KEY_SETTING,
                default=True,
            ) or changed
            changed = _rename_setting(
                manager,
                source=_OLD_METRICS_SETTING,
                target=_METRICS_SETTING,
                default=True,
            ) or changed
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
    _apply_settings_updates(_settings_updates(downgrade=False))


def downgrade() -> None:
    _apply_settings_updates(_settings_updates(downgrade=True))
