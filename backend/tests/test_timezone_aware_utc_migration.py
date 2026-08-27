# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import importlib.util
from pathlib import Path
from types import ModuleType

import pytest

from app.db import Base
from app.db.utc_datetime import UTCDateTime


def _load_migration() -> ModuleType:
    migration_path = (
        Path(__file__).parents[1]
        / "alembic"
        / "versions"
        / "0074_timezone_aware_utc_timestamps.py"
    )
    spec = importlib.util.spec_from_file_location(
        "timezone_aware_utc_migration",
        migration_path,
    )
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


MIGRATION = _load_migration()

POST_MIGRATION_UTC_COLUMNS = {
    "bucket_ui_tag_assignments": ("created_at", "updated_at"),
    "oidc_authorization_codes": ("created_at", "expires_at"),
    "auth_challenges": ("created_at", "expires_at", "consumed_at"),
    "auth_rate_limits": ("window_started_at", "updated_at"),
    "auth_sessions": (
        "created_at",
        "last_activity_at",
        "idle_expires_at",
        "absolute_expires_at",
        "mfa_verified_at",
        "revoked_at",
    ),
    "external_identities": ("created_at", "last_login_at", "revoked_at"),
    "external_identity_link_requests": ("created_at", "expires_at", "decided_at"),
    "first_admin_bootstrap": ("issued_at", "expires_at", "consumed_at"),
    "recovery_codes": ("created_at", "consumed_at"),
    "refresh_tokens": ("created_at", "expires_at", "used_at", "revoked_at"),
    "webauthn_credentials": ("created_at", "last_used_at", "revoked_at"),
}


def test_migration_covers_every_utc_datetime_column_present_at_revision() -> None:
    model_columns = {
        table.name: tuple(
            column.name
            for column in table.columns
            if isinstance(column.type, UTCDateTime)
        )
        for table in Base.metadata.sorted_tables
        if any(isinstance(column.type, UTCDateTime) for column in table.columns)
    }

    expected_current_columns = {
        table_name: columns
        for table_name, columns in MIGRATION.UTC_COLUMNS.items()
        if table_name != "refresh_sessions"
    }
    expected_current_columns.update(POST_MIGRATION_UTC_COLUMNS)
    expected_current_columns["s3_sessions"] = (
        *expected_current_columns["s3_sessions"],
        "idle_expires_at",
        "absolute_expires_at",
        "revoked_at",
    )

    assert expected_current_columns == model_columns


def test_postgresql_migration_explicitly_interprets_existing_values_as_utc() -> None:
    statements = list(MIGRATION._postgresql_statements(timezone_aware=True))
    column_count = sum(len(columns) for columns in MIGRATION.UTC_COLUMNS.values())

    assert len(statements) == column_count
    assert all("TYPE TIMESTAMP WITH TIME ZONE" in statement for statement in statements)
    assert all("AT TIME ZONE 'UTC'" in statement for statement in statements)
    assert statements[0].startswith(
        'ALTER TABLE "account_iam_users" ALTER COLUMN "created_at"'
    )


def test_postgresql_downgrade_preserves_the_utc_wall_clock_value() -> None:
    statements = list(MIGRATION._postgresql_statements(timezone_aware=False))

    assert all(
        "TYPE TIMESTAMP WITHOUT TIME ZONE" in statement
        for statement in statements
    )
    assert all("AT TIME ZONE 'UTC'" in statement for statement in statements)


def test_migration_rejects_unmanaged_database_dialects() -> None:
    with pytest.raises(RuntimeError, match="Unsupported database dialect"):
        MIGRATION._require_supported_dialect("mysql")


@pytest.mark.parametrize(
    "migration_name",
    (
        "0107_auth_session_foundation.py",
        "0108_federation_mfa_rate_limits.py",
        "0109_authentication_cutover.py",
    ),
)
def test_authentication_migrations_create_timezone_aware_postgresql_columns(migration_name: str) -> None:
    source = (Path(__file__).parents[1] / "alembic" / "versions" / migration_name).read_text()

    assert "sa.DateTime()" not in source
    assert "sa.DateTime(timezone=True)" in source
