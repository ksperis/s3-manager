"""pre-release schema hardening

Revision ID: 0014_pre_release_schema_hardening
Revises: 0013_s3_connections_shared_iam_metadata
Create Date: 2026-02-24 20:55:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0014_pre_release_schema_hardening"
down_revision = "0013_s3_connections_shared_iam_metadata"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Updated-at columns for mutable core entities.
    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.add_column(sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")))

    with op.batch_alter_table("s3_accounts", schema=None) as batch_op:
        batch_op.add_column(sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")))
    op.execute(sa.text("UPDATE s3_accounts SET created_at = CURRENT_TIMESTAMP WHERE created_at IS NULL"))
    with op.batch_alter_table("s3_accounts", schema=None) as batch_op:
        batch_op.alter_column("created_at", existing_type=sa.DateTime(), nullable=False)

    with op.batch_alter_table("s3_users", schema=None) as batch_op:
        batch_op.add_column(sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")))

    # API token hardening metadata.
    with op.batch_alter_table("api_tokens", schema=None) as batch_op:
        batch_op.add_column(sa.Column("revoked_by_user_id", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("last_ip", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("last_user_agent", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("revoked_reason", sa.String(), nullable=True))
        batch_op.create_index(batch_op.f("ix_api_tokens_revoked_by_user_id"), ["revoked_by_user_id"], unique=False)
        batch_op.create_foreign_key("fk_api_tokens_revoked_by_user_id_users", "users", ["revoked_by_user_id"], ["id"])

    # Refresh-session hardening metadata.
    with op.batch_alter_table("refresh_sessions", schema=None) as batch_op:
        batch_op.add_column(sa.Column("revoked_by_user_id", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("last_ip", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("last_user_agent", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("revoked_reason", sa.String(), nullable=True))
        batch_op.create_index(batch_op.f("ix_refresh_sessions_revoked_by_user_id"), ["revoked_by_user_id"], unique=False)
        batch_op.create_foreign_key(
            "fk_refresh_sessions_revoked_by_user_id_users",
            "users",
            ["revoked_by_user_id"],
            ["id"],
        )

    # Request-context fields for audit forensics.
    with op.batch_alter_table("audit_logs", schema=None) as batch_op:
        batch_op.add_column(sa.Column("request_id", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("ip_address", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("user_agent", sa.String(), nullable=True))
        batch_op.create_index(batch_op.f("ix_audit_logs_request_id"), ["request_id"], unique=False)
        batch_op.create_index("ix_audit_logs_scope_id", ["scope", "id"], unique=False)
        batch_op.create_index("ix_audit_logs_account_id_id", ["account_id", "id"], unique=False)
        batch_op.create_index("ix_audit_logs_user_role_id", ["user_role", "id"], unique=False)

    # Association-table reverse lookup indexes.
    with op.batch_alter_table("user_s3_accounts", schema=None) as batch_op:
        batch_op.create_index("ix_user_s3_accounts_account_user", ["account_id", "user_id"], unique=False)

    with op.batch_alter_table("user_s3_users", schema=None) as batch_op:
        batch_op.create_index("ix_user_s3_users_s3_user_user", ["s3_user_id", "user_id"], unique=False)

    with op.batch_alter_table("user_s3_connections", schema=None) as batch_op:
        batch_op.create_index("ix_user_s3_connections_connection_user", ["s3_connection_id", "user_id"], unique=False)

    # Healthcheck workload composite indexes.
    with op.batch_alter_table("endpoint_health_checks", schema=None) as batch_op:
        batch_op.create_index(
            "ix_endpoint_health_checks_endpoint_mode_checked",
            ["storage_endpoint_id", "check_mode", "checked_at"],
            unique=False,
        )

    with op.batch_alter_table("endpoint_health_latest", schema=None) as batch_op:
        batch_op.create_index(
            "ix_endpoint_health_latest_endpoint_type_scope_checked",
            ["storage_endpoint_id", "check_type", "scope", "checked_at"],
            unique=False,
        )

    with op.batch_alter_table("endpoint_health_status_segments", schema=None) as batch_op:
        batch_op.create_index(
            "ix_endpoint_health_segments_endpoint_type_scope_started",
            ["storage_endpoint_id", "check_type", "scope", "started_at"],
            unique=False,
        )
        batch_op.create_index(
            "ix_endpoint_health_segments_endpoint_type_scope_ended",
            ["storage_endpoint_id", "check_type", "scope", "ended_at"],
            unique=False,
        )

    with op.batch_alter_table("endpoint_health_rollups", schema=None) as batch_op:
        batch_op.create_index(
            "ix_endpoint_health_rollups_endpoint_type_scope_res_bucket",
            ["storage_endpoint_id", "check_type", "scope", "resolution_seconds", "bucket_start"],
            unique=False,
        )

    # Billing workload composite indexes.
    with op.batch_alter_table("billing_usage_daily", schema=None) as batch_op:
        batch_op.create_index(
            "ix_billing_usage_daily_endpoint_day_account",
            ["storage_endpoint_id", "day", "s3_account_id"],
            unique=False,
        )
        batch_op.create_index(
            "ix_billing_usage_daily_endpoint_day_user",
            ["storage_endpoint_id", "day", "s3_user_id"],
            unique=False,
        )

    with op.batch_alter_table("billing_storage_daily", schema=None) as batch_op:
        batch_op.create_index(
            "ix_billing_storage_daily_endpoint_day_account",
            ["storage_endpoint_id", "day", "s3_account_id"],
            unique=False,
        )
        batch_op.create_index(
            "ix_billing_storage_daily_endpoint_day_user",
            ["storage_endpoint_id", "day", "s3_user_id"],
            unique=False,
        )

    with op.batch_alter_table("billing_rate_cards", schema=None) as batch_op:
        batch_op.create_index(
            "ix_billing_rate_cards_endpoint_effective_window",
            ["storage_endpoint_id", "effective_from", "effective_to"],
            unique=False,
        )

    with op.batch_alter_table("billing_assignments", schema=None) as batch_op:
        batch_op.create_index(
            "ix_billing_assignments_endpoint_account_created",
            ["storage_endpoint_id", "s3_account_id", "created_at"],
            unique=False,
        )
        batch_op.create_index(
            "ix_billing_assignments_endpoint_user_created",
            ["storage_endpoint_id", "s3_user_id", "created_at"],
            unique=False,
        )


def downgrade() -> None:
    with op.batch_alter_table("billing_assignments", schema=None) as batch_op:
        batch_op.drop_index("ix_billing_assignments_endpoint_user_created")
        batch_op.drop_index("ix_billing_assignments_endpoint_account_created")

    with op.batch_alter_table("billing_rate_cards", schema=None) as batch_op:
        batch_op.drop_index("ix_billing_rate_cards_endpoint_effective_window")

    with op.batch_alter_table("billing_storage_daily", schema=None) as batch_op:
        batch_op.drop_index("ix_billing_storage_daily_endpoint_day_user")
        batch_op.drop_index("ix_billing_storage_daily_endpoint_day_account")

    with op.batch_alter_table("billing_usage_daily", schema=None) as batch_op:
        batch_op.drop_index("ix_billing_usage_daily_endpoint_day_user")
        batch_op.drop_index("ix_billing_usage_daily_endpoint_day_account")

    with op.batch_alter_table("endpoint_health_rollups", schema=None) as batch_op:
        batch_op.drop_index("ix_endpoint_health_rollups_endpoint_type_scope_res_bucket")

    with op.batch_alter_table("endpoint_health_status_segments", schema=None) as batch_op:
        batch_op.drop_index("ix_endpoint_health_segments_endpoint_type_scope_ended")
        batch_op.drop_index("ix_endpoint_health_segments_endpoint_type_scope_started")

    with op.batch_alter_table("endpoint_health_latest", schema=None) as batch_op:
        batch_op.drop_index("ix_endpoint_health_latest_endpoint_type_scope_checked")

    with op.batch_alter_table("endpoint_health_checks", schema=None) as batch_op:
        batch_op.drop_index("ix_endpoint_health_checks_endpoint_mode_checked")

    with op.batch_alter_table("user_s3_connections", schema=None) as batch_op:
        batch_op.drop_index("ix_user_s3_connections_connection_user")

    with op.batch_alter_table("user_s3_users", schema=None) as batch_op:
        batch_op.drop_index("ix_user_s3_users_s3_user_user")

    with op.batch_alter_table("user_s3_accounts", schema=None) as batch_op:
        batch_op.drop_index("ix_user_s3_accounts_account_user")

    with op.batch_alter_table("audit_logs", schema=None) as batch_op:
        batch_op.drop_index("ix_audit_logs_user_role_id")
        batch_op.drop_index("ix_audit_logs_account_id_id")
        batch_op.drop_index("ix_audit_logs_scope_id")
        batch_op.drop_index(batch_op.f("ix_audit_logs_request_id"))
        batch_op.drop_column("user_agent")
        batch_op.drop_column("ip_address")
        batch_op.drop_column("request_id")

    with op.batch_alter_table("refresh_sessions", schema=None) as batch_op:
        batch_op.drop_constraint("fk_refresh_sessions_revoked_by_user_id_users", type_="foreignkey")
        batch_op.drop_index(batch_op.f("ix_refresh_sessions_revoked_by_user_id"))
        batch_op.drop_column("revoked_reason")
        batch_op.drop_column("last_user_agent")
        batch_op.drop_column("last_ip")
        batch_op.drop_column("revoked_by_user_id")

    with op.batch_alter_table("api_tokens", schema=None) as batch_op:
        batch_op.drop_constraint("fk_api_tokens_revoked_by_user_id_users", type_="foreignkey")
        batch_op.drop_index(batch_op.f("ix_api_tokens_revoked_by_user_id"))
        batch_op.drop_column("revoked_reason")
        batch_op.drop_column("last_user_agent")
        batch_op.drop_column("last_ip")
        batch_op.drop_column("revoked_by_user_id")

    with op.batch_alter_table("s3_users", schema=None) as batch_op:
        batch_op.drop_column("updated_at")

    with op.batch_alter_table("s3_accounts", schema=None) as batch_op:
        batch_op.alter_column("created_at", existing_type=sa.DateTime(), nullable=True)
        batch_op.drop_column("updated_at")

    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.drop_column("updated_at")
