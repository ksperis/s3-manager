# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Add manager feature rule inventory access flags."""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0046_manager_feature_rules_access"
down_revision = "0045_browser_advanced_features_access"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "can_access_manager_feature_rules",
                sa.Boolean(),
                nullable=False,
                server_default="0",
            ),
        )
    with op.batch_alter_table("ui_groups", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "can_access_manager_feature_rules",
                sa.Boolean(),
                nullable=False,
                server_default="0",
            ),
        )


def downgrade() -> None:
    with op.batch_alter_table("ui_groups", schema=None) as batch_op:
        batch_op.drop_column("can_access_manager_feature_rules")
    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.drop_column("can_access_manager_feature_rules")
