# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Add target write-lock fields for bucket migrations."""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0022_bucket_migration_target_lock"
down_revision = "0021_bucket_migration_worker_lease"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("bucket_migrations", schema=None) as batch_op:
        batch_op.add_column(sa.Column("lock_target_writes", sa.Boolean(), nullable=False, server_default="1"))

    with op.batch_alter_table("bucket_migration_items", schema=None) as batch_op:
        batch_op.add_column(sa.Column("target_lock_applied", sa.Boolean(), nullable=False, server_default="0"))
        batch_op.add_column(sa.Column("target_policy_backup_json", sa.Text(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("bucket_migration_items", schema=None) as batch_op:
        batch_op.drop_column("target_policy_backup_json")
        batch_op.drop_column("target_lock_applied")

    with op.batch_alter_table("bucket_migrations", schema=None) as batch_op:
        batch_op.drop_column("lock_target_writes")
