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


def test_migration_covers_every_utc_datetime_column() -> None:
    model_columns = {
        table.name: tuple(
            column.name
            for column in table.columns
            if isinstance(column.type, UTCDateTime)
        )
        for table in Base.metadata.sorted_tables
        if any(isinstance(column.type, UTCDateTime) for column in table.columns)
    }

    assert MIGRATION.UTC_COLUMNS == model_columns


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
