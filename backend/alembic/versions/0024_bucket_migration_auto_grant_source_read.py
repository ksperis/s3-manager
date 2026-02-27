# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Add auto-grant source read option for bucket migrations."""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0024_bucket_migration_auto_grant_source_read"
down_revision = "0023_bucket_migration_webhook"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("bucket_migrations", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("auto_grant_source_read_for_copy", sa.Boolean(), nullable=False, server_default=sa.text("0"))
        )


def downgrade() -> None:
    with op.batch_alter_table("bucket_migrations", schema=None) as batch_op:
        batch_op.drop_column("auto_grant_source_read_for_copy")
