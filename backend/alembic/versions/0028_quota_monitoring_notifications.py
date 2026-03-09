# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Add quota monitoring tables and user notification preferences."""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0028_quota_monitoring_notifications"
down_revision = "0027_bucket_migration_strong_integrity_check"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("quota_alerts_enabled", sa.Boolean(), nullable=False, server_default=sa.text("1"))
        )
        batch_op.add_column(
            sa.Column("quota_alerts_global_watch", sa.Boolean(), nullable=False, server_default=sa.text("0"))
        )

    op.create_table(
        "quota_usage_hourly",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("hour_ts", sa.DateTime(), nullable=False),
        sa.Column("storage_endpoint_id", sa.Integer(), nullable=False),
        sa.Column("s3_account_id", sa.Integer(), nullable=True),
        sa.Column("s3_user_id", sa.Integer(), nullable=True),
        sa.Column("used_bytes", sa.BigInteger(), nullable=False, server_default=sa.text("0")),
        sa.Column("used_objects", sa.BigInteger(), nullable=False, server_default=sa.text("0")),
        sa.Column("quota_size_bytes", sa.BigInteger(), nullable=True),
        sa.Column("quota_objects", sa.BigInteger(), nullable=True),
        sa.Column("usage_ratio_pct", sa.Numeric(precision=8, scale=3), nullable=True),
        sa.Column("collected_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["s3_account_id"], ["s3_accounts.id"]),
        sa.ForeignKeyConstraint(["s3_user_id"], ["s3_users.id"]),
        sa.ForeignKeyConstraint(["storage_endpoint_id"], ["storage_endpoints.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint(
            "(s3_account_id IS NOT NULL AND s3_user_id IS NULL) "
            "OR (s3_account_id IS NULL AND s3_user_id IS NOT NULL)",
            name="ck_quota_usage_hourly_subject_kind",
        ),
    )
    op.create_index(
        "uq_quota_usage_hourly_account",
        "quota_usage_hourly",
        ["hour_ts", "storage_endpoint_id", "s3_account_id"],
        unique=True,
        sqlite_where=sa.text("s3_account_id IS NOT NULL AND s3_user_id IS NULL"),
        postgresql_where=sa.text("s3_account_id IS NOT NULL AND s3_user_id IS NULL"),
    )
    op.create_index(
        "uq_quota_usage_hourly_user",
        "quota_usage_hourly",
        ["hour_ts", "storage_endpoint_id", "s3_user_id"],
        unique=True,
        sqlite_where=sa.text("s3_user_id IS NOT NULL AND s3_account_id IS NULL"),
        postgresql_where=sa.text("s3_user_id IS NOT NULL AND s3_account_id IS NULL"),
    )
    op.create_index(
        "ix_quota_usage_hourly_endpoint_hour_account",
        "quota_usage_hourly",
        ["storage_endpoint_id", "hour_ts", "s3_account_id"],
        unique=False,
    )
    op.create_index(
        "ix_quota_usage_hourly_endpoint_hour_user",
        "quota_usage_hourly",
        ["storage_endpoint_id", "hour_ts", "s3_user_id"],
        unique=False,
    )
    op.create_index(op.f("ix_quota_usage_hourly_hour_ts"), "quota_usage_hourly", ["hour_ts"], unique=False)
    op.create_index(op.f("ix_quota_usage_hourly_id"), "quota_usage_hourly", ["id"], unique=False)
    op.create_index(
        op.f("ix_quota_usage_hourly_s3_account_id"),
        "quota_usage_hourly",
        ["s3_account_id"],
        unique=False,
    )
    op.create_index(op.f("ix_quota_usage_hourly_s3_user_id"), "quota_usage_hourly", ["s3_user_id"], unique=False)
    op.create_index(
        op.f("ix_quota_usage_hourly_storage_endpoint_id"),
        "quota_usage_hourly",
        ["storage_endpoint_id"],
        unique=False,
    )

    op.create_table(
        "quota_usage_daily",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("storage_endpoint_id", sa.Integer(), nullable=False),
        sa.Column("s3_account_id", sa.Integer(), nullable=True),
        sa.Column("s3_user_id", sa.Integer(), nullable=True),
        sa.Column("last_used_bytes", sa.BigInteger(), nullable=False, server_default=sa.text("0")),
        sa.Column("last_used_objects", sa.BigInteger(), nullable=False, server_default=sa.text("0")),
        sa.Column("max_ratio_pct", sa.Numeric(precision=8, scale=3), nullable=True),
        sa.Column("samples_count", sa.Integer(), nullable=False, server_default=sa.text("1")),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["s3_account_id"], ["s3_accounts.id"]),
        sa.ForeignKeyConstraint(["s3_user_id"], ["s3_users.id"]),
        sa.ForeignKeyConstraint(["storage_endpoint_id"], ["storage_endpoints.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint(
            "(s3_account_id IS NOT NULL AND s3_user_id IS NULL) "
            "OR (s3_account_id IS NULL AND s3_user_id IS NOT NULL)",
            name="ck_quota_usage_daily_subject_kind",
        ),
    )
    op.create_index(
        "uq_quota_usage_daily_account",
        "quota_usage_daily",
        ["day", "storage_endpoint_id", "s3_account_id"],
        unique=True,
        sqlite_where=sa.text("s3_account_id IS NOT NULL AND s3_user_id IS NULL"),
        postgresql_where=sa.text("s3_account_id IS NOT NULL AND s3_user_id IS NULL"),
    )
    op.create_index(
        "uq_quota_usage_daily_user",
        "quota_usage_daily",
        ["day", "storage_endpoint_id", "s3_user_id"],
        unique=True,
        sqlite_where=sa.text("s3_user_id IS NOT NULL AND s3_account_id IS NULL"),
        postgresql_where=sa.text("s3_user_id IS NOT NULL AND s3_account_id IS NULL"),
    )
    op.create_index(
        "ix_quota_usage_daily_endpoint_day_account",
        "quota_usage_daily",
        ["storage_endpoint_id", "day", "s3_account_id"],
        unique=False,
    )
    op.create_index(
        "ix_quota_usage_daily_endpoint_day_user",
        "quota_usage_daily",
        ["storage_endpoint_id", "day", "s3_user_id"],
        unique=False,
    )
    op.create_index(op.f("ix_quota_usage_daily_day"), "quota_usage_daily", ["day"], unique=False)
    op.create_index(op.f("ix_quota_usage_daily_id"), "quota_usage_daily", ["id"], unique=False)
    op.create_index(op.f("ix_quota_usage_daily_s3_account_id"), "quota_usage_daily", ["s3_account_id"], unique=False)
    op.create_index(op.f("ix_quota_usage_daily_s3_user_id"), "quota_usage_daily", ["s3_user_id"], unique=False)
    op.create_index(
        op.f("ix_quota_usage_daily_storage_endpoint_id"),
        "quota_usage_daily",
        ["storage_endpoint_id"],
        unique=False,
    )

    op.create_table(
        "quota_alert_states",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("storage_endpoint_id", sa.Integer(), nullable=False),
        sa.Column("s3_account_id", sa.Integer(), nullable=True),
        sa.Column("s3_user_id", sa.Integer(), nullable=True),
        sa.Column("last_level", sa.String(), nullable=False, server_default="normal"),
        sa.Column("last_ratio_pct", sa.Numeric(precision=8, scale=3), nullable=True),
        sa.Column("last_checked_at", sa.DateTime(), nullable=False),
        sa.Column("last_notified_level", sa.String(), nullable=True),
        sa.Column("last_notified_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["s3_account_id"], ["s3_accounts.id"]),
        sa.ForeignKeyConstraint(["s3_user_id"], ["s3_users.id"]),
        sa.ForeignKeyConstraint(["storage_endpoint_id"], ["storage_endpoints.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint(
            "(s3_account_id IS NOT NULL AND s3_user_id IS NULL) "
            "OR (s3_account_id IS NULL AND s3_user_id IS NOT NULL)",
            name="ck_quota_alert_states_subject_kind",
        ),
    )
    op.create_index(
        "uq_quota_alert_states_account",
        "quota_alert_states",
        ["storage_endpoint_id", "s3_account_id"],
        unique=True,
        sqlite_where=sa.text("s3_account_id IS NOT NULL AND s3_user_id IS NULL"),
        postgresql_where=sa.text("s3_account_id IS NOT NULL AND s3_user_id IS NULL"),
    )
    op.create_index(
        "uq_quota_alert_states_user",
        "quota_alert_states",
        ["storage_endpoint_id", "s3_user_id"],
        unique=True,
        sqlite_where=sa.text("s3_user_id IS NOT NULL AND s3_account_id IS NULL"),
        postgresql_where=sa.text("s3_user_id IS NOT NULL AND s3_account_id IS NULL"),
    )
    op.create_index(
        "ix_quota_alert_states_endpoint_account",
        "quota_alert_states",
        ["storage_endpoint_id", "s3_account_id"],
        unique=False,
    )
    op.create_index(
        "ix_quota_alert_states_endpoint_user",
        "quota_alert_states",
        ["storage_endpoint_id", "s3_user_id"],
        unique=False,
    )
    op.create_index(op.f("ix_quota_alert_states_id"), "quota_alert_states", ["id"], unique=False)
    op.create_index(
        op.f("ix_quota_alert_states_s3_account_id"),
        "quota_alert_states",
        ["s3_account_id"],
        unique=False,
    )
    op.create_index(op.f("ix_quota_alert_states_s3_user_id"), "quota_alert_states", ["s3_user_id"], unique=False)
    op.create_index(
        op.f("ix_quota_alert_states_storage_endpoint_id"),
        "quota_alert_states",
        ["storage_endpoint_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("uq_quota_alert_states_user", table_name="quota_alert_states")
    op.drop_index("uq_quota_alert_states_account", table_name="quota_alert_states")
    op.drop_index(op.f("ix_quota_alert_states_storage_endpoint_id"), table_name="quota_alert_states")
    op.drop_index(op.f("ix_quota_alert_states_s3_user_id"), table_name="quota_alert_states")
    op.drop_index(op.f("ix_quota_alert_states_s3_account_id"), table_name="quota_alert_states")
    op.drop_index(op.f("ix_quota_alert_states_id"), table_name="quota_alert_states")
    op.drop_index("ix_quota_alert_states_endpoint_user", table_name="quota_alert_states")
    op.drop_index("ix_quota_alert_states_endpoint_account", table_name="quota_alert_states")
    op.drop_table("quota_alert_states")

    op.drop_index("uq_quota_usage_daily_user", table_name="quota_usage_daily")
    op.drop_index("uq_quota_usage_daily_account", table_name="quota_usage_daily")
    op.drop_index(op.f("ix_quota_usage_daily_storage_endpoint_id"), table_name="quota_usage_daily")
    op.drop_index(op.f("ix_quota_usage_daily_s3_user_id"), table_name="quota_usage_daily")
    op.drop_index(op.f("ix_quota_usage_daily_s3_account_id"), table_name="quota_usage_daily")
    op.drop_index(op.f("ix_quota_usage_daily_id"), table_name="quota_usage_daily")
    op.drop_index(op.f("ix_quota_usage_daily_day"), table_name="quota_usage_daily")
    op.drop_index("ix_quota_usage_daily_endpoint_day_user", table_name="quota_usage_daily")
    op.drop_index("ix_quota_usage_daily_endpoint_day_account", table_name="quota_usage_daily")
    op.drop_table("quota_usage_daily")

    op.drop_index("uq_quota_usage_hourly_user", table_name="quota_usage_hourly")
    op.drop_index("uq_quota_usage_hourly_account", table_name="quota_usage_hourly")
    op.drop_index(op.f("ix_quota_usage_hourly_storage_endpoint_id"), table_name="quota_usage_hourly")
    op.drop_index(op.f("ix_quota_usage_hourly_s3_user_id"), table_name="quota_usage_hourly")
    op.drop_index(op.f("ix_quota_usage_hourly_s3_account_id"), table_name="quota_usage_hourly")
    op.drop_index(op.f("ix_quota_usage_hourly_id"), table_name="quota_usage_hourly")
    op.drop_index(op.f("ix_quota_usage_hourly_hour_ts"), table_name="quota_usage_hourly")
    op.drop_index("ix_quota_usage_hourly_endpoint_hour_user", table_name="quota_usage_hourly")
    op.drop_index("ix_quota_usage_hourly_endpoint_hour_account", table_name="quota_usage_hourly")
    op.drop_table("quota_usage_hourly")

    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.drop_column("quota_alerts_global_watch")
        batch_op.drop_column("quota_alerts_enabled")
