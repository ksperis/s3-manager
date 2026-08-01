# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Add durable server-managed private access provisioning state.

Revision ID: 0070_managed_private_access
Revises: 0069_canonical_account_access_roles
Create Date: 2026-08-01 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "0070_managed_private_access"
down_revision = "0069_canonical_account_access_roles"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("s3_connections", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "server_managed",
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            )
        )

    op.create_table(
        "managed_private_accesses",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("owner_user_id", sa.Integer(), nullable=False),
        sa.Column("source_context_type", sa.String(), nullable=False),
        sa.Column("source_context_id", sa.Integer(), nullable=False),
        sa.Column("remote_principal_type", sa.String(), nullable=False),
        sa.Column("remote_principal_identifier", sa.String(), nullable=False),
        sa.Column("iam_username", sa.String(), nullable=True),
        sa.Column("access_key_id", sa.String(), nullable=True),
        sa.Column("s3_connection_id", sa.Integer(), nullable=True),
        sa.Column("state", sa.String(), nullable=False, server_default="provisioning"),
        sa.Column("cleanup_error", sa.Text(), nullable=True),
        sa.Column("iam_groups_json", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("iam_managed_policies_json", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("iam_inline_policy_names_json", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("created_remote_principal", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_access_key", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint(
            "source_context_type IN ('account', 'connection', 's3_user')",
            name="ck_managed_private_access_source_type",
        ),
        sa.CheckConstraint(
            "remote_principal_type IN ('iam_user', 'rgw_user')",
            name="ck_managed_private_access_principal_type",
        ),
        sa.CheckConstraint(
            "state IN ('provisioning', 'active', 'deleting', 'cleanup_pending', 'failed')",
            name="ck_managed_private_access_state",
        ),
        sa.ForeignKeyConstraint(["owner_user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(
            ["s3_connection_id"],
            ["s3_connections.id"],
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("s3_connection_id", name="uq_managed_private_access_connection"),
    )
    op.create_index(
        "ix_managed_private_accesses_id",
        "managed_private_accesses",
        ["id"],
        unique=False,
    )
    op.create_index(
        "ix_managed_private_accesses_owner_user_id",
        "managed_private_accesses",
        ["owner_user_id"],
        unique=False,
    )
    op.create_index(
        "ix_managed_private_accesses_s3_connection_id",
        "managed_private_accesses",
        ["s3_connection_id"],
        unique=False,
    )
    op.create_index(
        "uq_managed_private_access_active_source",
        "managed_private_accesses",
        ["owner_user_id", "source_context_type", "source_context_id"],
        unique=True,
        sqlite_where=sa.text("state IN ('provisioning', 'active', 'deleting', 'cleanup_pending')"),
        postgresql_where=sa.text("state IN ('provisioning', 'active', 'deleting', 'cleanup_pending')"),
    )


def downgrade() -> None:
    op.drop_index("uq_managed_private_access_active_source", table_name="managed_private_accesses")
    op.drop_index("ix_managed_private_accesses_s3_connection_id", table_name="managed_private_accesses")
    op.drop_index("ix_managed_private_accesses_owner_user_id", table_name="managed_private_accesses")
    op.drop_index("ix_managed_private_accesses_id", table_name="managed_private_accesses")
    op.drop_table("managed_private_accesses")
    with op.batch_alter_table("s3_connections", schema=None) as batch_op:
        batch_op.drop_column("server_managed")
