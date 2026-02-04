"""endpoint healthchecks

Revision ID: 0003_endpoint_healthchecks
Revises: 0002_billing_tables
Create Date: 2026-02-04 10:00:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0003_endpoint_healthchecks"
down_revision = "0002_billing_tables"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "endpoint_health_checks",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("storage_endpoint_id", sa.Integer(), nullable=False),
        sa.Column("checked_at", sa.DateTime(), nullable=False),
        sa.Column("http_status", sa.Integer(), nullable=True),
        sa.Column("latency_ms", sa.Integer(), nullable=True),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("error_message", sa.String(), nullable=True),
        sa.ForeignKeyConstraint(["storage_endpoint_id"], ["storage_endpoints.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("endpoint_health_checks", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_endpoint_health_checks_checked_at"), ["checked_at"], unique=False)
        batch_op.create_index(batch_op.f("ix_endpoint_health_checks_id"), ["id"], unique=False)
        batch_op.create_index(
            batch_op.f("ix_endpoint_health_checks_storage_endpoint_id"),
            ["storage_endpoint_id"],
            unique=False,
        )

    op.create_table(
        "endpoint_health_daily",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("storage_endpoint_id", sa.Integer(), nullable=False),
        sa.Column("check_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column("ok_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column("degraded_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column("down_count", sa.Integer(), server_default="0", nullable=False),
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


def downgrade() -> None:
    with op.batch_alter_table("endpoint_health_daily", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_endpoint_health_daily_storage_endpoint_id"))
        batch_op.drop_index(batch_op.f("ix_endpoint_health_daily_id"))
        batch_op.drop_index(batch_op.f("ix_endpoint_health_daily_day"))

    op.drop_table("endpoint_health_daily")

    with op.batch_alter_table("endpoint_health_checks", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_endpoint_health_checks_storage_endpoint_id"))
        batch_op.drop_index(batch_op.f("ix_endpoint_health_checks_id"))
        batch_op.drop_index(batch_op.f("ix_endpoint_health_checks_checked_at"))

    op.drop_table("endpoint_health_checks")
