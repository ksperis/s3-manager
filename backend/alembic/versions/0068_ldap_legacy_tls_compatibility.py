# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Add opt-in LDAP legacy TLS cipher compatibility.

Revision ID: 0068_ldap_legacy_tls_compatibility
Revises: 0067_optional_ldap_bind_credentials
Create Date: 2026-07-23 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "0068_ldap_legacy_tls_compatibility"
down_revision = "0067_optional_ldap_bind_credentials"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("ldap_providers", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("allow_legacy_tls", sa.Boolean(), nullable=False, server_default="0")
        )


def downgrade() -> None:
    with op.batch_alter_table("ldap_providers", schema=None) as batch_op:
        batch_op.drop_column("allow_legacy_tls")
