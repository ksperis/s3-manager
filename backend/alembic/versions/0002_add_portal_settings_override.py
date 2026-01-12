"""Add portal settings override to s3_accounts

Revision ID: 0002_add_portal_settings_override
Revises: 0001_initial_schema
Create Date: 2025-02-01 00:10:00
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0002_add_portal_settings_override"
down_revision = "0001_initial_schema"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("s3_accounts", sa.Column("portal_settings_override", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("s3_accounts", "portal_settings_override")
