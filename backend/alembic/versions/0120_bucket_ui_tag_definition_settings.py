# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Make Ceph Admin bucket UI tag labels globally unique.

Revision ID: 0120_bucket_ui_tag_definition_settings
Revises: 0119_first_admin_bootstrap
Create Date: 2026-08-27
"""

from __future__ import annotations

from collections import defaultdict

from alembic import op
import sqlalchemy as sa


revision = "0120_bucket_ui_tag_definition_settings"
down_revision = "0119_first_admin_bootstrap"
branch_labels = None
depends_on = None


_DOMAIN = "bucket_ui_ceph_admin"
_INDEX_NAME = "uq_tag_definitions_bucket_ui_ceph_admin_label"


def _label_key(value: object) -> str:
    return str(value or "").strip().casefold()


def _rename_conflicts(connection: sa.Connection) -> None:
    rows = connection.execute(
        sa.text(
            """
            SELECT id, label, label_key, owner_user_id
            FROM tag_definitions
            WHERE domain_kind = :domain_kind
            ORDER BY id
            """
        ),
        {"domain_kind": _DOMAIN},
    ).mappings().all()
    used_keys = {_label_key(row["label_key"]) for row in rows}
    groups: dict[str, list[sa.RowMapping]] = defaultdict(list)
    for row in rows:
        groups[_label_key(row["label_key"])].append(row)

    for items in groups.values():
        if len(items) < 2:
            continue
        shared = [row for row in items if row["owner_user_id"] is None]
        keeper = min(shared or items, key=lambda row: int(row["id"]))
        for row in items:
            if int(row["id"]) == int(keeper["id"]):
                continue
            base = f"{str(row['label']).strip()} (private {int(row['id'])})"
            candidate = base
            suffix = 2
            while _label_key(candidate) in used_keys:
                candidate = f"{base} {suffix}"
                suffix += 1
            candidate_key = _label_key(candidate)
            connection.execute(
                sa.text(
                    """
                    UPDATE tag_definitions
                    SET label = :label, label_key = :label_key
                    WHERE id = :definition_id
                    """
                ),
                {
                    "label": candidate,
                    "label_key": candidate_key,
                    "definition_id": int(row["id"]),
                },
            )
            used_keys.add(candidate_key)


def upgrade() -> None:
    connection = op.get_bind()
    _rename_conflicts(connection)
    op.create_index(
        _INDEX_NAME,
        "tag_definitions",
        ["label_key"],
        unique=True,
        sqlite_where=sa.text("domain_kind = 'bucket_ui_ceph_admin'"),
        postgresql_where=sa.text("domain_kind = 'bucket_ui_ceph_admin'"),
    )


def downgrade() -> None:
    # Renamed private definitions intentionally keep their collision-safe names.
    op.drop_index(_INDEX_NAME, table_name="tag_definitions")
