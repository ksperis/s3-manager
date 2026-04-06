# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Add version-aware replication state storage for bucket migration items."""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0037_bucket_migration_replication_state"
down_revision = "0036_bucket_migration_execution_plan"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("bucket_migration_items", schema=None) as batch_op:
        batch_op.add_column(sa.Column("replication_state_json", sa.Text(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("bucket_migration_items", schema=None) as batch_op:
        batch_op.drop_column("replication_state_json")
