# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Canonicalize bucket migration JSON state.

Revision ID: 0090_canonical_bucket_migration_json
Revises: 0089_canonical_s3_connection_endpoints
Create Date: 2026-08-02 00:00:00.000000
"""

from __future__ import annotations

import json

from alembic import op
import sqlalchemy as sa


revision = "0090_canonical_bucket_migration_json"
down_revision = "0089_canonical_s3_connection_endpoints"
branch_labels = None
depends_on = None


ITEM_OPERATIONAL_FIELDS = (
    "source_snapshot_json",
    "target_snapshot_json",
    "execution_plan_json",
    "replication_state_json",
    "source_policy_backup_json",
    "target_policy_backup_json",
)


def _canonical_object(raw: object, *, preserve_invalid: bool) -> str | None:
    if raw is None:
        return None
    if not isinstance(raw, str):
        payload: object = {"unparsed": str(raw)} if preserve_invalid else None
    else:
        try:
            payload = json.loads(raw)
        except (TypeError, ValueError):
            payload = {"unparsed": raw} if preserve_invalid else None
        else:
            if not isinstance(payload, dict):
                payload = {"value": payload} if preserve_invalid else None
    if payload is None:
        return None
    return json.dumps(payload, separators=(",", ":"), sort_keys=True)


def _update_field(
    bind,
    *,
    table: str,
    row_id: int,
    field: str,
    value: str | None,
) -> None:
    bind.execute(
        sa.text(f"UPDATE {table} SET {field} = :value WHERE id = :id"),
        {"id": row_id, "value": value},
    )


def upgrade() -> None:
    bind = op.get_bind()

    migrations = bind.execute(
        sa.text("SELECT id, precheck_report_json FROM bucket_migrations")
    ).mappings()
    for row in migrations:
        _update_field(
            bind,
            table="bucket_migrations",
            row_id=row["id"],
            field="precheck_report_json",
            value=_canonical_object(
                row["precheck_report_json"],
                preserve_invalid=False,
            ),
        )

    selected_fields = ", ".join(("id", "diff_sample_json", *ITEM_OPERATIONAL_FIELDS))
    items = bind.execute(
        sa.text(f"SELECT {selected_fields} FROM bucket_migration_items")
    ).mappings()
    for row in items:
        _update_field(
            bind,
            table="bucket_migration_items",
            row_id=row["id"],
            field="diff_sample_json",
            value=_canonical_object(
                row["diff_sample_json"],
                preserve_invalid=True,
            ),
        )
        for field in ITEM_OPERATIONAL_FIELDS:
            _update_field(
                bind,
                table="bucket_migration_items",
                row_id=row["id"],
                field=field,
                value=_canonical_object(row[field], preserve_invalid=False),
            )

    events = bind.execute(
        sa.text("SELECT id, metadata_json FROM bucket_migration_events")
    ).mappings()
    for row in events:
        _update_field(
            bind,
            table="bucket_migration_events",
            row_id=row["id"],
            field="metadata_json",
            value=_canonical_object(row["metadata_json"], preserve_invalid=True),
        )


def downgrade() -> None:
    pass
