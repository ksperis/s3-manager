# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""add dedicated ceph-admin credentials on storage endpoints

Revision ID: 0007_storage_endpoint_ceph_admin_credentials
Revises: 0006_user_ceph_admin_access
Create Date: 2026-02-09 14:30:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

from app.core.security import EncryptedString


revision = "0007_storage_endpoint_ceph_admin_credentials"
down_revision = "0006_user_ceph_admin_access"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("storage_endpoints", schema=None) as batch_op:
        batch_op.add_column(sa.Column("ceph_admin_access_key", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("ceph_admin_secret_key", EncryptedString(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("storage_endpoints", schema=None) as batch_op:
        batch_op.drop_column("ceph_admin_secret_key")
        batch_op.drop_column("ceph_admin_access_key")
