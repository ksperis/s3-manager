# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Persist Ceph Admin and Storage Ops bucket UI tag assignments.

Revision ID: 0113_persist_bucket_ui_tags
Revises: 0112_canonical_portal_sharing
Create Date: 2026-08-21
"""

from alembic import op
import sqlalchemy as sa


revision = "0113_persist_bucket_ui_tags"
down_revision = "0112_canonical_portal_sharing"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "bucket_ui_tag_assignments",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("storage_endpoint_id", sa.Integer(), nullable=False),
        sa.Column("tenant_key", sa.String(), server_default="", nullable=False),
        sa.Column("bucket_name", sa.String(), nullable=False),
        sa.Column("tag_definition_id", sa.Integer(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["storage_endpoint_id"],
            ["storage_endpoints.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["tag_definition_id"],
            ["tag_definitions.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "storage_endpoint_id",
            "tenant_key",
            "bucket_name",
            "tag_definition_id",
            name="uq_bucket_ui_tag_assignment",
        ),
    )
    op.create_index(
        "ix_bucket_ui_tag_assignments_bucket",
        "bucket_ui_tag_assignments",
        ["storage_endpoint_id", "tenant_key", "bucket_name"],
        unique=False,
    )
    op.create_index(
        "ix_bucket_ui_tag_assignments_definition",
        "bucket_ui_tag_assignments",
        ["tag_definition_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_bucket_ui_tag_assignments_definition",
        table_name="bucket_ui_tag_assignments",
    )
    op.drop_index(
        "ix_bucket_ui_tag_assignments_bucket",
        table_name="bucket_ui_tag_assignments",
    )
    op.drop_table("bucket_ui_tag_assignments")
