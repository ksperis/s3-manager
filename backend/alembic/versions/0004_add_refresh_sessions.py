"""Add refresh sessions

Revision ID: 0004_add_refresh_sessions
Revises: 0009_drop_user_s3_connection_flags
Create Date: 2026-01-27 00:00:00
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0004_add_refresh_sessions"
down_revision = "0009_drop_user_s3_connection_flags"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "refresh_sessions",
        sa.Column("id", sa.String(), primary_key=True, nullable=False),
        sa.Column("token_hash", sa.String(), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("rgw_session_id", sa.String(), sa.ForeignKey("rgw_sessions.id"), nullable=True),
        sa.Column("auth_type", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("last_used_at", sa.DateTime(), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("revoked_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_refresh_sessions_id", "refresh_sessions", ["id"])
    op.create_index("ix_refresh_sessions_token_hash", "refresh_sessions", ["token_hash"], unique=True)
    op.create_index("ix_refresh_sessions_user_id", "refresh_sessions", ["user_id"])
    op.create_index("ix_refresh_sessions_rgw_session_id", "refresh_sessions", ["rgw_session_id"])


def downgrade() -> None:
    op.drop_index("ix_refresh_sessions_rgw_session_id", table_name="refresh_sessions")
    op.drop_index("ix_refresh_sessions_user_id", table_name="refresh_sessions")
    op.drop_index("ix_refresh_sessions_token_hash", table_name="refresh_sessions")
    op.drop_index("ix_refresh_sessions_id", table_name="refresh_sessions")
    op.drop_table("refresh_sessions")
