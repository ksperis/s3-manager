"""Add Ceph bucket replication endpoint metadata.

Revision ID: 0066_add_ceph_bucket_replication_endpoint_metadata
Revises: 0065_project_portal_settings_overrides
Create Date: 2026-07-05 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "0066_add_ceph_bucket_replication_endpoint_metadata"
down_revision = "0065_project_portal_settings_overrides"
branch_labels = None
depends_on = None


def _has_column(table_name: str, column_name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return any(column["name"] == column_name for column in inspector.get_columns(table_name))


def upgrade() -> None:
    with op.batch_alter_table("storage_endpoints", schema=None) as batch_op:
        if not _has_column("storage_endpoints", "ceph_zone_name"):
            batch_op.add_column(sa.Column("ceph_zone_name", sa.String(), nullable=True))
        if not _has_column("storage_endpoints", "ceph_bucket_replication_target_zones_json"):
            batch_op.add_column(
                sa.Column(
                    "ceph_bucket_replication_target_zones_json",
                    sa.Text(),
                    nullable=False,
                    server_default="[]",
                )
            )
        if not _has_column("storage_endpoints", "ceph_bucket_replication_owner_mode"):
            batch_op.add_column(
                sa.Column(
                    "ceph_bucket_replication_owner_mode",
                    sa.String(),
                    nullable=False,
                    server_default="rgw_user_only",
                )
            )


def downgrade() -> None:
    with op.batch_alter_table("storage_endpoints", schema=None) as batch_op:
        if _has_column("storage_endpoints", "ceph_bucket_replication_owner_mode"):
            batch_op.drop_column("ceph_bucket_replication_owner_mode")
        if _has_column("storage_endpoints", "ceph_bucket_replication_target_zones_json"):
            batch_op.drop_column("ceph_bucket_replication_target_zones_json")
        if _has_column("storage_endpoints", "ceph_zone_name"):
            batch_op.drop_column("ceph_zone_name")
