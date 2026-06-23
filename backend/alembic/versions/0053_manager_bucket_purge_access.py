# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Add bucket purge manager tool access flags."""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0053_manager_bucket_purge_access"
down_revision = "0052_user_ui_preferences"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "can_access_manager_bucket_purge",
                sa.Boolean(),
                nullable=False,
                server_default="0",
            ),
        )
    with op.batch_alter_table("ui_groups", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "can_access_manager_bucket_purge",
                sa.Boolean(),
                nullable=False,
                server_default="0",
            ),
        )


def downgrade() -> None:
    with op.batch_alter_table("ui_groups", schema=None) as batch_op:
        batch_op.drop_column("can_access_manager_bucket_purge")
    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.drop_column("can_access_manager_bucket_purge")
