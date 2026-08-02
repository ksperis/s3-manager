# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Delegate project Portal settings to Portal managers.

Revision ID: 0072_portal_settings_delegation
Revises: 0071_portal_storage_space_icons
Create Date: 2026-08-02 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "0072_portal_settings_delegation"
down_revision = "0071_portal_storage_space_icons"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("s3_accounts", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "portal_settings_delegated",
                sa.Boolean(),
                nullable=False,
                server_default="0",
            )
        )


def downgrade() -> None:
    with op.batch_alter_table("s3_accounts", schema=None) as batch_op:
        batch_op.drop_column("portal_settings_delegated")
