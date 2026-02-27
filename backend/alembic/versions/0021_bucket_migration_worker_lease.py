# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Add worker lease columns for distributed bucket migration locking."""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0021_bucket_migration_worker_lease"
down_revision = "0020_bucket_migrations_precheck"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("bucket_migrations", schema=None) as batch_op:
        batch_op.add_column(sa.Column("worker_lease_owner", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("worker_lease_until", sa.DateTime(), nullable=True))
        batch_op.create_index(batch_op.f("ix_bucket_migrations_worker_lease_owner"), ["worker_lease_owner"], unique=False)
        batch_op.create_index(batch_op.f("ix_bucket_migrations_worker_lease_until"), ["worker_lease_until"], unique=False)
        batch_op.create_index("ix_bucket_migrations_worker_lease", ["worker_lease_until", "status"], unique=False)


def downgrade() -> None:
    with op.batch_alter_table("bucket_migrations", schema=None) as batch_op:
        batch_op.drop_index("ix_bucket_migrations_worker_lease")
        batch_op.drop_index(batch_op.f("ix_bucket_migrations_worker_lease_until"))
        batch_op.drop_index(batch_op.f("ix_bucket_migrations_worker_lease_owner"))
        batch_op.drop_column("worker_lease_until")
        batch_op.drop_column("worker_lease_owner")
