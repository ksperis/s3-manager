# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Convert persisted timestamps to timezone-aware UTC.

Revision ID: 0074_timezone_aware_utc_timestamps
Revises: 0073_canonical_connection_owner_types
Create Date: 2026-08-02 00:00:00.000000
"""

from collections.abc import Iterable

from alembic import op
import sqlalchemy as sa


revision = "0074_timezone_aware_utc_timestamps"
down_revision = "0073_canonical_connection_owner_types"
branch_labels = None
depends_on = None


UTC_COLUMNS: dict[str, tuple[str, ...]] = {
    "account_iam_users": ("created_at",),
    "api_tokens": ("created_at", "last_used_at", "expires_at", "revoked_at"),
    "app_settings": ("created_at", "updated_at"),
    "audit_logs": ("created_at",),
    "backend_operation_leases": ("lease_until", "acquired_at", "updated_at"),
    "billing_assignments": ("created_at",),
    "billing_rate_cards": ("created_at", "updated_at"),
    "billing_storage_daily": ("collected_at",),
    "billing_usage_daily": ("collected_at",),
    "bucket_migration_events": ("created_at",),
    "bucket_migration_items": ("started_at", "finished_at", "created_at", "updated_at"),
    "bucket_migrations": (
        "worker_lease_until",
        "precheck_checked_at",
        "started_at",
        "finished_at",
        "last_heartbeat_at",
        "created_at",
        "updated_at",
    ),
    "bucket_usage_stats_snapshots": ("calculated_at", "created_at", "updated_at"),
    "endpoint_health_checks": ("checked_at",),
    "endpoint_health_latest": ("checked_at", "updated_at"),
    "endpoint_health_rollups": ("bucket_start", "updated_at"),
    "endpoint_health_status_segments": ("started_at", "ended_at", "updated_at"),
    "ldap_providers": ("created_at", "updated_at"),
    "managed_private_accesses": ("created_at", "updated_at"),
    "oidc_login_states": ("created_at",),
    "oidc_providers": ("created_at", "updated_at"),
    "portal_admin_request_messages": ("created_at",),
    "portal_admin_requests": ("decided_at", "created_at", "updated_at"),
    "portal_external_access_credentials": ("revoked_at", "created_at", "updated_at"),
    "portal_public_links": ("expires_at", "revoked_at", "created_at"),
    "portal_storage_space_grants": ("created_at", "updated_at"),
    "portal_storage_space_metadata": (
        "icon_updated_at",
        "archived_at",
        "created_at",
        "updated_at",
    ),
    "quota_alert_states": (
        "last_checked_at",
        "last_notified_at",
        "created_at",
        "updated_at",
    ),
    "quota_usage_daily": ("updated_at",),
    "quota_usage_hourly": ("hour_ts", "collected_at"),
    "refresh_sessions": ("created_at", "last_used_at", "expires_at", "revoked_at"),
    "s3_account_tags": ("created_at", "updated_at"),
    "s3_accounts": ("created_at", "updated_at"),
    "s3_connection_tags": ("created_at", "updated_at"),
    "s3_connections": ("expires_at", "created_at", "updated_at", "last_used_at"),
    "s3_sessions": ("created_at", "last_used_at"),
    "s3_user_tags": ("created_at", "updated_at"),
    "s3_users": ("created_at", "updated_at"),
    "storage_endpoint_tags": ("created_at", "updated_at"),
    "storage_endpoints": ("created_at", "updated_at"),
    "tag_definitions": ("created_at", "updated_at"),
    "ui_group_s3_accounts": ("created_at", "updated_at"),
    "ui_group_s3_connections": ("created_at", "updated_at"),
    "ui_groups": ("avatar_updated_at", "created_at", "updated_at"),
    "user_notifications": ("created_at", "read_at"),
    "user_s3_accounts": ("created_at", "updated_at"),
    "user_s3_connections": ("created_at", "updated_at"),
    "user_ui_groups": ("created_at",),
    "users": ("avatar_updated_at", "created_at", "updated_at", "last_login_at"),
}


def _quoted(identifier: str) -> str:
    return '"' + identifier.replace('"', '""') + '"'


def _postgresql_statements(*, timezone_aware: bool) -> Iterable[str]:
    target = "TIMESTAMP WITH TIME ZONE" if timezone_aware else "TIMESTAMP WITHOUT TIME ZONE"
    for table_name, column_names in UTC_COLUMNS.items():
        for column_name in column_names:
            table = _quoted(table_name)
            column = _quoted(column_name)
            yield (
                f"ALTER TABLE {table} ALTER COLUMN {column} TYPE {target} "
                f"USING {column} AT TIME ZONE 'UTC'"
            )


def _require_supported_dialect(dialect: str) -> None:
    if dialect not in {"postgresql", "sqlite"}:
        raise RuntimeError(f"Unsupported database dialect for UTC migration: {dialect}")


def upgrade() -> None:
    dialect = op.get_bind().dialect.name
    _require_supported_dialect(dialect)
    if dialect == "postgresql":
        for statement in _postgresql_statements(timezone_aware=True):
            op.execute(sa.text(statement))


def downgrade() -> None:
    dialect = op.get_bind().dialect.name
    _require_supported_dialect(dialect)
    if dialect == "postgresql":
        for statement in _postgresql_statements(timezone_aware=False):
            op.execute(sa.text(statement))
