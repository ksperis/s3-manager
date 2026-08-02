"""Purge data-plane and operational-noise audit logs.

Revision ID: 0091_purge_data_plane_audit_logs
Revises: 0090_canonical_bucket_migration_json
Create Date: 2026-08-02
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0091_purge_data_plane_audit_logs"
down_revision = "0090_canonical_bucket_migration_json"
branch_labels = None
depends_on = None


# Keep this migration self-contained: historical migrations must not import
# runtime application modules that may change after deployment.
PURGED_ACTIONS = (
    "upload_object",
    "upload_via_proxy",
    "download_object",
    "delete_object",
    "delete_objects",
    "copy_object",
    "create_folder",
    "update_object_metadata",
    "put_object_tags",
    "put_object_acl",
    "put_object_legal_hold",
    "put_object_retention",
    "multipart_init",
    "multipart_complete",
    "multipart_abort",
    "restore_object",
    "restore_object_version",
    "restore_deleted_object",
    "cleanup_object_versions",
    "calculate_bucket_usage_stats",
    "collect_usage_history",
    "billing.collect_daily",
    "healthchecks.run",
    "ceph_admin.bucket.index_check",
    "refresh_access_token",
    "start_oidc_login",
)


def upgrade() -> None:
    audit_logs = sa.table("audit_logs", sa.column("action", sa.String()))
    op.execute(audit_logs.delete().where(audit_logs.c.action.in_(PURGED_ACTIONS)))


def downgrade() -> None:
    raise RuntimeError(
        "Downgrade is not supported: migration 0091 irreversibly deletes audit rows. "
        "Restore a database backup if those rows are required."
    )
