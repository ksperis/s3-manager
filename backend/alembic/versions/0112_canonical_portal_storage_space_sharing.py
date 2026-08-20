# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Enforce canonical Portal Storage Space sharing metadata.

Revision ID: 0112_canonical_portal_sharing
Revises: 0111_auth_schema_drift_repair
Create Date: 2026-08-20
"""

from alembic import op
import sqlalchemy as sa


revision = "0112_canonical_portal_sharing"
down_revision = "0111_auth_schema_drift_repair"
branch_labels = None
depends_on = None


_CANONICAL_SHARING_CONSTRAINT = (
    "(visibility = 'private' AND share_scope = 'restricted' AND account_member_role IS NULL) OR "
    "(visibility = 'shared' AND ("
    "(share_scope = 'restricted' AND account_member_role IS NULL) OR "
    "(share_scope = 'account' AND account_member_role IS NOT NULL "
    "AND account_member_role IN ('Viewer', 'Editor'))"
    "))"
)


def upgrade() -> None:
    bind = op.get_bind()
    bind.execute(
        sa.text(
            "UPDATE portal_storage_space_metadata "
            "SET share_scope = 'restricted', account_member_role = NULL "
            "WHERE visibility = 'private'"
        )
    )
    bind.execute(
        sa.text(
            "UPDATE portal_storage_space_metadata "
            "SET account_member_role = NULL "
            "WHERE visibility = 'shared' AND share_scope = 'restricted'"
        )
    )
    bind.execute(
        sa.text(
            "UPDATE portal_storage_space_metadata "
            "SET account_member_role = 'Editor' "
            "WHERE visibility = 'shared' AND share_scope = 'account' "
            "AND account_member_role IS NULL"
        )
    )

    with op.batch_alter_table("portal_storage_space_metadata", schema=None) as batch_op:
        batch_op.drop_constraint("ck_portal_storage_space_metadata_account_member_role", type_="check")
        batch_op.drop_constraint("ck_portal_storage_space_metadata_share_scope", type_="check")
        batch_op.create_check_constraint(
            "ck_portal_storage_space_metadata_canonical_sharing",
            _CANONICAL_SHARING_CONSTRAINT,
        )


def downgrade() -> None:
    with op.batch_alter_table("portal_storage_space_metadata", schema=None) as batch_op:
        batch_op.drop_constraint("ck_portal_storage_space_metadata_canonical_sharing", type_="check")
        batch_op.create_check_constraint(
            "ck_portal_storage_space_metadata_share_scope",
            "share_scope IN ('restricted', 'account')",
        )
        batch_op.create_check_constraint(
            "ck_portal_storage_space_metadata_account_member_role",
            "account_member_role IS NULL OR account_member_role IN ('Viewer', 'Editor')",
        )
