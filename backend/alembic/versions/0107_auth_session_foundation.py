# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Add revocable authentication sessions and refresh token families.

Revision ID: 0107_auth_session_foundation
Revises: 0106_remove_temporary_s3_connections
Create Date: 2026-08-14
"""

from alembic import op
import sqlalchemy as sa


revision = "0107_auth_session_foundation"
down_revision = "0106_remove_temporary_s3_connections"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.add_column(sa.Column("auth_version", sa.Integer(), nullable=False, server_default="1"))

    with op.batch_alter_table("s3_sessions", schema=None) as batch_op:
        batch_op.alter_column("access_key_enc", existing_type=sa.String(), nullable=True)
        batch_op.alter_column("secret_key_enc", existing_type=sa.String(), nullable=True)
        batch_op.add_column(sa.Column("idle_expires_at", sa.DateTime(timezone=True), nullable=True))
        batch_op.add_column(sa.Column("absolute_expires_at", sa.DateTime(timezone=True), nullable=True))
        batch_op.add_column(sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True))
        batch_op.add_column(sa.Column("revoke_reason", sa.String(), nullable=True))
        batch_op.create_index("ix_s3_sessions_revoked_at", ["revoked_at"], unique=False)

    with op.batch_alter_table("api_tokens", schema=None) as batch_op:
        batch_op.add_column(sa.Column("scopes_json", sa.Text(), nullable=False, server_default="[]"))
        batch_op.add_column(sa.Column("auth_version", sa.Integer(), nullable=False, server_default="1"))

    op.create_table(
        "auth_sessions",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=True),
        sa.Column("s3_session_id", sa.String(), nullable=True),
        sa.Column("principal_type", sa.String(), nullable=False),
        sa.Column("auth_type", sa.String(), nullable=False),
        sa.Column("auth_version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_activity_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("idle_expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("absolute_expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("mfa_verified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ip_address", sa.String(), nullable=True),
        sa.Column("user_agent", sa.Text(), nullable=True),
        sa.Column("csrf_token_hash", sa.String(), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoke_reason", sa.String(), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["s3_session_id"], ["s3_sessions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    for column in ("user_id", "s3_session_id", "last_activity_at", "idle_expires_at", "absolute_expires_at", "revoked_at"):
        op.create_index(f"ix_auth_sessions_{column}", "auth_sessions", [column], unique=False)

    op.create_table(
        "refresh_tokens",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("family_id", sa.String(), nullable=False),
        sa.Column("auth_session_id", sa.String(), nullable=False),
        sa.Column("parent_id", sa.String(), nullable=True),
        sa.Column("token_hash", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("replaced_by_id", sa.String(), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoke_reason", sa.String(), nullable=True),
        sa.ForeignKeyConstraint(["auth_session_id"], ["auth_sessions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["parent_id"], ["refresh_tokens.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["replaced_by_id"], ["refresh_tokens.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token_hash"),
    )
    for column in ("family_id", "auth_session_id", "token_hash", "expires_at", "revoked_at"):
        op.create_index(
            f"ix_refresh_tokens_{column}",
            "refresh_tokens",
            [column],
            unique=column == "token_hash",
        )


def downgrade() -> None:
    for column in ("revoked_at", "expires_at", "token_hash", "auth_session_id", "family_id"):
        op.drop_index(f"ix_refresh_tokens_{column}", table_name="refresh_tokens")
    op.drop_table("refresh_tokens")
    for column in ("revoked_at", "absolute_expires_at", "idle_expires_at", "last_activity_at", "s3_session_id", "user_id"):
        op.drop_index(f"ix_auth_sessions_{column}", table_name="auth_sessions")
    op.drop_table("auth_sessions")
    with op.batch_alter_table("api_tokens", schema=None) as batch_op:
        batch_op.drop_column("auth_version")
        batch_op.drop_column("scopes_json")
    with op.batch_alter_table("s3_sessions", schema=None) as batch_op:
        batch_op.drop_index("ix_s3_sessions_revoked_at")
        batch_op.drop_column("revoke_reason")
        batch_op.drop_column("revoked_at")
        batch_op.drop_column("absolute_expires_at")
        batch_op.drop_column("idle_expires_at")
        batch_op.alter_column("secret_key_enc", existing_type=sa.String(), nullable=False)
        batch_op.alter_column("access_key_enc", existing_type=sa.String(), nullable=False)
    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.drop_column("auth_version")
