# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Add webhook URL field for bucket migrations."""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0023_bucket_migration_webhook"
down_revision = "0022_bucket_migration_target_lock"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("bucket_migrations", schema=None) as batch_op:
        batch_op.add_column(sa.Column("webhook_url", sa.String(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("bucket_migrations", schema=None) as batch_op:
        batch_op.drop_column("webhook_url")
