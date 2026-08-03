# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Remove unused API token and refresh-session metadata.

Revision ID: 0096_remove_unused_session_metadata
Revises: 0095_canonical_s3_account_endpoints
Create Date: 2026-08-03
"""

from alembic import op
import sqlalchemy as sa


revision = "0096_remove_unused_session_metadata"
down_revision = "0095_canonical_s3_account_endpoints"
branch_labels = None
depends_on = None


def _drop_unused_metadata(table_name: str) -> None:
    with op.batch_alter_table(table_name, schema=None) as batch_op:
        batch_op.drop_constraint(
            f"fk_{table_name}_revoked_by_user_id_users",
            type_="foreignkey",
        )
        batch_op.drop_index(batch_op.f(f"ix_{table_name}_revoked_by_user_id"))
        batch_op.drop_column("revoked_by_user_id")
        batch_op.drop_column("last_ip")
        batch_op.drop_column("last_user_agent")
        batch_op.drop_column("revoked_reason")


def _restore_unused_metadata(table_name: str) -> None:
    with op.batch_alter_table(table_name, schema=None) as batch_op:
        batch_op.add_column(sa.Column("revoked_by_user_id", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("last_ip", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("last_user_agent", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("revoked_reason", sa.String(), nullable=True))
        batch_op.create_index(
            batch_op.f(f"ix_{table_name}_revoked_by_user_id"),
            ["revoked_by_user_id"],
            unique=False,
        )
        batch_op.create_foreign_key(
            f"fk_{table_name}_revoked_by_user_id_users",
            "users",
            ["revoked_by_user_id"],
            ["id"],
        )


def upgrade() -> None:
    _drop_unused_metadata("api_tokens")
    _drop_unused_metadata("refresh_sessions")


def downgrade() -> None:
    _restore_unused_metadata("refresh_sessions")
    _restore_unused_metadata("api_tokens")
