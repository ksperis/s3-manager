# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""add api tokens

Revision ID: 0005_api_tokens
Revises: 0004_temporary_s3_connections
Create Date: 2026-02-07 10:00:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0005_api_tokens"
down_revision = "0004_temporary_s3_connections"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "api_tokens",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("jti", sa.String(), nullable=False),
        sa.Column("token_hash", sa.String(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("last_used_at", sa.DateTime(), nullable=True),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("revoked_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("api_tokens", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_api_tokens_created_at"), ["created_at"], unique=False)
        batch_op.create_index(batch_op.f("ix_api_tokens_id"), ["id"], unique=False)
        batch_op.create_index(batch_op.f("ix_api_tokens_jti"), ["jti"], unique=True)
        batch_op.create_index(batch_op.f("ix_api_tokens_token_hash"), ["token_hash"], unique=True)
        batch_op.create_index(batch_op.f("ix_api_tokens_user_id"), ["user_id"], unique=False)


def downgrade() -> None:
    with op.batch_alter_table("api_tokens", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_api_tokens_user_id"))
        batch_op.drop_index(batch_op.f("ix_api_tokens_token_hash"))
        batch_op.drop_index(batch_op.f("ix_api_tokens_jti"))
        batch_op.drop_index(batch_op.f("ix_api_tokens_id"))
        batch_op.drop_index(batch_op.f("ix_api_tokens_created_at"))

    op.drop_table("api_tokens")
