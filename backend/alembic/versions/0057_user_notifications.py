# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Add user notifications."""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0057_user_notifications"
down_revision = "0056_portal_storage_space_grants"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "user_notifications",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("notification_type", sa.String(), nullable=False),
        sa.Column("severity", sa.String(), nullable=False),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("subject_type", sa.String(), nullable=True),
        sa.Column("storage_endpoint_id", sa.Integer(), nullable=True),
        sa.Column("s3_account_id", sa.Integer(), nullable=True),
        sa.Column("s3_user_id", sa.Integer(), nullable=True),
        sa.Column("event_key", sa.String(), nullable=False),
        sa.Column("payload_json", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("read_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["s3_account_id"], ["s3_accounts.id"]),
        sa.ForeignKeyConstraint(["s3_user_id"], ["s3_users.id"]),
        sa.ForeignKeyConstraint(["storage_endpoint_id"], ["storage_endpoints.id"]),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "event_key", name="uq_user_notifications_user_event"),
    )
    op.create_index(op.f("ix_user_notifications_id"), "user_notifications", ["id"], unique=False)
    op.create_index(op.f("ix_user_notifications_user_id"), "user_notifications", ["user_id"], unique=False)
    op.create_index(
        op.f("ix_user_notifications_notification_type"),
        "user_notifications",
        ["notification_type"],
        unique=False,
    )
    op.create_index(
        op.f("ix_user_notifications_storage_endpoint_id"),
        "user_notifications",
        ["storage_endpoint_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_user_notifications_s3_account_id"),
        "user_notifications",
        ["s3_account_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_user_notifications_s3_user_id"),
        "user_notifications",
        ["s3_user_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_user_notifications_created_at"),
        "user_notifications",
        ["created_at"],
        unique=False,
    )
    op.create_index("ix_user_notifications_user_created", "user_notifications", ["user_id", "created_at"], unique=False)
    op.create_index("ix_user_notifications_user_read", "user_notifications", ["user_id", "read_at"], unique=False)
    op.create_index(
        "ix_user_notifications_subject_account",
        "user_notifications",
        ["s3_account_id", "created_at"],
        unique=False,
    )
    op.create_index(
        "ix_user_notifications_subject_s3_user",
        "user_notifications",
        ["s3_user_id", "created_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_user_notifications_subject_s3_user", table_name="user_notifications")
    op.drop_index("ix_user_notifications_subject_account", table_name="user_notifications")
    op.drop_index("ix_user_notifications_user_read", table_name="user_notifications")
    op.drop_index("ix_user_notifications_user_created", table_name="user_notifications")
    op.drop_index(op.f("ix_user_notifications_created_at"), table_name="user_notifications")
    op.drop_index(op.f("ix_user_notifications_s3_user_id"), table_name="user_notifications")
    op.drop_index(op.f("ix_user_notifications_s3_account_id"), table_name="user_notifications")
    op.drop_index(op.f("ix_user_notifications_storage_endpoint_id"), table_name="user_notifications")
    op.drop_index(op.f("ix_user_notifications_notification_type"), table_name="user_notifications")
    op.drop_index(op.f("ix_user_notifications_user_id"), table_name="user_notifications")
    op.drop_index(op.f("ix_user_notifications_id"), table_name="user_notifications")
    op.drop_table("user_notifications")
