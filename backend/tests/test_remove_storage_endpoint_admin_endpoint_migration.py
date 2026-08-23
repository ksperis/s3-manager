# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from __future__ import annotations

from importlib import util
from pathlib import Path

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations


def _load_migration():
    path = (
        Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "0117_remove_storage_endpoint_admin_endpoint.py"
    )
    spec = util.spec_from_file_location(
        "migration_0117_remove_storage_endpoint_admin_endpoint",
        path,
    )
    assert spec and spec.loader
    migration = util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def test_migration_removes_redundant_admin_endpoint_column(monkeypatch):
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    endpoints = sa.Table(
        "storage_endpoints",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("admin_endpoint", sa.String()),
        sa.Column("features_config", sa.Text()),
    )
    metadata.create_all(engine)

    features_config = (
        "features:\n"
        "  admin:\n"
        "    enabled: true\n"
        "    endpoint: https://canonical-admin.example.test\n"
    )
    with engine.begin() as connection:
        connection.execute(
            endpoints.insert().values(
                id=1,
                admin_endpoint="https://obsolete-admin.example.test",
                features_config=features_config,
            )
        )
        migration = _load_migration()
        monkeypatch.setattr(
            migration,
            "op",
            Operations(MigrationContext.configure(connection)),
        )

        migration.upgrade()

        assert "admin_endpoint" not in {
            column["name"]
            for column in sa.inspect(connection).get_columns("storage_endpoints")
        }
        assert connection.execute(
            sa.text("SELECT features_config FROM storage_endpoints WHERE id = 1")
        ).scalar_one() == features_config

        migration.downgrade()

        assert "admin_endpoint" in {
            column["name"]
            for column in sa.inspect(connection).get_columns("storage_endpoints")
        }
