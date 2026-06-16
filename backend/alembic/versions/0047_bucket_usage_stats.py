# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Add bucket usage statistics snapshots."""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0047_bucket_usage_stats"
down_revision = "0046_manager_feature_rules_access"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "bucket_usage_stats_snapshots",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("scope_kind", sa.String(), nullable=False),
        sa.Column("scope_id", sa.String(), nullable=False),
        sa.Column("scope_name", sa.String(), nullable=True),
        sa.Column("bucket_name", sa.String(), nullable=False),
        sa.Column("scan_mode", sa.String(), nullable=False, server_default="versions"),
        sa.Column("version_listing_available", sa.Boolean(), nullable=False, server_default="1"),
        sa.Column("object_version_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("current_version_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("noncurrent_version_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("delete_marker_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("total_bytes", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("current_bytes", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("noncurrent_bytes", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("data_type_distribution_json", sa.Text(), nullable=False),
        sa.Column("storage_class_distribution_json", sa.Text(), nullable=False),
        sa.Column("size_distribution_json", sa.Text(), nullable=False),
        sa.Column("age_distribution_json", sa.Text(), nullable=False),
        sa.Column("current_noncurrent_distribution_json", sa.Text(), nullable=False),
        sa.Column("warnings_json", sa.Text(), nullable=True),
        sa.Column("calculated_at", sa.DateTime(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("scope_kind", "scope_id", "bucket_name", name="uq_bucket_usage_stats_scope_bucket"),
    )
    op.create_index("ix_bucket_usage_stats_snapshots_id", "bucket_usage_stats_snapshots", ["id"], unique=False)
    op.create_index("ix_bucket_usage_stats_scope", "bucket_usage_stats_snapshots", ["scope_kind", "scope_id"], unique=False)
    op.create_index("ix_bucket_usage_stats_calculated_at", "bucket_usage_stats_snapshots", ["calculated_at"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_bucket_usage_stats_calculated_at", table_name="bucket_usage_stats_snapshots")
    op.drop_index("ix_bucket_usage_stats_scope", table_name="bucket_usage_stats_snapshots")
    op.drop_index("ix_bucket_usage_stats_snapshots_id", table_name="bucket_usage_stats_snapshots")
    op.drop_table("bucket_usage_stats_snapshots")
