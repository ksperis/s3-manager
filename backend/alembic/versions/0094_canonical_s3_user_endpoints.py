# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Require every persisted S3 user to reference a storage endpoint.

Revision ID: 0094_canonical_s3_user_endpoints
Revises: 0093_remove_dead_portal_key_setting
Create Date: 2026-08-02
"""

from alembic import op
import sqlalchemy as sa


revision = "0094_canonical_s3_user_endpoints"
down_revision = "0093_remove_dead_portal_key_setting"
branch_labels = None
depends_on = None


_storage_endpoints = sa.table(
    "storage_endpoints",
    sa.column("id", sa.Integer()),
    sa.column("provider", sa.String()),
    sa.column("is_default", sa.Boolean()),
)
_s3_users = sa.table(
    "s3_users",
    sa.column("id", sa.Integer()),
    sa.column("storage_endpoint_id", sa.Integer()),
)


def upgrade() -> None:
    bind = op.get_bind()
    detached_user_count = int(
        bind.execute(
            sa.select(sa.func.count()).select_from(_s3_users).where(_s3_users.c.storage_endpoint_id.is_(None))
        ).scalar_one()
    )
    if detached_user_count:
        default_endpoint = bind.execute(
            sa.select(_storage_endpoints.c.id, _storage_endpoints.c.provider)
            .where(_storage_endpoints.c.is_default.is_(True))
            .order_by(_storage_endpoints.c.id.asc())
            .limit(1)
        ).first()
        if default_endpoint is None or str(default_endpoint.provider).strip().lower() != "ceph":
            raise RuntimeError(
                "Cannot migrate detached S3 users: configure a default Ceph storage endpoint before upgrading."
            )
        bind.execute(
            _s3_users.update()
            .where(_s3_users.c.storage_endpoint_id.is_(None))
            .values(storage_endpoint_id=int(default_endpoint.id))
        )

    with op.batch_alter_table("s3_users", schema=None) as batch_op:
        batch_op.alter_column(
            "storage_endpoint_id",
            existing_type=sa.Integer(),
            nullable=False,
        )


def downgrade() -> None:
    with op.batch_alter_table("s3_users", schema=None) as batch_op:
        batch_op.alter_column(
            "storage_endpoint_id",
            existing_type=sa.Integer(),
            nullable=True,
        )
