"""billing tables

Revision ID: 0002_billing_tables
Revises: 0001_initial_schema
Create Date: 2026-02-03 10:00:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0002_billing_tables"
down_revision = "0001_initial_schema"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "billing_rate_cards",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("currency", sa.String(), server_default="EUR", nullable=False),
        sa.Column("storage_gb_month_price", sa.Numeric(12, 6), nullable=True),
        sa.Column("egress_gb_price", sa.Numeric(12, 6), nullable=True),
        sa.Column("ingress_gb_price", sa.Numeric(12, 6), nullable=True),
        sa.Column("requests_per_1000_price", sa.Numeric(12, 6), nullable=True),
        sa.Column("effective_from", sa.Date(), nullable=False),
        sa.Column("effective_to", sa.Date(), nullable=True),
        sa.Column("storage_endpoint_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["storage_endpoint_id"], ["storage_endpoints.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name", name="uq_billing_rate_cards_name"),
    )
    with op.batch_alter_table("billing_rate_cards", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_billing_rate_cards_id"), ["id"], unique=False)
        batch_op.create_index(batch_op.f("ix_billing_rate_cards_storage_endpoint_id"), ["storage_endpoint_id"], unique=False)

    op.create_table(
        "billing_assignments",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("storage_endpoint_id", sa.Integer(), nullable=False),
        sa.Column("s3_account_id", sa.Integer(), nullable=True),
        sa.Column("s3_user_id", sa.Integer(), nullable=True),
        sa.Column("rate_card_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["rate_card_id"], ["billing_rate_cards.id"]),
        sa.ForeignKeyConstraint(["s3_account_id"], ["s3_accounts.id"]),
        sa.ForeignKeyConstraint(["s3_user_id"], ["s3_users.id"]),
        sa.ForeignKeyConstraint(["storage_endpoint_id"], ["storage_endpoints.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("billing_assignments", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_billing_assignments_id"), ["id"], unique=False)
        batch_op.create_index(batch_op.f("ix_billing_assignments_rate_card_id"), ["rate_card_id"], unique=False)
        batch_op.create_index(batch_op.f("ix_billing_assignments_s3_account_id"), ["s3_account_id"], unique=False)
        batch_op.create_index(batch_op.f("ix_billing_assignments_s3_user_id"), ["s3_user_id"], unique=False)
        batch_op.create_index(batch_op.f("ix_billing_assignments_storage_endpoint_id"), ["storage_endpoint_id"], unique=False)

    op.create_table(
        "billing_usage_daily",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("storage_endpoint_id", sa.Integer(), nullable=False),
        sa.Column("s3_account_id", sa.Integer(), nullable=True),
        sa.Column("s3_user_id", sa.Integer(), nullable=True),
        sa.Column("bytes_in", sa.BigInteger(), server_default="0", nullable=False),
        sa.Column("bytes_out", sa.BigInteger(), server_default="0", nullable=False),
        sa.Column("ops_total", sa.BigInteger(), server_default="0", nullable=False),
        sa.Column("ops_breakdown", sa.Text(), nullable=True),
        sa.Column("source", sa.String(), nullable=False),
        sa.Column("collected_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["s3_account_id"], ["s3_accounts.id"]),
        sa.ForeignKeyConstraint(["s3_user_id"], ["s3_users.id"]),
        sa.ForeignKeyConstraint(["storage_endpoint_id"], ["storage_endpoints.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "day",
            "storage_endpoint_id",
            "s3_account_id",
            "s3_user_id",
            "source",
            name="uq_billing_usage_daily",
        ),
    )
    with op.batch_alter_table("billing_usage_daily", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_billing_usage_daily_day"), ["day"], unique=False)
        batch_op.create_index(batch_op.f("ix_billing_usage_daily_id"), ["id"], unique=False)
        batch_op.create_index(batch_op.f("ix_billing_usage_daily_s3_account_id"), ["s3_account_id"], unique=False)
        batch_op.create_index(batch_op.f("ix_billing_usage_daily_s3_user_id"), ["s3_user_id"], unique=False)
        batch_op.create_index(batch_op.f("ix_billing_usage_daily_storage_endpoint_id"), ["storage_endpoint_id"], unique=False)

    op.create_table(
        "billing_storage_daily",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("storage_endpoint_id", sa.Integer(), nullable=False),
        sa.Column("s3_account_id", sa.Integer(), nullable=True),
        sa.Column("s3_user_id", sa.Integer(), nullable=True),
        sa.Column("total_bytes", sa.BigInteger(), server_default="0", nullable=False),
        sa.Column("total_objects", sa.BigInteger(), server_default="0", nullable=False),
        sa.Column("by_bucket", sa.Text(), nullable=True),
        sa.Column("source", sa.String(), nullable=False),
        sa.Column("collected_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["s3_account_id"], ["s3_accounts.id"]),
        sa.ForeignKeyConstraint(["s3_user_id"], ["s3_users.id"]),
        sa.ForeignKeyConstraint(["storage_endpoint_id"], ["storage_endpoints.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "day",
            "storage_endpoint_id",
            "s3_account_id",
            "s3_user_id",
            "source",
            name="uq_billing_storage_daily",
        ),
    )
    with op.batch_alter_table("billing_storage_daily", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_billing_storage_daily_day"), ["day"], unique=False)
        batch_op.create_index(batch_op.f("ix_billing_storage_daily_id"), ["id"], unique=False)
        batch_op.create_index(batch_op.f("ix_billing_storage_daily_s3_account_id"), ["s3_account_id"], unique=False)
        batch_op.create_index(batch_op.f("ix_billing_storage_daily_s3_user_id"), ["s3_user_id"], unique=False)
        batch_op.create_index(batch_op.f("ix_billing_storage_daily_storage_endpoint_id"), ["storage_endpoint_id"], unique=False)


def downgrade() -> None:
    with op.batch_alter_table("billing_storage_daily", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_billing_storage_daily_storage_endpoint_id"))
        batch_op.drop_index(batch_op.f("ix_billing_storage_daily_s3_user_id"))
        batch_op.drop_index(batch_op.f("ix_billing_storage_daily_s3_account_id"))
        batch_op.drop_index(batch_op.f("ix_billing_storage_daily_id"))
        batch_op.drop_index(batch_op.f("ix_billing_storage_daily_day"))

    op.drop_table("billing_storage_daily")

    with op.batch_alter_table("billing_usage_daily", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_billing_usage_daily_storage_endpoint_id"))
        batch_op.drop_index(batch_op.f("ix_billing_usage_daily_s3_user_id"))
        batch_op.drop_index(batch_op.f("ix_billing_usage_daily_s3_account_id"))
        batch_op.drop_index(batch_op.f("ix_billing_usage_daily_id"))
        batch_op.drop_index(batch_op.f("ix_billing_usage_daily_day"))

    op.drop_table("billing_usage_daily")

    with op.batch_alter_table("billing_assignments", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_billing_assignments_storage_endpoint_id"))
        batch_op.drop_index(batch_op.f("ix_billing_assignments_s3_user_id"))
        batch_op.drop_index(batch_op.f("ix_billing_assignments_s3_account_id"))
        batch_op.drop_index(batch_op.f("ix_billing_assignments_rate_card_id"))
        batch_op.drop_index(batch_op.f("ix_billing_assignments_id"))

    op.drop_table("billing_assignments")

    with op.batch_alter_table("billing_rate_cards", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_billing_rate_cards_storage_endpoint_id"))
        batch_op.drop_index(batch_op.f("ix_billing_rate_cards_id"))

    op.drop_table("billing_rate_cards")
