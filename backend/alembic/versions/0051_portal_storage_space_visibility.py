# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Add Portal Storage Space visibility metadata."""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0051_portal_storage_space_visibility"
down_revision = "0050_portal_storage_space_naming_modes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("portal_storage_space_metadata", schema=None) as batch_op:
        batch_op.add_column(sa.Column("owner_user_id", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("visibility", sa.String(), nullable=False, server_default="private"))
        batch_op.create_foreign_key(
            "fk_portal_storage_space_metadata_owner_user",
            "users",
            ["owner_user_id"],
            ["id"],
        )
        batch_op.create_index("ix_portal_storage_space_metadata_owner_user", ["owner_user_id"], unique=False)

    bind = op.get_bind()
    bind.execute(
        sa.text(
            """
            UPDATE portal_storage_space_metadata
            SET owner_user_id = (
                SELECT audit_logs.user_id
                FROM audit_logs
                WHERE audit_logs.account_id = portal_storage_space_metadata.account_id
                  AND audit_logs.entity_type = 'storage_space'
                  AND audit_logs.entity_id = portal_storage_space_metadata.bucket_name
                  AND audit_logs.action IN ('create_storage_space', 'import_storage_space')
                  AND audit_logs.user_id IS NOT NULL
                ORDER BY audit_logs.id ASC
                LIMIT 1
            )
            WHERE owner_user_id IS NULL
            """
        )
    )
    bind.execute(
        sa.text(
            """
            UPDATE portal_storage_space_metadata
            SET owner_user_id = (
                SELECT user_s3_accounts.user_id
                FROM user_s3_accounts
                WHERE user_s3_accounts.account_id = portal_storage_space_metadata.account_id
                  AND user_s3_accounts.account_role = 'portal_manager'
                ORDER BY user_s3_accounts.id ASC
                LIMIT 1
            )
            WHERE owner_user_id IS NULL
            """
        )
    )

    with op.batch_alter_table("portal_storage_space_metadata", schema=None) as batch_op:
        batch_op.drop_column("space_type")


def downgrade() -> None:
    with op.batch_alter_table("portal_storage_space_metadata", schema=None) as batch_op:
        batch_op.add_column(sa.Column("space_type", sa.String(), nullable=True))
        batch_op.drop_index("ix_portal_storage_space_metadata_owner_user")
        batch_op.drop_constraint("fk_portal_storage_space_metadata_owner_user", type_="foreignkey")
        batch_op.drop_column("visibility")
        batch_op.drop_column("owner_user_id")
