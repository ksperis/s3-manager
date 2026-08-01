# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Add Portal Storage Space icon descriptors and uploaded images.

Revision ID: 0071_portal_storage_space_icons
Revises: 0070_managed_private_access
Create Date: 2026-08-01 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "0071_portal_storage_space_icons"
down_revision = "0070_managed_private_access"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("portal_storage_space_metadata", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("icon_source", sa.String(), nullable=False, server_default="preset")
        )
        batch_op.add_column(
            sa.Column("icon_preset", sa.String(), nullable=False, server_default="bucket")
        )
        batch_op.add_column(sa.Column("icon_image", sa.LargeBinary(), nullable=True))
        batch_op.add_column(sa.Column("icon_content_type", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("icon_updated_at", sa.DateTime(), nullable=True))
        batch_op.create_check_constraint(
            "ck_portal_storage_space_metadata_icon_source",
            "icon_source IN ('preset', 'uploaded')",
        )
        batch_op.create_check_constraint(
            "ck_portal_storage_space_metadata_icon_preset",
            "icon_preset IN ('bucket', 'folder', 'archive', 'database', 'media')",
        )
        batch_op.create_check_constraint(
            "ck_portal_storage_space_metadata_icon_content_type",
            "icon_content_type IS NULL OR icon_content_type IN ('image/jpeg', 'image/png')",
        )


def downgrade() -> None:
    with op.batch_alter_table("portal_storage_space_metadata", schema=None) as batch_op:
        batch_op.drop_constraint(
            "ck_portal_storage_space_metadata_icon_content_type",
            type_="check",
        )
        batch_op.drop_constraint(
            "ck_portal_storage_space_metadata_icon_preset",
            type_="check",
        )
        batch_op.drop_constraint(
            "ck_portal_storage_space_metadata_icon_source",
            type_="check",
        )
        batch_op.drop_column("icon_updated_at")
        batch_op.drop_column("icon_content_type")
        batch_op.drop_column("icon_image")
        batch_op.drop_column("icon_preset")
        batch_op.drop_column("icon_source")
