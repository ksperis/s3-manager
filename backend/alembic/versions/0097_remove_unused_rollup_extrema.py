# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Remove unused health-rollup latency extrema.

Revision ID: 0097_remove_unused_rollup_extrema
Revises: 0096_remove_unused_session_metadata
Create Date: 2026-08-03
"""

from alembic import op
import sqlalchemy as sa


revision = "0097_remove_unused_rollup_extrema"
down_revision = "0096_remove_unused_session_metadata"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("endpoint_health_rollups", schema=None) as batch_op:
        batch_op.drop_column("latency_min_ms")
        batch_op.drop_column("latency_max_ms")


def downgrade() -> None:
    with op.batch_alter_table("endpoint_health_rollups", schema=None) as batch_op:
        batch_op.add_column(sa.Column("latency_min_ms", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("latency_max_ms", sa.Integer(), nullable=True))
