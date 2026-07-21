# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Enforce the strict Portal Storage Space access model.

Revision ID: 0066_portal_storage_space_access_model
Revises: 0065_ui_group_avatars
Create Date: 2026-07-21 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "0066_portal_storage_space_access_model"
down_revision = "0065_ui_group_avatars"
branch_labels = None
depends_on = None


def _purge_portal_storage_space_state() -> None:
    """Drop DB state that cannot be reused with the strict access model.

    Storage resources and IAM credentials must be removed operationally before
    this migration. Alembic deliberately performs database-only cleanup and
    does not contact RGW.
    """
    bind = op.get_bind()
    bind.execute(
        sa.text(
            "DELETE FROM portal_public_links "
            "WHERE EXISTS ("
            "SELECT 1 FROM portal_storage_space_metadata AS metadata "
            "WHERE metadata.account_id = portal_public_links.account_id "
            "AND metadata.bucket_name = portal_public_links.bucket_name"
            ")"
        )
    )
    bind.execute(sa.text("DELETE FROM portal_external_access_credentials"))
    bind.execute(sa.text("DELETE FROM portal_storage_space_grants"))
    bind.execute(sa.text("DELETE FROM portal_storage_space_metadata"))


def upgrade() -> None:
    _purge_portal_storage_space_state()
    with op.batch_alter_table("portal_storage_space_metadata", schema=None) as batch_op:
        batch_op.drop_column("owner_label")
        batch_op.create_check_constraint(
            "ck_portal_storage_space_metadata_private_owner",
            "(visibility = 'private' AND owner_user_id IS NOT NULL) OR "
            "(visibility = 'shared' AND owner_user_id IS NULL)",
        )
    with op.batch_alter_table("portal_storage_space_grants", schema=None) as batch_op:
        batch_op.drop_constraint("ck_portal_storage_space_grants_role", type_="check")
        batch_op.create_check_constraint(
            "ck_portal_storage_space_grants_role",
            "role IN ('Viewer', 'Editor')",
        )


def downgrade() -> None:
    with op.batch_alter_table("portal_storage_space_grants", schema=None) as batch_op:
        batch_op.drop_constraint("ck_portal_storage_space_grants_role", type_="check")
        batch_op.create_check_constraint(
            "ck_portal_storage_space_grants_role",
            "role IN ('Viewer', 'Editor', 'Owner')",
        )
    with op.batch_alter_table("portal_storage_space_metadata", schema=None) as batch_op:
        batch_op.drop_constraint("ck_portal_storage_space_metadata_private_owner", type_="check")
        batch_op.add_column(sa.Column("owner_label", sa.String(), nullable=True))
