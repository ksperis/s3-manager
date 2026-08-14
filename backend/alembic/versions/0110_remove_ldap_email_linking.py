# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Remove automatic LDAP email-linking configuration.

Revision ID: 0110_remove_ldap_email_linking
Revises: 0109_authentication_cutover
Create Date: 2026-08-14
"""

from alembic import op
import sqlalchemy as sa


revision = "0110_remove_ldap_email_linking"
down_revision = "0109_authentication_cutover"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("ldap_providers", schema=None) as batch_op:
        batch_op.drop_column("allow_email_linking")


def downgrade() -> None:
    with op.batch_alter_table("ldap_providers", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("allow_email_linking", sa.Boolean(), nullable=False, server_default=sa.false())
        )
