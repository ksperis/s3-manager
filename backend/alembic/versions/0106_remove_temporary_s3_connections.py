# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Remove the retired temporary S3 connection subsystem.

Revision ID: 0106_remove_temporary_s3_connections
Revises: 0105_reconcile_schema_drift
Create Date: 2026-08-10
"""

from __future__ import annotations

from typing import Any

from alembic import op
import sqlalchemy as sa


revision = "0106_remove_temporary_s3_connections"
down_revision = "0105_reconcile_schema_drift"
branch_labels = None
depends_on = None


_OBSOLETE_COLUMNS = {
    "is_temporary",
    "temp_user_uid",
    "temp_access_key_id",
}
_s3_connections = sa.table(
    "s3_connections",
    sa.column("id", sa.Integer()),
    sa.column("name", sa.String()),
    sa.column("is_temporary", sa.Boolean()),
    sa.column("temp_user_uid", sa.String()),
    sa.column("temp_access_key_id", sa.String()),
)


def _column_names(bind: Any) -> set[str]:
    return {
        str(column["name"])
        for column in sa.inspect(bind).get_columns("s3_connections")
    }


def _require_complete_legacy_schema(bind: Any) -> None:
    missing = sorted(_OBSOLETE_COLUMNS - _column_names(bind))
    if missing:
        raise RuntimeError(
            "Cannot remove temporary S3 connection columns because the legacy "
            f"schema is incomplete: missing {', '.join(missing)}. Reconcile the "
            "database schema before upgrading."
        )


def _require_no_temporary_connections(bind: Any) -> None:
    rows = bind.execute(
        sa.select(
            _s3_connections.c.id,
            _s3_connections.c.name,
            _s3_connections.c.temp_user_uid,
            _s3_connections.c.temp_access_key_id,
        )
        .where(_s3_connections.c.is_temporary.is_(True))
        .order_by(_s3_connections.c.id.asc())
    ).all()
    if not rows:
        return

    details = ", ".join(
        f"id={row.id} name={row.name!r} temp_user_uid={row.temp_user_uid!r} "
        f"temp_access_key_id={row.temp_access_key_id!r}"
        for row in rows[:10]
    )
    suffix = " ..." if len(rows) > 10 else ""
    raise RuntimeError(
        "Cannot remove the temporary S3 connection subsystem while temporary "
        f"connections still exist: {details}{suffix}. With the current release, "
        "revoke each recorded remote RGW access key, delete the corresponding "
        "temporary connection row, verify a restorable database backup, and then "
        "retry the upgrade."
    )


def upgrade() -> None:
    bind = op.get_bind()
    _require_complete_legacy_schema(bind)
    _require_no_temporary_connections(bind)
    with op.batch_alter_table("s3_connections", schema=None) as batch_op:
        batch_op.drop_column("temp_access_key_id")
        batch_op.drop_column("temp_user_uid")
        batch_op.drop_column("is_temporary")


def downgrade() -> None:
    bind = op.get_bind()
    existing = _column_names(bind)
    with op.batch_alter_table("s3_connections", schema=None) as batch_op:
        if "is_temporary" not in existing:
            batch_op.add_column(
                sa.Column(
                    "is_temporary",
                    sa.Boolean(),
                    nullable=False,
                    server_default=sa.text("0"),
                )
            )
        if "temp_user_uid" not in existing:
            batch_op.add_column(sa.Column("temp_user_uid", sa.String(), nullable=True))
        if "temp_access_key_id" not in existing:
            batch_op.add_column(sa.Column("temp_access_key_id", sa.String(), nullable=True))
