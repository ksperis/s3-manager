# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Add explicit Manager Browser data-plane permissions.

Revision ID: 0103_manager_browser_data_access
Revises: 0102_reorganize_manager_global_settings
Create Date: 2026-08-10
"""

from alembic import op
import sqlalchemy as sa


revision = "0103_manager_browser_data_access"
down_revision = "0102_reorganize_manager_global_settings"
branch_labels = None
depends_on = None


_TABLES = (
    "user_s3_accounts",
    "ui_group_s3_accounts",
    "user_s3_users",
    "ui_group_s3_users",
)
_COLUMN = "allow_manager_browser_data_access"


def upgrade() -> None:
    for table_name in _TABLES:
        with op.batch_alter_table(table_name) as batch_op:
            batch_op.add_column(
                sa.Column(
                    _COLUMN,
                    sa.Boolean(),
                    nullable=False,
                    server_default=sa.text("0"),
                )
            )


def downgrade() -> None:
    for table_name in reversed(_TABLES):
        with op.batch_alter_table(table_name) as batch_op:
            batch_op.drop_column(_COLUMN)
