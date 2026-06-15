# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Add Portal Storage Space naming mode metadata."""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0050_portal_storage_space_naming_modes"
down_revision = "0049_privileged_target_grants"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("portal_storage_space_metadata", schema=None) as batch_op:
        batch_op.add_column(sa.Column("origin", sa.String(), nullable=False, server_default="legacy"))
        batch_op.add_column(sa.Column("name_editable", sa.Boolean(), nullable=False, server_default="0"))


def downgrade() -> None:
    with op.batch_alter_table("portal_storage_space_metadata", schema=None) as batch_op:
        batch_op.drop_column("name_editable")
        batch_op.drop_column("origin")
