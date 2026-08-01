# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from importlib import util
from pathlib import Path

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations


def _load_migration():
    path = Path(__file__).resolve().parents[1] / "alembic" / "versions" / "0070_managed_private_access.py"
    spec = util.spec_from_file_location("migration_0070_managed_private_access", path)
    assert spec is not None and spec.loader is not None
    migration = util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def test_managed_private_access_migration_upgrade_and_downgrade(monkeypatch):
    engine = sa.create_engine("sqlite:///:memory:")
    with engine.begin() as connection:
        metadata = sa.MetaData()
        sa.Table("users", metadata, sa.Column("id", sa.Integer(), primary_key=True))
        sa.Table(
            "s3_connections",
            metadata,
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("name", sa.String(), nullable=False),
        )
        metadata.create_all(connection)
        migration = _load_migration()
        monkeypatch.setattr(migration, "op", Operations(MigrationContext.configure(connection)))

        migration.upgrade()

        connection_columns = {
            column["name"] for column in sa.inspect(connection).get_columns("s3_connections")
        }
        assert "server_managed" in connection_columns
        assert "managed_private_accesses" in sa.inspect(connection).get_table_names()
        indexes = {
            index["name"] for index in sa.inspect(connection).get_indexes("managed_private_accesses")
        }
        assert "uq_managed_private_access_active_source" in indexes

        migration.downgrade()

        connection_columns = {
            column["name"] for column in sa.inspect(connection).get_columns("s3_connections")
        }
        assert "server_managed" not in connection_columns
        assert "managed_private_accesses" not in sa.inspect(connection).get_table_names()
