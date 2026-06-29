# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Add UI-managed OIDC providers."""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0054_oidc_providers"
down_revision = "0053_manager_bucket_purge_access"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "oidc_providers",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("provider_id", sa.String(), nullable=False),
        sa.Column("display_name", sa.String(), nullable=False),
        sa.Column("discovery_url", sa.String(), nullable=False),
        sa.Column("client_id", sa.String(), nullable=False),
        sa.Column("client_secret", sa.String(), nullable=True),
        sa.Column("redirect_uri", sa.String(), nullable=False),
        sa.Column("scopes_json", sa.Text(), nullable=False, server_default='["openid","email","profile"]'),
        sa.Column("prompt", sa.String(), nullable=True),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default="1"),
        sa.Column("icon_url", sa.String(), nullable=True),
        sa.Column("use_pkce", sa.Boolean(), nullable=False, server_default="1"),
        sa.Column("use_nonce", sa.Boolean(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("provider_id"),
    )
    op.create_index(op.f("ix_oidc_providers_id"), "oidc_providers", ["id"], unique=False)
    op.create_index(op.f("ix_oidc_providers_provider_id"), "oidc_providers", ["provider_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_oidc_providers_provider_id"), table_name="oidc_providers")
    op.drop_index(op.f("ix_oidc_providers_id"), table_name="oidc_providers")
    op.drop_table("oidc_providers")
