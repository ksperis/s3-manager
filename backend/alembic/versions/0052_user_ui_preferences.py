# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Add persisted UI preferences to users."""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0052_user_ui_preferences"
down_revision = "0051_portal_storage_space_visibility"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("ui_preferences_json", sa.Text(), nullable=False, server_default=sa.text("'{}'"))
        )


def downgrade() -> None:
    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.drop_column("ui_preferences_json")
