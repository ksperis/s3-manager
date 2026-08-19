# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from __future__ import annotations

from importlib import util
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations


def _load_migration():
    migration_path = (
        Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "0105_reconcile_schema_drift.py"
    )
    spec = util.spec_from_file_location(
        "migration_0105_reconcile_schema_drift",
        migration_path,
    )
    assert spec and spec.loader
    migration = util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def _create_schema(
    engine,
    *,
    coordinate_type: sa.types.TypeEngine,
    include_obsolete_permissions: bool,
):
    metadata = sa.MetaData()
    storage_endpoints = sa.Table(
        "storage_endpoints",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("latitude", coordinate_type, nullable=True),
        sa.Column("longitude", coordinate_type, nullable=True),
    )
    user_columns = [sa.Column("id", sa.Integer(), primary_key=True)]
    group_columns = [sa.Column("id", sa.Integer(), primary_key=True)]
    if include_obsolete_permissions:
        user_columns.append(
            sa.Column(
                "can_access_manager_bucket_usage_stats",
                sa.Boolean(),
                nullable=False,
                server_default=sa.text("0"),
            )
        )
        group_columns.append(
            sa.Column(
                "can_access_manager_bucket_usage_stats",
                sa.Boolean(),
                nullable=False,
                server_default=sa.text("0"),
            )
        )
    users = sa.Table("users", metadata, *user_columns)
    ui_groups = sa.Table("ui_groups", metadata, *group_columns)
    metadata.create_all(engine)
    return storage_endpoints, users, ui_groups


def _install_operations(monkeypatch, migration, connection) -> None:
    monkeypatch.setattr(
        migration,
        "op",
        Operations(MigrationContext.configure(connection)),
    )


def _column_map(connection, table_name: str) -> dict[str, dict]:
    return {
        column["name"]: column
        for column in sa.inspect(connection).get_columns(table_name)
    }


def test_migration_reconciles_legacy_schema_and_downgrades(monkeypatch):
    monkeypatch.setenv("BUCKETREEF_DB_BACKUP_VERIFIED", "true")
    engine = sa.create_engine("sqlite:///:memory:")
    storage_endpoints, users, ui_groups = _create_schema(
        engine,
        coordinate_type=sa.String(),
        include_obsolete_permissions=True,
    )

    with engine.begin() as connection:
        connection.execute(
            storage_endpoints.insert(),
            [
                {
                    "id": 1,
                    "name": "Paris",
                    "latitude": "48.8566",
                    "longitude": "2.3522",
                },
                {
                    "id": 2,
                    "name": "Unset",
                    "latitude": "  ",
                    "longitude": None,
                },
            ],
        )
        connection.execute(
            users.insert().values(
                id=1,
                can_access_manager_bucket_usage_stats=True,
            )
        )
        connection.execute(ui_groups.insert().values(id=1))
        migration = _load_migration()
        _install_operations(monkeypatch, migration, connection)

        migration.upgrade()

        endpoint_columns = _column_map(connection, "storage_endpoints")
        assert isinstance(endpoint_columns["latitude"]["type"], sa.Float)
        assert isinstance(endpoint_columns["longitude"]["type"], sa.Float)
        assert "can_access_manager_bucket_usage_stats" not in _column_map(
            connection,
            "users",
        )
        assert "can_access_manager_bucket_usage_stats" not in _column_map(
            connection,
            "ui_groups",
        )
        rows = connection.execute(
            sa.text(
                "SELECT id, latitude, longitude "
                "FROM storage_endpoints ORDER BY id"
            )
        ).mappings().all()
        assert rows == [
            {"id": 1, "latitude": 48.8566, "longitude": 2.3522},
            {"id": 2, "latitude": None, "longitude": None},
        ]

        migration.downgrade()

        endpoint_columns = _column_map(connection, "storage_endpoints")
        assert isinstance(endpoint_columns["latitude"]["type"], sa.String)
        assert isinstance(endpoint_columns["longitude"]["type"], sa.String)
        assert "can_access_manager_bucket_usage_stats" in _column_map(
            connection,
            "users",
        )
        assert "can_access_manager_bucket_usage_stats" in _column_map(
            connection,
            "ui_groups",
        )
        connection.execute(sa.text("INSERT INTO users (id) VALUES (2)"))
        restored_default = connection.execute(
            sa.text(
                "SELECT can_access_manager_bucket_usage_stats "
                "FROM users WHERE id = 2"
            )
        ).scalar_one()
        assert restored_default == 0


def test_migration_requires_backup_before_dropping_orphan_columns(monkeypatch):
    monkeypatch.delenv("BUCKETREEF_DB_BACKUP_VERIFIED", raising=False)
    engine = sa.create_engine("sqlite:///:memory:")
    storage_endpoints, _, _ = _create_schema(
        engine,
        coordinate_type=sa.String(),
        include_obsolete_permissions=True,
    )

    with engine.begin() as connection:
        connection.execute(
            storage_endpoints.insert().values(
                id=1,
                name="Legacy",
                latitude="48.8566",
                longitude="2.3522",
            )
        )
        migration = _load_migration()
        _install_operations(monkeypatch, migration, connection)

        with pytest.raises(RuntimeError, match="BUCKETREEF_DB_BACKUP_VERIFIED=true"):
            migration.upgrade()

        assert "can_access_manager_bucket_usage_stats" in _column_map(
            connection,
            "users",
        )
        assert isinstance(
            _column_map(connection, "storage_endpoints")["latitude"]["type"],
            sa.String,
        )


def test_migration_is_noop_for_already_canonical_schema(monkeypatch):
    engine = sa.create_engine("sqlite:///:memory:")
    storage_endpoints, _, _ = _create_schema(
        engine,
        coordinate_type=sa.Float(),
        include_obsolete_permissions=False,
    )

    with engine.begin() as connection:
        connection.execute(
            storage_endpoints.insert().values(
                id=1,
                name="Canonical",
                latitude=43.6047,
                longitude=1.4442,
            )
        )
        migration = _load_migration()
        _install_operations(monkeypatch, migration, connection)

        migration.upgrade()

        columns = _column_map(connection, "storage_endpoints")
        assert isinstance(columns["latitude"]["type"], sa.Float)
        assert isinstance(columns["longitude"]["type"], sa.Float)


@pytest.mark.parametrize(
    ("latitude", "longitude"),
    [
        ("north", "2.3522"),
        ("91", "2.3522"),
        ("48.8566", "-181"),
        ("nan", "2.3522"),
    ],
)
def test_migration_rejects_invalid_coordinates(
    monkeypatch,
    latitude,
    longitude,
):
    engine = sa.create_engine("sqlite:///:memory:")
    storage_endpoints, _, _ = _create_schema(
        engine,
        coordinate_type=sa.String(),
        include_obsolete_permissions=False,
    )

    with engine.begin() as connection:
        connection.execute(
            storage_endpoints.insert().values(
                id=7,
                name="Invalid",
                latitude=latitude,
                longitude=longitude,
            )
        )
        migration = _load_migration()
        _install_operations(monkeypatch, migration, connection)

        with pytest.raises(RuntimeError, match="Repair latitude/longitude"):
            migration.upgrade()
