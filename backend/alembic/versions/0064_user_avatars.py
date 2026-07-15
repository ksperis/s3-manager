# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Add managed user avatars.

Revision ID: 0064_user_avatars
Revises: 0063_portal_admin_requests
Create Date: 2026-07-15 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "0064_user_avatars"
down_revision = "0063_portal_admin_requests"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("avatar_preference", sa.String(), server_default="auto", nullable=False),
    )
    op.add_column("users", sa.Column("avatar_image", sa.LargeBinary(), nullable=True))
    op.add_column("users", sa.Column("avatar_content_type", sa.String(), nullable=True))
    op.add_column("users", sa.Column("avatar_updated_at", sa.DateTime(), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "avatar_updated_at")
    op.drop_column("users", "avatar_content_type")
    op.drop_column("users", "avatar_image")
    op.drop_column("users", "avatar_preference")
