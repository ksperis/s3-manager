# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Remove the redundant Storage Endpoint admin endpoint column.

Revision ID: 0117_remove_storage_endpoint_admin_endpoint
Revises: 0116_canonical_storage_endpoint_providers
Create Date: 2026-08-23
"""

from alembic import op
import sqlalchemy as sa


revision = "0117_remove_storage_endpoint_admin_endpoint"
down_revision = "0116_canonical_storage_endpoint_providers"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("storage_endpoints", schema=None) as batch_op:
        batch_op.drop_column("admin_endpoint")


def downgrade() -> None:
    with op.batch_alter_table("storage_endpoints", schema=None) as batch_op:
        batch_op.add_column(sa.Column("admin_endpoint", sa.String(), nullable=True))
