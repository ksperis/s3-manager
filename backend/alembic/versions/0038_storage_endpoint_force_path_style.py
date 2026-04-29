# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Add force path style flag on storage endpoints."""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0038_storage_endpoint_force_path_style"
down_revision = "0037_bucket_migration_replication_state"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("storage_endpoints", schema=None) as batch_op:
        batch_op.add_column(sa.Column("force_path_style", sa.Boolean(), nullable=False, server_default=sa.text("0")))


def downgrade() -> None:
    with op.batch_alter_table("storage_endpoints", schema=None) as batch_op:
        batch_op.drop_column("force_path_style")
