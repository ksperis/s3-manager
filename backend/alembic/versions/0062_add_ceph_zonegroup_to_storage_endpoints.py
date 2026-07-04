"""Add Ceph zonegroup metadata to storage endpoints.

Revision ID: 0062_add_ceph_zonegroup_to_storage_endpoints
Revises: 0061_operational_foreign_key_indexes
Create Date: 2026-07-04 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "0062_add_ceph_zonegroup_to_storage_endpoints"
down_revision = "0061_operational_foreign_key_indexes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("storage_endpoints", schema=None) as batch_op:
        batch_op.add_column(sa.Column("ceph_zonegroup_name", sa.String(), nullable=True))
        batch_op.add_column(
            sa.Column(
                "ceph_zonegroup_global_replication_configured",
                sa.Boolean(),
                nullable=False,
                server_default="0",
            )
        )
        batch_op.add_column(
            sa.Column(
                "ceph_zonegroup_bucket_replication_allowed",
                sa.Boolean(),
                nullable=False,
                server_default="0",
            )
        )


def downgrade() -> None:
    with op.batch_alter_table("storage_endpoints", schema=None) as batch_op:
        batch_op.drop_column("ceph_zonegroup_bucket_replication_allowed")
        batch_op.drop_column("ceph_zonegroup_global_replication_configured")
        batch_op.drop_column("ceph_zonegroup_name")
