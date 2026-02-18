"""add optimized healthcheck tables

Revision ID: 0009_healthcheck_optimized_tables
Revises: 0008_healthcheck_mode_column
Create Date: 2026-02-18 22:30:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0009_healthcheck_optimized_tables"
down_revision = "0008_healthcheck_mode_column"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "endpoint_health_latest",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("storage_endpoint_id", sa.Integer(), nullable=False),
        sa.Column("check_mode", sa.String(), nullable=False, server_default="http"),
        sa.Column("check_type", sa.String(), nullable=False, server_default="availability"),
        sa.Column("scope", sa.String(), nullable=False, server_default="endpoint"),
        sa.Column("checked_at", sa.DateTime(), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("latency_ms", sa.Integer(), nullable=True),
        sa.Column("http_status", sa.Integer(), nullable=True),
        sa.Column("error_message", sa.String(), nullable=True),
        sa.Column("min_latency_ms", sa.Integer(), nullable=True),
        sa.Column("avg_latency_ms", sa.Integer(), nullable=True),
        sa.Column("max_latency_ms", sa.Integer(), nullable=True),
        sa.Column("latency_sample_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("availability_24h", sa.Integer(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["storage_endpoint_id"], ["storage_endpoints.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "storage_endpoint_id",
            "check_mode",
            "check_type",
            "scope",
            name="uq_endpoint_health_latest_scope",
        ),
    )
    with op.batch_alter_table("endpoint_health_latest", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_endpoint_health_latest_id"), ["id"], unique=False)
        batch_op.create_index(batch_op.f("ix_endpoint_health_latest_storage_endpoint_id"), ["storage_endpoint_id"], unique=False)
        batch_op.create_index(batch_op.f("ix_endpoint_health_latest_checked_at"), ["checked_at"], unique=False)
        batch_op.create_index(batch_op.f("ix_endpoint_health_latest_updated_at"), ["updated_at"], unique=False)

    op.create_table(
        "endpoint_health_status_segments",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("storage_endpoint_id", sa.Integer(), nullable=False),
        sa.Column("check_mode", sa.String(), nullable=False, server_default="http"),
        sa.Column("check_type", sa.String(), nullable=False, server_default="availability"),
        sa.Column("scope", sa.String(), nullable=False, server_default="endpoint"),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("started_at", sa.DateTime(), nullable=False),
        sa.Column("ended_at", sa.DateTime(), nullable=True),
        sa.Column("checks_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("min_latency_ms", sa.Integer(), nullable=True),
        sa.Column("avg_latency_ms", sa.Integer(), nullable=True),
        sa.Column("max_latency_ms", sa.Integer(), nullable=True),
        sa.Column("latency_sample_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["storage_endpoint_id"], ["storage_endpoints.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("endpoint_health_status_segments", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_endpoint_health_status_segments_id"), ["id"], unique=False)
        batch_op.create_index(
            batch_op.f("ix_endpoint_health_status_segments_storage_endpoint_id"),
            ["storage_endpoint_id"],
            unique=False,
        )
        batch_op.create_index(batch_op.f("ix_endpoint_health_status_segments_status"), ["status"], unique=False)
        batch_op.create_index(batch_op.f("ix_endpoint_health_status_segments_started_at"), ["started_at"], unique=False)
        batch_op.create_index(batch_op.f("ix_endpoint_health_status_segments_ended_at"), ["ended_at"], unique=False)
        batch_op.create_index(batch_op.f("ix_endpoint_health_status_segments_updated_at"), ["updated_at"], unique=False)

    op.create_table(
        "endpoint_health_rollups",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("storage_endpoint_id", sa.Integer(), nullable=False),
        sa.Column("check_mode", sa.String(), nullable=False, server_default="http"),
        sa.Column("check_type", sa.String(), nullable=False, server_default="availability"),
        sa.Column("scope", sa.String(), nullable=False, server_default="endpoint"),
        sa.Column("resolution_seconds", sa.Integer(), nullable=False, server_default="300"),
        sa.Column("bucket_start", sa.DateTime(), nullable=False),
        sa.Column("up_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("degraded_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("down_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("unknown_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("latency_min_ms", sa.Integer(), nullable=True),
        sa.Column("latency_avg_ms", sa.Integer(), nullable=True),
        sa.Column("latency_max_ms", sa.Integer(), nullable=True),
        sa.Column("latency_p95_ms", sa.Integer(), nullable=True),
        sa.Column("latency_sample_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["storage_endpoint_id"], ["storage_endpoints.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "storage_endpoint_id",
            "check_mode",
            "check_type",
            "scope",
            "resolution_seconds",
            "bucket_start",
            name="uq_endpoint_health_rollup_bucket",
        ),
    )
    with op.batch_alter_table("endpoint_health_rollups", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_endpoint_health_rollups_id"), ["id"], unique=False)
        batch_op.create_index(batch_op.f("ix_endpoint_health_rollups_storage_endpoint_id"), ["storage_endpoint_id"], unique=False)
        batch_op.create_index(batch_op.f("ix_endpoint_health_rollups_bucket_start"), ["bucket_start"], unique=False)
        batch_op.create_index(batch_op.f("ix_endpoint_health_rollups_updated_at"), ["updated_at"], unique=False)


def downgrade() -> None:
    with op.batch_alter_table("endpoint_health_rollups", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_endpoint_health_rollups_updated_at"))
        batch_op.drop_index(batch_op.f("ix_endpoint_health_rollups_bucket_start"))
        batch_op.drop_index(batch_op.f("ix_endpoint_health_rollups_storage_endpoint_id"))
        batch_op.drop_index(batch_op.f("ix_endpoint_health_rollups_id"))
    op.drop_table("endpoint_health_rollups")

    with op.batch_alter_table("endpoint_health_status_segments", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_endpoint_health_status_segments_updated_at"))
        batch_op.drop_index(batch_op.f("ix_endpoint_health_status_segments_ended_at"))
        batch_op.drop_index(batch_op.f("ix_endpoint_health_status_segments_started_at"))
        batch_op.drop_index(batch_op.f("ix_endpoint_health_status_segments_status"))
        batch_op.drop_index(batch_op.f("ix_endpoint_health_status_segments_storage_endpoint_id"))
        batch_op.drop_index(batch_op.f("ix_endpoint_health_status_segments_id"))
    op.drop_table("endpoint_health_status_segments")

    with op.batch_alter_table("endpoint_health_latest", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_endpoint_health_latest_updated_at"))
        batch_op.drop_index(batch_op.f("ix_endpoint_health_latest_checked_at"))
        batch_op.drop_index(batch_op.f("ix_endpoint_health_latest_storage_endpoint_id"))
        batch_op.drop_index(batch_op.f("ix_endpoint_health_latest_id"))
    op.drop_table("endpoint_health_latest")
