# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Allow LDAP providers to use anonymous directory searches.

Revision ID: 0067_optional_ldap_bind_credentials
Revises: 0066_portal_storage_space_access_model
Create Date: 2026-07-23 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "0067_optional_ldap_bind_credentials"
down_revision = "0066_portal_storage_space_access_model"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("ldap_providers", schema=None) as batch_op:
        batch_op.alter_column("bind_dn", existing_type=sa.String(), nullable=True)
        batch_op.alter_column("bind_password", existing_type=sa.String(), nullable=True)


def downgrade() -> None:
    bind = op.get_bind()
    anonymous_provider_count = bind.execute(
        sa.text(
            "SELECT COUNT(*) FROM ldap_providers "
            "WHERE bind_dn IS NULL OR bind_password IS NULL"
        )
    ).scalar_one()
    if anonymous_provider_count:
        raise RuntimeError(
            "Cannot downgrade while LDAP providers use anonymous search; "
            "configure bind credentials or remove those providers first"
        )
    with op.batch_alter_table("ldap_providers", schema=None) as batch_op:
        batch_op.alter_column("bind_password", existing_type=sa.String(), nullable=False)
        batch_op.alter_column("bind_dn", existing_type=sa.String(), nullable=False)
