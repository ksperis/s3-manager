# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Canonicalize S3 connection credential owner types.

Revision ID: 0073_canonical_connection_owner_types
Revises: 0072_portal_settings_delegation
Create Date: 2026-08-02 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "0073_canonical_connection_owner_types"
down_revision = "0072_portal_settings_delegation"
branch_labels = None
depends_on = None


_CANONICAL_OWNER_TYPES = ("iam_user", "account_user", "s3_user")


def upgrade() -> None:
    op.execute(
        sa.text(
            "UPDATE s3_connections SET credential_owner_type = 's3_user' "
            "WHERE lower(trim(credential_owner_type)) = 'rgw_user'"
        )
    )
    for owner_type in _CANONICAL_OWNER_TYPES:
        op.execute(
            sa.text(
                "UPDATE s3_connections SET credential_owner_type = :canonical "
                "WHERE lower(trim(credential_owner_type)) = :canonical"
            ).bindparams(canonical=owner_type)
        )
    op.execute(
        sa.text(
            "UPDATE s3_connections SET credential_owner_type = NULL "
            "WHERE credential_owner_type IS NOT NULL "
            "AND credential_owner_type NOT IN ('iam_user', 'account_user', 's3_user')"
        )
    )
    with op.batch_alter_table("s3_connections", schema=None) as batch_op:
        batch_op.create_check_constraint(
            "ck_s3_connections_credential_owner_type",
            "credential_owner_type IS NULL OR "
            "credential_owner_type IN ('iam_user', 'account_user', 's3_user')",
        )


def downgrade() -> None:
    with op.batch_alter_table("s3_connections", schema=None) as batch_op:
        batch_op.drop_constraint(
            "ck_s3_connections_credential_owner_type",
            type_="check",
        )
