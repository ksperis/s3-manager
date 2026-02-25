# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Repair refresh_sessions schema drift for legacy deployments."""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0018_refresh_sessions_schema_repair"
down_revision = "0017_s3_connection_capabilities_json_not_null"
branch_labels = None
depends_on = None


def _table_columns(bind, table_name: str) -> set[str]:
    inspector = sa.inspect(bind)
    if table_name not in inspector.get_table_names():
        return set()
    return {col["name"] for col in inspector.get_columns(table_name)}


def _table_indexes(bind, table_name: str) -> set[str]:
    inspector = sa.inspect(bind)
    if table_name not in inspector.get_table_names():
        return set()
    return {idx["name"] for idx in inspector.get_indexes(table_name)}


def upgrade() -> None:
    bind = op.get_bind()
    columns = _table_columns(bind, "refresh_sessions")
    if not columns:
        return

    with op.batch_alter_table("refresh_sessions", schema=None) as batch_op:
        if "s3_session_id" not in columns:
            batch_op.add_column(sa.Column("s3_session_id", sa.String(), nullable=True))
        if "auth_type" not in columns:
            batch_op.add_column(sa.Column("auth_type", sa.String(), nullable=True))
        if "revoked_by_user_id" not in columns:
            batch_op.add_column(sa.Column("revoked_by_user_id", sa.Integer(), nullable=True))
        if "last_ip" not in columns:
            batch_op.add_column(sa.Column("last_ip", sa.String(), nullable=True))
        if "last_user_agent" not in columns:
            batch_op.add_column(sa.Column("last_user_agent", sa.String(), nullable=True))
        if "revoked_reason" not in columns:
            batch_op.add_column(sa.Column("revoked_reason", sa.String(), nullable=True))

    columns = _table_columns(bind, "refresh_sessions")
    indexes = _table_indexes(bind, "refresh_sessions")
    with op.batch_alter_table("refresh_sessions", schema=None) as batch_op:
        if "s3_session_id" in columns and "ix_refresh_sessions_s3_session_id" not in indexes:
            batch_op.create_index("ix_refresh_sessions_s3_session_id", ["s3_session_id"], unique=False)
        if "revoked_by_user_id" in columns and "ix_refresh_sessions_revoked_by_user_id" not in indexes:
            batch_op.create_index("ix_refresh_sessions_revoked_by_user_id", ["revoked_by_user_id"], unique=False)


def downgrade() -> None:
    # Keep downgrade intentionally no-op: this revision is a forward-only repair
    # for drifted legacy schemas.
    pass
