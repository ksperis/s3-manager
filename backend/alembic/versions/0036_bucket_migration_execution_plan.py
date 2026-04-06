# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Add structured execution plan storage for bucket migration items."""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0036_bucket_migration_execution_plan"
down_revision = "0035_tag_definition_scope"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("bucket_migration_items", schema=None) as batch_op:
        batch_op.add_column(sa.Column("source_snapshot_json", sa.Text(), nullable=True))
        batch_op.add_column(sa.Column("target_snapshot_json", sa.Text(), nullable=True))
        batch_op.add_column(sa.Column("execution_plan_json", sa.Text(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("bucket_migration_items", schema=None) as batch_op:
        batch_op.drop_column("execution_plan_json")
        batch_op.drop_column("target_snapshot_json")
        batch_op.drop_column("source_snapshot_json")
