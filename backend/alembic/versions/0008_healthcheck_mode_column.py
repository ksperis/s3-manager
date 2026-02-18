# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""add check_mode to endpoint healthchecks

Revision ID: 0008_healthcheck_mode_column
Revises: 0007_storage_endpoint_ceph_admin_credentials
Create Date: 2026-02-18 17:00:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0008_healthcheck_mode_column"
down_revision = "0007_storage_endpoint_ceph_admin_credentials"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("endpoint_health_checks", schema=None) as batch_op:
        batch_op.add_column(sa.Column("check_mode", sa.String(), nullable=False, server_default="http"))


def downgrade() -> None:
    with op.batch_alter_table("endpoint_health_checks", schema=None) as batch_op:
        batch_op.drop_column("check_mode")
