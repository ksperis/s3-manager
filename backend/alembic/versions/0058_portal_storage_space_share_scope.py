# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Add Portal Storage Space share scopes."""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0058_portal_storage_space_share_scope"
down_revision = "0057_user_notifications"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("portal_storage_space_metadata", schema=None) as batch_op:
        batch_op.add_column(sa.Column("share_scope", sa.String(), nullable=False, server_default="restricted"))
        batch_op.add_column(sa.Column("account_member_role", sa.String(), nullable=True))
        batch_op.create_check_constraint(
            "ck_portal_storage_space_metadata_share_scope",
            "share_scope IN ('restricted', 'account')",
        )
        batch_op.create_check_constraint(
            "ck_portal_storage_space_metadata_account_member_role",
            "account_member_role IS NULL OR account_member_role IN ('Viewer', 'Editor')",
        )

    bind = op.get_bind()
    bind.execute(
        sa.text(
            """
            INSERT INTO portal_storage_space_grants (
                storage_space_metadata_id,
                user_id,
                role,
                created_by_user_id,
                created_at,
                updated_at
            )
            SELECT DISTINCT candidates.metadata_id, candidates.user_id, 'Owner', CAST(NULL AS INTEGER), CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
            FROM (
                SELECT metadata.id AS metadata_id, links.user_id AS user_id
                FROM portal_storage_space_metadata AS metadata
                JOIN user_s3_accounts AS links
                  ON links.account_id = metadata.account_id
                 AND links.account_role = 'portal_manager'
                WHERE metadata.visibility = 'shared'
                  AND (metadata.owner_user_id IS NULL OR metadata.owner_user_id != links.user_id)
                UNION
                SELECT metadata.id AS metadata_id, memberships.user_id AS user_id
                FROM portal_storage_space_metadata AS metadata
                JOIN ui_group_s3_accounts AS group_links
                  ON group_links.account_id = metadata.account_id
                 AND group_links.account_role = 'portal_manager'
                JOIN user_ui_groups AS memberships
                  ON memberships.group_id = group_links.group_id
                WHERE metadata.visibility = 'shared'
                  AND (metadata.owner_user_id IS NULL OR metadata.owner_user_id != memberships.user_id)
            ) AS candidates
            WHERE NOT EXISTS (
                SELECT 1
                FROM portal_storage_space_grants AS existing
                WHERE existing.storage_space_metadata_id = candidates.metadata_id
                  AND existing.user_id = candidates.user_id
            )
            """
        )
    )


def downgrade() -> None:
    with op.batch_alter_table("portal_storage_space_metadata", schema=None) as batch_op:
        batch_op.drop_constraint("ck_portal_storage_space_metadata_account_member_role", type_="check")
        batch_op.drop_constraint("ck_portal_storage_space_metadata_share_scope", type_="check")
        batch_op.drop_column("account_member_role")
        batch_op.drop_column("share_scope")
