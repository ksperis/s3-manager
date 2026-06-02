# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Add per-user Manager tool access flags."""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0039_user_manager_tool_access"
down_revision = "0038_storage_endpoint_force_path_style"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "can_access_manager_bucket_compare",
                sa.Boolean(),
                nullable=False,
                server_default="0",
            ),
        )
        batch_op.add_column(
            sa.Column(
                "can_access_manager_bucket_integrity_check",
                sa.Boolean(),
                nullable=False,
                server_default="0",
            ),
        )
        batch_op.add_column(
            sa.Column(
                "can_access_manager_bucket_migration",
                sa.Boolean(),
                nullable=False,
                server_default="0",
            ),
        )
        batch_op.add_column(
            sa.Column(
                "can_access_manager_ceph_s3_user_keys",
                sa.Boolean(),
                nullable=False,
                server_default="0",
            ),
        )


def downgrade() -> None:
    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.drop_column("can_access_manager_ceph_s3_user_keys")
        batch_op.drop_column("can_access_manager_bucket_migration")
        batch_op.drop_column("can_access_manager_bucket_integrity_check")
        batch_op.drop_column("can_access_manager_bucket_compare")
