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


def _table_columns(bind, table_name: str) -> set[str]:
    inspector = sa.inspect(bind)
    if table_name not in inspector.get_table_names():
        return set()
    return {col["name"] for col in inspector.get_columns(table_name)}


def _create_s3_sessions_table() -> None:
    op.create_table(
        "s3_sessions",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("access_key_enc", sa.String(), nullable=False),
        sa.Column("secret_key_enc", sa.String(), nullable=False),
        sa.Column("access_key_hash", sa.String(), nullable=False),
        sa.Column("actor_type", sa.String(), nullable=False),
        sa.Column("role", sa.String(), nullable=False),
        sa.Column("account_id", sa.String(), nullable=True),
        sa.Column("account_name", sa.String(), nullable=True),
        sa.Column("user_uid", sa.String(), nullable=True),
        sa.Column("capabilities", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("last_used_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("s3_sessions", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_s3_sessions_access_key_hash"), ["access_key_hash"], unique=False)
        batch_op.create_index(batch_op.f("ix_s3_sessions_id"), ["id"], unique=False)


def upgrade() -> None:
    bind = op.get_bind()
    s3_connections_columns = _table_columns(bind, "s3_connections")

    # Migrate S3 connection capability probe to canonical JSON key.
    if {"id", "capabilities_json", "iam_capable"}.issubset(s3_connections_columns):
        rows = bind.execute(
            sa.text("SELECT id, capabilities_json, iam_capable FROM s3_connections")
        ).fetchall()
        for row in rows:
            row_map = row._mapping
            caps = _parse_json_dict(row_map["capabilities_json"])
            legacy = caps.get("iam_capable")
            if isinstance(caps.get("can_manage_iam"), bool):
                can_manage_iam = bool(caps["can_manage_iam"])
            elif isinstance(legacy, bool):
                can_manage_iam = bool(legacy)
            else:
                can_manage_iam = bool(row_map["iam_capable"])
            caps["can_manage_iam"] = can_manage_iam
            caps.pop("iam_capable", None)
            bind.execute(
                sa.text("UPDATE s3_connections SET capabilities_json = :caps WHERE id = :id"),
                {"id": row_map["id"], "caps": json.dumps(caps)},
            )

    # Migrate S3 session capability snapshots to JSON-only.
    s3_sessions_columns = _table_columns(bind, "s3_sessions")
    if not s3_sessions_columns:
        _create_s3_sessions_table()
        s3_sessions_columns = _table_columns(bind, "s3_sessions")
    elif {"id", "capabilities"}.issubset(s3_sessions_columns):
        select_columns = ["id", "capabilities"]
        legacy_flags = ("can_manage_iam", "can_manage_buckets", "can_view_traffic")
        for col in legacy_flags:
            if col in s3_sessions_columns:
                select_columns.append(col)
        rows = bind.execute(sa.text(f"SELECT {', '.join(select_columns)} FROM s3_sessions")).fetchall()
        for row in rows:
            row_map = row._mapping
            caps = _parse_json_dict(row_map["capabilities"])
            caps["can_manage_iam"] = bool(caps.get("can_manage_iam", row_map.get("can_manage_iam", False)))
            caps["can_manage_buckets"] = bool(caps.get("can_manage_buckets", row_map.get("can_manage_buckets", True)))
            caps["can_view_traffic"] = bool(caps.get("can_view_traffic", row_map.get("can_view_traffic", False)))
            bind.execute(
                sa.text("UPDATE s3_sessions SET capabilities = :caps WHERE id = :id"),
                {"id": row_map["id"], "caps": json.dumps(caps)},
            )

    if "iam_capable" in s3_connections_columns:
        with op.batch_alter_table("s3_connections", schema=None) as batch_op:
            batch_op.drop_column("iam_capable")

    user_s3_accounts_columns = _table_columns(bind, "user_s3_accounts")
    account_columns_to_drop = [
        col
        for col in ("can_view_root_key", "can_manage_portal_users", "can_manage_buckets", "can_manage_iam")
        if col in user_s3_accounts_columns
    ]
    if account_columns_to_drop:
        with op.batch_alter_table("user_s3_accounts", schema=None) as batch_op:
            for col in account_columns_to_drop:
                batch_op.drop_column(col)

    session_columns_to_drop = [
        col for col in ("can_view_traffic", "can_manage_buckets", "can_manage_iam") if col in s3_sessions_columns
    ]
    if session_columns_to_drop:
        with op.batch_alter_table("s3_sessions", schema=None) as batch_op:
            for col in session_columns_to_drop:
                batch_op.drop_column(col)


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
