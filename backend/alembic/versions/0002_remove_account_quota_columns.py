"""Remove account quota columns

Revision ID: 0002_remove_account_quota_columns
Revises: 0001_initial_schema
Create Date: 2025-01-01 00:00:01
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0002_remove_account_quota_columns"
down_revision = "0001_initial_schema"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("s3_accounts") as batch_op:
        batch_op.drop_column("quota_max_size_gb")
        batch_op.drop_column("quota_max_objects")


def downgrade() -> None:
    with op.batch_alter_table("s3_accounts") as batch_op:
        batch_op.add_column(sa.Column("quota_max_size_gb", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("quota_max_objects", sa.Integer(), nullable=True))
