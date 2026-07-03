"""Add multi-backend coordination state.

Revision ID: 0060_multi_backend_coordination
Revises: 0059_backend_legacy_compat_backfill
Create Date: 2026-07-03 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "0060_multi_backend_coordination"
down_revision = "0059_backend_legacy_compat_backfill"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "backend_operation_leases",
        sa.Column("operation_name", sa.String(), nullable=False),
        sa.Column("lease_owner", sa.String(), nullable=False),
        sa.Column("lease_until", sa.DateTime(), nullable=False),
        sa.Column("acquired_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.Column("metadata_json", sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint("operation_name"),
    )
    op.create_index(
        op.f("ix_backend_operation_leases_lease_until"),
        "backend_operation_leases",
        ["lease_until"],
        unique=False,
    )

    op.create_table(
        "app_settings",
        sa.Column("key", sa.String(), nullable=False),
        sa.Column("payload_json", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("key"),
    )

    with op.batch_alter_table("billing_usage_daily", schema=None) as batch_op:
        batch_op.create_index(
            "uq_billing_usage_daily_account",
            ["day", "storage_endpoint_id", "s3_account_id", "source"],
            unique=True,
            postgresql_where=sa.text("s3_account_id IS NOT NULL AND s3_user_id IS NULL"),
            sqlite_where=sa.text("s3_account_id IS NOT NULL AND s3_user_id IS NULL"),
        )
        batch_op.create_index(
            "uq_billing_usage_daily_user",
            ["day", "storage_endpoint_id", "s3_user_id", "source"],
            unique=True,
            postgresql_where=sa.text("s3_user_id IS NOT NULL AND s3_account_id IS NULL"),
            sqlite_where=sa.text("s3_user_id IS NOT NULL AND s3_account_id IS NULL"),
        )

    with op.batch_alter_table("billing_storage_daily", schema=None) as batch_op:
        batch_op.create_index(
            "uq_billing_storage_daily_account",
            ["day", "storage_endpoint_id", "s3_account_id", "source"],
            unique=True,
            postgresql_where=sa.text("s3_account_id IS NOT NULL AND s3_user_id IS NULL"),
            sqlite_where=sa.text("s3_account_id IS NOT NULL AND s3_user_id IS NULL"),
        )
        batch_op.create_index(
            "uq_billing_storage_daily_user",
            ["day", "storage_endpoint_id", "s3_user_id", "source"],
            unique=True,
            postgresql_where=sa.text("s3_user_id IS NOT NULL AND s3_account_id IS NULL"),
            sqlite_where=sa.text("s3_user_id IS NOT NULL AND s3_account_id IS NULL"),
        )


def downgrade() -> None:
    with op.batch_alter_table("billing_storage_daily", schema=None) as batch_op:
        batch_op.drop_index("uq_billing_storage_daily_user")
        batch_op.drop_index("uq_billing_storage_daily_account")

    with op.batch_alter_table("billing_usage_daily", schema=None) as batch_op:
        batch_op.drop_index("uq_billing_usage_daily_user")
        batch_op.drop_index("uq_billing_usage_daily_account")

    op.drop_table("app_settings")
    op.drop_index(op.f("ix_backend_operation_leases_lease_until"), table_name="backend_operation_leases")
    op.drop_table("backend_operation_leases")
