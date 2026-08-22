# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Scale persistent bucket UI tag lookups.

Revision ID: 0114_scale_bucket_ui_tags
Revises: 0113_persist_bucket_ui_tags
Create Date: 2026-08-22
"""

from alembic import op


revision = "0114_scale_bucket_ui_tags"
down_revision = "0113_persist_bucket_ui_tags"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_index(
        "ix_bucket_ui_tag_assignments_definition",
        table_name="bucket_ui_tag_assignments",
    )
    op.create_index(
        "ix_bucket_ui_tag_assignments_definition_endpoint",
        "bucket_ui_tag_assignments",
        ["tag_definition_id", "storage_endpoint_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_bucket_ui_tag_assignments_definition_endpoint",
        table_name="bucket_ui_tag_assignments",
    )
    op.create_index(
        "ix_bucket_ui_tag_assignments_definition",
        "bucket_ui_tag_assignments",
        ["tag_definition_id"],
        unique=False,
    )
