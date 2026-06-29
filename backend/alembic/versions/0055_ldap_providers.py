# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Add UI-managed LDAP providers."""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0055_ldap_providers"
down_revision = "0054_oidc_providers"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "ldap_providers",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("provider_id", sa.String(), nullable=False),
        sa.Column("display_name", sa.String(), nullable=False),
        sa.Column("url", sa.String(), nullable=False),
        sa.Column("bind_dn", sa.String(), nullable=False),
        sa.Column("bind_password", sa.String(), nullable=False),
        sa.Column("user_base_dn", sa.String(), nullable=False),
        sa.Column("user_filter", sa.Text(), nullable=False),
        sa.Column("email_attribute", sa.String(), nullable=False, server_default="mail"),
        sa.Column("name_attribute", sa.String(), nullable=True),
        sa.Column("subject_attribute", sa.String(), nullable=True),
        sa.Column("start_tls", sa.Boolean(), nullable=False, server_default="0"),
        sa.Column("tls_verify", sa.Boolean(), nullable=False, server_default="1"),
        sa.Column("tls_ca_file", sa.String(), nullable=True),
        sa.Column("timeout_seconds", sa.Float(), nullable=False, server_default="5"),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default="1"),
        sa.Column("allow_insecure", sa.Boolean(), nullable=False, server_default="0"),
        sa.Column("allow_email_linking", sa.Boolean(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("provider_id"),
    )
    op.create_index(op.f("ix_ldap_providers_id"), "ldap_providers", ["id"], unique=False)
    op.create_index(op.f("ix_ldap_providers_provider_id"), "ldap_providers", ["provider_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_ldap_providers_provider_id"), table_name="ldap_providers")
    op.drop_index(op.f("ix_ldap_providers_id"), table_name="ldap_providers")
    op.drop_table("ldap_providers")
