# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Canonicalize and constrain Storage Endpoint providers.

Revision ID: 0116_canonical_storage_endpoint_providers
Revises: 0115_canonical_storage_endpoint_features
Create Date: 2026-08-23
"""

from alembic import op
import sqlalchemy as sa


revision = "0116_canonical_storage_endpoint_providers"
down_revision = "0115_canonical_storage_endpoint_features"
branch_labels = None
depends_on = None


CANONICAL_PROVIDERS = ("ceph", "aws", "other")

storage_endpoints = sa.table(
    "storage_endpoints",
    sa.column("provider", sa.String()),
)


def upgrade() -> None:
    normalized_provider = sa.func.lower(sa.func.trim(storage_endpoints.c.provider))
    op.execute(
        storage_endpoints.update().values(
            provider=sa.case(
                (
                    normalized_provider.in_(CANONICAL_PROVIDERS),
                    normalized_provider,
                ),
                else_="ceph",
            )
        )
    )
    with op.batch_alter_table("storage_endpoints", schema=None) as batch_op:
        batch_op.create_check_constraint(
            "ck_storage_endpoints_provider",
            "provider IN ('ceph', 'aws', 'other')",
        )


def downgrade() -> None:
    with op.batch_alter_table("storage_endpoints", schema=None) as batch_op:
        batch_op.drop_constraint(
            "ck_storage_endpoints_provider",
            type_="check",
        )
