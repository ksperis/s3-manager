# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Add latitude and longitude to storage endpoints."""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0042_add_latitude_longitude_to_storage_endpoints"
down_revision = "0041_portal_storage_workspace_integration"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("storage_endpoints", schema=None) as batch_op:
        batch_op.add_column(sa.Column("latitude", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("longitude", sa.String(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("storage_endpoints", schema=None) as batch_op:
        batch_op.drop_column("latitude")
        batch_op.drop_column("longitude")
