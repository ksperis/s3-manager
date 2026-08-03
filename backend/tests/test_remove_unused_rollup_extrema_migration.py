# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from __future__ import annotations

from importlib import util
from pathlib import Path

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations


REMOVED_COLUMNS = {"latency_min_ms", "latency_max_ms"}


def _load_migration():
    migration_path = (
        Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "0097_remove_unused_rollup_extrema.py"
    )
    spec = util.spec_from_file_location(
        "migration_0097_remove_unused_rollup_extrema",
        migration_path,
    )
    assert spec and spec.loader
    migration = util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def _column_names(connection) -> set[str]:
    return {
        column["name"]
        for column in sa.inspect(connection).get_columns("endpoint_health_rollups")
    }


def test_migration_removes_and_restores_unused_rollup_extrema(monkeypatch):
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    rollups = sa.Table(
        "endpoint_health_rollups",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("latency_min_ms", sa.Integer(), nullable=True),
        sa.Column("latency_avg_ms", sa.Integer(), nullable=True),
        sa.Column("latency_max_ms", sa.Integer(), nullable=True),
        sa.Column("latency_p95_ms", sa.Integer(), nullable=True),
    )
    metadata.create_all(engine)

    with engine.begin() as connection:
        connection.execute(
            rollups.insert().values(
                id=1,
                latency_min_ms=10,
                latency_avg_ms=20,
                latency_max_ms=30,
                latency_p95_ms=28,
            )
        )

        migration = _load_migration()
        monkeypatch.setattr(
            migration,
            "op",
            Operations(MigrationContext.configure(connection)),
        )

        migration.upgrade()

        assert REMOVED_COLUMNS.isdisjoint(_column_names(connection))
        row = connection.execute(
            sa.text(
                "SELECT id, latency_avg_ms, latency_p95_ms "
                "FROM endpoint_health_rollups"
            )
        ).one()
        assert tuple(row) == (1, 20, 28)

        migration.downgrade()

        assert REMOVED_COLUMNS <= _column_names(connection)
        row = connection.execute(
            sa.text(
                "SELECT latency_min_ms, latency_max_ms "
                "FROM endpoint_health_rollups"
            )
        ).one()
        assert tuple(row) == (None, None)
