# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Add UI groups and inherited access bindings."""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0043_ui_groups"
down_revision = "0042_add_latitude_longitude_to_storage_endpoints"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "ui_groups",
        sa.Column("id", sa.Integer(), primary_key=True, index=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("can_access_ceph_admin", sa.Boolean(), nullable=False, server_default="0"),
        sa.Column("can_access_storage_ops", sa.Boolean(), nullable=False, server_default="0"),
        sa.Column("can_access_manager_bucket_compare", sa.Boolean(), nullable=False, server_default="0"),
        sa.Column("can_access_manager_bucket_integrity_check", sa.Boolean(), nullable=False, server_default="0"),
        sa.Column("can_access_manager_bucket_migration", sa.Boolean(), nullable=False, server_default="0"),
        sa.Column("can_access_manager_ceph_s3_user_keys", sa.Boolean(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("name", name="uq_ui_groups_name"),
    )
    op.create_index("ix_ui_groups_name", "ui_groups", ["name"], unique=False)

    op.create_table(
        "user_ui_groups",
        sa.Column("id", sa.Integer(), primary_key=True, index=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("group_id", sa.Integer(), sa.ForeignKey("ui_groups.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("user_id", "group_id", name="uq_user_ui_group"),
        sa.Index("ix_user_ui_groups_group_user", "group_id", "user_id"),
    )

    op.create_table(
        "ui_group_s3_accounts",
        sa.Column("id", sa.Integer(), primary_key=True, index=True),
        sa.Column("group_id", sa.Integer(), sa.ForeignKey("ui_groups.id"), nullable=False),
        sa.Column("account_id", sa.Integer(), sa.ForeignKey("s3_accounts.id"), nullable=False),
        sa.Column("account_admin", sa.Boolean(), nullable=False, server_default="0"),
        sa.Column(
            "account_role",
            sa.String(),
            nullable=False,
            server_default="portal_none",
        ),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("group_id", "account_id", name="uq_ui_group_s3_account"),
        sa.Index("ix_ui_group_s3_accounts_account_group", "account_id", "group_id"),
    )

    op.create_table(
        "ui_group_s3_users",
        sa.Column("id", sa.Integer(), primary_key=True, index=True),
        sa.Column("group_id", sa.Integer(), sa.ForeignKey("ui_groups.id"), nullable=False),
        sa.Column("s3_user_id", sa.Integer(), sa.ForeignKey("s3_users.id"), nullable=False),
        sa.UniqueConstraint("group_id", "s3_user_id", name="uq_ui_group_s3_user"),
        sa.Index("ix_ui_group_s3_users_s3_user_group", "s3_user_id", "group_id"),
    )

    op.create_table(
        "ui_group_s3_connections",
        sa.Column("id", sa.Integer(), primary_key=True, index=True),
        sa.Column("group_id", sa.Integer(), sa.ForeignKey("ui_groups.id"), nullable=False),
        sa.Column("s3_connection_id", sa.Integer(), sa.ForeignKey("s3_connections.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("group_id", "s3_connection_id", name="uq_ui_group_s3_connection"),
        sa.Index("ix_ui_group_s3_connections_connection_group", "s3_connection_id", "group_id"),
    )


def downgrade() -> None:
    op.drop_table("ui_group_s3_connections")
    op.drop_table("ui_group_s3_users")
    op.drop_table("ui_group_s3_accounts")
    op.drop_table("user_ui_groups")
    op.drop_index("ix_ui_groups_name", table_name="ui_groups")
    op.drop_table("ui_groups")
