# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Add managed UI group avatars.

Revision ID: 0065_ui_group_avatars
Revises: 0064_user_avatars
Create Date: 2026-07-15 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "0065_ui_group_avatars"
down_revision = "0064_user_avatars"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "ui_groups",
        sa.Column("avatar_source", sa.String(), server_default="initials", nullable=False),
    )
    op.add_column("ui_groups", sa.Column("avatar_icon", sa.String(), nullable=True))
    op.add_column("ui_groups", sa.Column("avatar_image", sa.LargeBinary(), nullable=True))
    op.add_column("ui_groups", sa.Column("avatar_content_type", sa.String(), nullable=True))
    op.add_column("ui_groups", sa.Column("avatar_updated_at", sa.DateTime(), nullable=True))


def downgrade() -> None:
    op.drop_column("ui_groups", "avatar_updated_at")
    op.drop_column("ui_groups", "avatar_content_type")
    op.drop_column("ui_groups", "avatar_image")
    op.drop_column("ui_groups", "avatar_icon")
    op.drop_column("ui_groups", "avatar_source")
