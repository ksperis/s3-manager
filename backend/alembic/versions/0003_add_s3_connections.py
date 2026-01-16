"""Add user-scoped S3 connections

Revision ID: 0003_add_s3_connections
Revises: 0002_add_portal_settings_override
Create Date: 2026-01-16 00:00:00
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

from app.core.security import EncryptedString

revision = "0003_add_s3_connections"
down_revision = "0002_add_portal_settings_override"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "s3_connections",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("owner_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("provider_hint", sa.String(), nullable=True),
        sa.Column("endpoint_url", sa.String(), nullable=False),
        sa.Column("region", sa.String(), nullable=True),
        sa.Column("access_key_id", sa.String(), nullable=False),
        sa.Column("secret_access_key", EncryptedString(), nullable=False),
        sa.Column("session_token", EncryptedString(), nullable=True),
        sa.Column("expires_at", sa.DateTime(), nullable=True),
        sa.Column("force_path_style", sa.Boolean(), nullable=False, server_default=sa.text("0")),
        sa.Column("verify_tls", sa.Boolean(), nullable=False, server_default=sa.text("1")),
        sa.Column("capabilities_json", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.Column("last_used_at", sa.DateTime(), nullable=True),
        sa.UniqueConstraint("owner_user_id", "name", name="uq_s3_connections_owner_name"),
    )
    op.create_index("ix_s3_connections_id", "s3_connections", ["id"])
    op.create_index("ix_s3_connections_owner_user_id", "s3_connections", ["owner_user_id"])


def downgrade() -> None:
    op.drop_index("ix_s3_connections_owner_user_id", table_name="s3_connections")
    op.drop_index("ix_s3_connections_id", table_name="s3_connections")
    op.drop_table("s3_connections")
