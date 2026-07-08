# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Add Portal admin requests.

Revision ID: 0063_portal_admin_requests
Revises: 0062_portal_external_access_credentials
Create Date: 2026-07-08 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "0063_portal_admin_requests"
down_revision = "0062_portal_external_access_credentials"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "portal_admin_requests",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("account_id", sa.Integer(), nullable=False),
        sa.Column("requester_user_id", sa.Integer(), nullable=True),
        sa.Column("requester_email", sa.String(), nullable=False),
        sa.Column("request_type", sa.String(), nullable=False),
        sa.Column("status", sa.String(), server_default="pending", nullable=False),
        sa.Column("payload_json", sa.Text(), nullable=False),
        sa.Column("result_json", sa.Text(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("decided_by_user_id", sa.Integer(), nullable=True),
        sa.Column("decided_by_email", sa.String(), nullable=True),
        sa.Column("decided_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint(
            "request_type IN ('portal_user_access', 'portal_user_removal', 'account_quota_change')",
            name="ck_portal_admin_requests_type",
        ),
        sa.CheckConstraint(
            "status IN ('pending', 'processing', 'approved', 'rejected', 'failed')",
            name="ck_portal_admin_requests_status",
        ),
        sa.ForeignKeyConstraint(["account_id"], ["s3_accounts.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["decided_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["requester_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_portal_admin_requests_id"), "portal_admin_requests", ["id"], unique=False)
    op.create_index(
        "ix_portal_admin_requests_account_status",
        "portal_admin_requests",
        ["account_id", "status", "created_at"],
        unique=False,
    )
    op.create_index(
        "ix_portal_admin_requests_requester",
        "portal_admin_requests",
        ["requester_user_id", "created_at"],
        unique=False,
    )
    op.create_index(
        "ix_portal_admin_requests_status_created",
        "portal_admin_requests",
        ["status", "created_at"],
        unique=False,
    )

    op.create_table(
        "portal_admin_request_messages",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("request_id", sa.Integer(), nullable=False),
        sa.Column("author_user_id", sa.Integer(), nullable=True),
        sa.Column("author_email", sa.String(), nullable=False),
        sa.Column("author_role", sa.String(), nullable=True),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["author_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["request_id"], ["portal_admin_requests.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_portal_admin_request_messages_id"),
        "portal_admin_request_messages",
        ["id"],
        unique=False,
    )
    op.create_index(
        "ix_portal_admin_request_messages_author",
        "portal_admin_request_messages",
        ["author_user_id", "created_at"],
        unique=False,
    )
    op.create_index(
        "ix_portal_admin_request_messages_request",
        "portal_admin_request_messages",
        ["request_id", "created_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_portal_admin_request_messages_request", table_name="portal_admin_request_messages")
    op.drop_index("ix_portal_admin_request_messages_author", table_name="portal_admin_request_messages")
    op.drop_index(op.f("ix_portal_admin_request_messages_id"), table_name="portal_admin_request_messages")
    op.drop_table("portal_admin_request_messages")
    op.drop_index("ix_portal_admin_requests_status_created", table_name="portal_admin_requests")
    op.drop_index("ix_portal_admin_requests_requester", table_name="portal_admin_requests")
    op.drop_index("ix_portal_admin_requests_account_status", table_name="portal_admin_requests")
    op.drop_index(op.f("ix_portal_admin_requests_id"), table_name="portal_admin_requests")
    op.drop_table("portal_admin_requests")
