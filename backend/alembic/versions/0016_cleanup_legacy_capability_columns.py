# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Drop legacy capability columns and keep JSON capabilities as source of truth."""

from __future__ import annotations

import json

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0016_cleanup_legacy_capability_columns"
down_revision = "0015_s3_connection_access_flags"
branch_labels = None
depends_on = None


def _parse_json_dict(value: object) -> dict:
    if not value:
        return {}
    if isinstance(value, dict):
        return value
    try:
        parsed = json.loads(str(value))
    except Exception:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def upgrade() -> None:
    bind = op.get_bind()

    # Migrate S3 connection capability probe to canonical JSON key.
    rows = bind.execute(
        sa.text("SELECT id, capabilities_json, iam_capable FROM s3_connections")
    ).fetchall()
    for row in rows:
        caps = _parse_json_dict(row[1])
        legacy = caps.get("iam_capable")
        if isinstance(caps.get("can_manage_iam"), bool):
            can_manage_iam = bool(caps["can_manage_iam"])
        elif isinstance(legacy, bool):
            can_manage_iam = bool(legacy)
        else:
            can_manage_iam = bool(row[2])
        caps["can_manage_iam"] = can_manage_iam
        caps.pop("iam_capable", None)
        bind.execute(
            sa.text("UPDATE s3_connections SET capabilities_json = :caps WHERE id = :id"),
            {"id": row[0], "caps": json.dumps(caps)},
        )

    # Migrate S3 session capability snapshots to JSON-only.
    rows = bind.execute(
        sa.text(
            """
            SELECT id, capabilities, can_manage_iam, can_manage_buckets, can_view_traffic
            FROM s3_sessions
            """
        )
    ).fetchall()
    for row in rows:
        caps = _parse_json_dict(row[1])
        caps["can_manage_iam"] = bool(caps.get("can_manage_iam", row[2]))
        caps["can_manage_buckets"] = bool(caps.get("can_manage_buckets", row[3]))
        caps["can_view_traffic"] = bool(caps.get("can_view_traffic", row[4]))
        bind.execute(
            sa.text("UPDATE s3_sessions SET capabilities = :caps WHERE id = :id"),
            {"id": row[0], "caps": json.dumps(caps)},
        )

    with op.batch_alter_table("s3_connections", schema=None) as batch_op:
        batch_op.drop_column("iam_capable")

    with op.batch_alter_table("user_s3_accounts", schema=None) as batch_op:
        batch_op.drop_column("can_view_root_key")
        batch_op.drop_column("can_manage_portal_users")
        batch_op.drop_column("can_manage_buckets")
        batch_op.drop_column("can_manage_iam")

    with op.batch_alter_table("s3_sessions", schema=None) as batch_op:
        batch_op.drop_column("can_view_traffic")
        batch_op.drop_column("can_manage_buckets")
        batch_op.drop_column("can_manage_iam")


def downgrade() -> None:
    bind = op.get_bind()

    with op.batch_alter_table("s3_sessions", schema=None) as batch_op:
        batch_op.add_column(sa.Column("can_manage_iam", sa.Boolean(), nullable=False, server_default="0"))
        batch_op.add_column(sa.Column("can_manage_buckets", sa.Boolean(), nullable=False, server_default="1"))
        batch_op.add_column(sa.Column("can_view_traffic", sa.Boolean(), nullable=False, server_default="0"))

    rows = bind.execute(sa.text("SELECT id, capabilities FROM s3_sessions")).fetchall()
    for row in rows:
        caps = _parse_json_dict(row[1])
        bind.execute(
            sa.text(
                """
                UPDATE s3_sessions
                SET can_manage_iam = :iam,
                    can_manage_buckets = :buckets,
                    can_view_traffic = :traffic
                WHERE id = :id
                """
            ),
            {
                "id": row[0],
                "iam": bool(caps.get("can_manage_iam", False)),
                "buckets": bool(caps.get("can_manage_buckets", True)),
                "traffic": bool(caps.get("can_view_traffic", False)),
            },
        )

    with op.batch_alter_table("user_s3_accounts", schema=None) as batch_op:
        batch_op.add_column(sa.Column("can_manage_iam", sa.Boolean(), nullable=False, server_default="0"))
        batch_op.add_column(sa.Column("can_manage_buckets", sa.Boolean(), nullable=False, server_default="1"))
        batch_op.add_column(sa.Column("can_manage_portal_users", sa.Boolean(), nullable=False, server_default="0"))
        batch_op.add_column(sa.Column("can_view_root_key", sa.Boolean(), nullable=False, server_default="0"))

    with op.batch_alter_table("s3_connections", schema=None) as batch_op:
        batch_op.add_column(sa.Column("iam_capable", sa.Boolean(), nullable=False, server_default="0"))

    rows = bind.execute(sa.text("SELECT id, capabilities_json FROM s3_connections")).fetchall()
    for row in rows:
        caps = _parse_json_dict(row[1])
        bind.execute(
            sa.text("UPDATE s3_connections SET iam_capable = :iam WHERE id = :id"),
            {"id": row[0], "iam": bool(caps.get("can_manage_iam", False))},
        )
