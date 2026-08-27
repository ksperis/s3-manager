# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Add explicit one-time first administrator bootstrap state.

Revision ID: 0119_first_admin_bootstrap
Revises: 0118_canonical_storage_endpoint_urls
Create Date: 2026-08-27
"""

from alembic import op
import sqlalchemy as sa

from app.db.utc_datetime import UTCDateTime


revision = "0119_first_admin_bootstrap"
down_revision = "0118_canonical_storage_endpoint_urls"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "first_admin_bootstrap",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("token_digest", sa.String(length=64), nullable=True),
        sa.Column("issued_at", UTCDateTime(), nullable=True),
        sa.Column("expires_at", UTCDateTime(), nullable=True),
        sa.Column("consumed_at", UTCDateTime(), nullable=True),
        sa.Column("created_user_id", sa.Integer(), nullable=True),
        sa.CheckConstraint("id = 1", name="ck_first_admin_bootstrap_singleton"),
        sa.ForeignKeyConstraint(
            ["created_user_id"],
            ["users.id"],
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade() -> None:
    op.drop_table("first_admin_bootstrap")
