# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Add verify_tls flag on storage endpoints."""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0025_storage_endpoint_verify_tls"
down_revision = "0024_bucket_migration_auto_grant_source_read"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("storage_endpoints", schema=None) as batch_op:
        batch_op.add_column(sa.Column("verify_tls", sa.Boolean(), nullable=False, server_default=sa.text("1")))


def downgrade() -> None:
    with op.batch_alter_table("storage_endpoints", schema=None) as batch_op:
        batch_op.drop_column("verify_tls")
