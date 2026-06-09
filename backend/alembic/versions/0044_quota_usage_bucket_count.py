# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Add bucket count to quota usage history."""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0044_quota_usage_bucket_count"
down_revision = "0043_ui_groups"
branch_labels = None
depends_on = None


def _has_column(table_name: str, column_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return any(column["name"] == column_name for column in inspector.get_columns(table_name))


def upgrade() -> None:
    if not _has_column("quota_usage_hourly", "bucket_count"):
        with op.batch_alter_table("quota_usage_hourly", schema=None) as batch_op:
            batch_op.add_column(sa.Column("bucket_count", sa.Integer(), nullable=True))
    if not _has_column("quota_usage_daily", "bucket_count"):
        with op.batch_alter_table("quota_usage_daily", schema=None) as batch_op:
            batch_op.add_column(sa.Column("bucket_count", sa.Integer(), nullable=True))


def downgrade() -> None:
    if _has_column("quota_usage_daily", "bucket_count"):
        with op.batch_alter_table("quota_usage_daily", schema=None) as batch_op:
            batch_op.drop_column("bucket_count")
    if _has_column("quota_usage_hourly", "bucket_count"):
        with op.batch_alter_table("quota_usage_hourly", schema=None) as batch_op:
            batch_op.drop_column("bucket_count")
