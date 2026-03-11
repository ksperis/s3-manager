# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""add storage-ops access flag on users

Revision ID: 0029_user_storage_ops_access
Revises: 0028_quota_monitoring_notifications
Create Date: 2026-03-11 00:00:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0029_user_storage_ops_access"
down_revision = "0028_quota_monitoring_notifications"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("can_access_storage_ops", sa.Boolean(), nullable=False, server_default="0"),
        )


def downgrade() -> None:
    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.drop_column("can_access_storage_ops")
