# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Require every persisted S3 account to reference a storage endpoint.

Revision ID: 0095_canonical_s3_account_endpoints
Revises: 0094_canonical_s3_user_endpoints
Create Date: 2026-08-02
"""

from alembic import op
import sqlalchemy as sa


revision = "0095_canonical_s3_account_endpoints"
down_revision = "0094_canonical_s3_user_endpoints"
branch_labels = None
depends_on = None


_storage_endpoints = sa.table(
    "storage_endpoints",
    sa.column("id", sa.Integer()),
    sa.column("provider", sa.String()),
    sa.column("is_default", sa.Boolean()),
)
_s3_accounts = sa.table(
    "s3_accounts",
    sa.column("id", sa.Integer()),
    sa.column("storage_endpoint_id", sa.Integer()),
)


def upgrade() -> None:
    bind = op.get_bind()
    detached_account_count = int(
        bind.execute(
            sa.select(sa.func.count())
            .select_from(_s3_accounts)
            .where(_s3_accounts.c.storage_endpoint_id.is_(None))
        ).scalar_one()
    )
    if detached_account_count:
        default_endpoint = bind.execute(
            sa.select(_storage_endpoints.c.id, _storage_endpoints.c.provider)
            .where(_storage_endpoints.c.is_default.is_(True))
            .order_by(_storage_endpoints.c.id.asc())
            .limit(1)
        ).first()
        if default_endpoint is None or str(default_endpoint.provider).strip().lower() != "ceph":
            raise RuntimeError(
                "Cannot migrate detached S3 accounts: configure a default Ceph storage endpoint before upgrading."
            )
        bind.execute(
            _s3_accounts.update()
            .where(_s3_accounts.c.storage_endpoint_id.is_(None))
            .values(storage_endpoint_id=int(default_endpoint.id))
        )

    with op.batch_alter_table("s3_accounts", schema=None) as batch_op:
        batch_op.alter_column(
            "storage_endpoint_id",
            existing_type=sa.Integer(),
            nullable=False,
        )


def downgrade() -> None:
    with op.batch_alter_table("s3_accounts", schema=None) as batch_op:
        batch_op.alter_column(
            "storage_endpoint_id",
            existing_type=sa.Integer(),
            nullable=True,
        )
