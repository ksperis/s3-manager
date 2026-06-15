# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Add target grants for privileged manager Ceph operations."""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0049_privileged_target_grants"
down_revision = "0048_manager_bucket_quota_access"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("s3_accounts", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "allow_manager_bucket_quota",
                sa.Boolean(),
                nullable=False,
                server_default="0",
            ),
        )
    with op.batch_alter_table("s3_users", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "allow_manager_bucket_quota",
                sa.Boolean(),
                nullable=False,
                server_default="0",
            ),
        )
        batch_op.add_column(
            sa.Column(
                "allow_manager_ceph_s3_user_keys",
                sa.Boolean(),
                nullable=False,
                server_default="0",
            ),
        )


def downgrade() -> None:
    with op.batch_alter_table("s3_users", schema=None) as batch_op:
        batch_op.drop_column("allow_manager_ceph_s3_user_keys")
        batch_op.drop_column("allow_manager_bucket_quota")
    with op.batch_alter_table("s3_accounts", schema=None) as batch_op:
        batch_op.drop_column("allow_manager_bucket_quota")
