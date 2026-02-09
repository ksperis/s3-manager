# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""add ceph-admin access flag on users

Revision ID: 0006_user_ceph_admin_access
Revises: 0005_api_tokens
Create Date: 2026-02-09 12:00:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0006_user_ceph_admin_access"
down_revision = "0005_api_tokens"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("can_access_ceph_admin", sa.Boolean(), nullable=False, server_default="0"),
        )


def downgrade() -> None:
    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.drop_column("can_access_ceph_admin")
