# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Add strong integrity check option for bucket migrations."""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0027_bucket_migration_strong_integrity_check"
down_revision = "0026_bucket_migration_same_endpoint_copy"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("bucket_migrations", schema=None) as batch_op:
        batch_op.add_column(sa.Column("strong_integrity_check", sa.Boolean(), nullable=False, server_default=sa.text("0")))


def downgrade() -> None:
    with op.batch_alter_table("bucket_migrations", schema=None) as batch_op:
        batch_op.drop_column("strong_integrity_check")
