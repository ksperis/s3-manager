# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Enforce non-null capabilities_json for s3 connections."""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0017_s3_connection_capabilities_json_not_null"
down_revision = "0016_cleanup_legacy_capability_columns"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    bind.execute(sa.text("UPDATE s3_connections SET capabilities_json = '{}' WHERE capabilities_json IS NULL"))
    with op.batch_alter_table("s3_connections", schema=None) as batch_op:
        batch_op.alter_column(
            "capabilities_json",
            existing_type=sa.Text(),
            nullable=False,
            server_default="{}",
        )


def downgrade() -> None:
    with op.batch_alter_table("s3_connections", schema=None) as batch_op:
        batch_op.alter_column(
            "capabilities_json",
            existing_type=sa.Text(),
            nullable=True,
            server_default=None,
        )

