"""drop legacy endpoint health daily table

Revision ID: 0011_drop_legacy_endpoint_health_daily
Revises: 0010_backfill_healthcheck_optimized_data
Create Date: 2026-02-19 00:40:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0011_drop_legacy_endpoint_health_daily"
down_revision = "0010_backfill_healthcheck_optimized_data"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_table("endpoint_health_daily")


def downgrade() -> None:
    op.create_table(
        "endpoint_health_daily",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("storage_endpoint_id", sa.Integer(), nullable=False),
        sa.Column("check_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("ok_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("degraded_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("down_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("avg_latency_ms", sa.Integer(), nullable=True),
        sa.Column("p95_latency_ms", sa.Integer(), nullable=True),
        sa.Column("last_status", sa.String(), nullable=True),
        sa.Column("last_checked_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["storage_endpoint_id"], ["storage_endpoints.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("day", "storage_endpoint_id", name="uq_endpoint_health_daily"),
    )
    with op.batch_alter_table("endpoint_health_daily", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_endpoint_health_daily_day"), ["day"], unique=False)
        batch_op.create_index(batch_op.f("ix_endpoint_health_daily_id"), ["id"], unique=False)
        batch_op.create_index(
            batch_op.f("ix_endpoint_health_daily_storage_endpoint_id"),
            ["storage_endpoint_id"],
            unique=False,
        )
