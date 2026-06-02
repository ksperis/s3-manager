# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Add Portal Storage Workspace metadata and public links."""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0041_portal_storage_workspace_integration"
down_revision = "0040_restore_portal_feature"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "portal_storage_space_metadata",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("account_id", sa.Integer(), nullable=False),
        sa.Column("bucket_name", sa.String(), nullable=False),
        sa.Column("display_name", sa.String(), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("owner_label", sa.String(), nullable=True),
        sa.Column("space_type", sa.String(), nullable=True),
        sa.Column("project_key", sa.String(), nullable=True),
        sa.Column("dataset_label", sa.String(), nullable=True),
        sa.Column("archived_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["account_id"], ["s3_accounts.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("account_id", "bucket_name", name="uq_portal_storage_space_metadata_account_bucket"),
    )
    with op.batch_alter_table("portal_storage_space_metadata", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_portal_storage_space_metadata_account"), ["account_id"], unique=False)
        batch_op.create_index(batch_op.f("ix_portal_storage_space_metadata_id"), ["id"], unique=False)

    op.create_table(
        "portal_public_links",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("token", sa.String(), nullable=False),
        sa.Column("account_id", sa.Integer(), nullable=False),
        sa.Column("bucket_name", sa.String(), nullable=False),
        sa.Column("object_key", sa.Text(), nullable=False),
        sa.Column("label", sa.String(), nullable=True),
        sa.Column("created_by_user_id", sa.Integer(), nullable=True),
        sa.Column("created_by_email", sa.String(), nullable=True),
        sa.Column("expires_at", sa.DateTime(), nullable=True),
        sa.Column("revoked_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["account_id"], ["s3_accounts.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token", name="uq_portal_public_links_token"),
    )
    with op.batch_alter_table("portal_public_links", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_portal_public_links_account_bucket"), ["account_id", "bucket_name"], unique=False)
        batch_op.create_index(batch_op.f("ix_portal_public_links_expires"), ["expires_at"], unique=False)
        batch_op.create_index(batch_op.f("ix_portal_public_links_id"), ["id"], unique=False)


def downgrade() -> None:
    op.drop_table("portal_public_links")
    op.drop_table("portal_storage_space_metadata")
