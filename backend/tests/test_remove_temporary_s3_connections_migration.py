# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from __future__ import annotations

from importlib import util
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations


OBSOLETE_COLUMNS = {
    "is_temporary",
    "temp_user_uid",
    "temp_access_key_id",
}


def _load_migration():
    migration_path = (
        Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "0106_remove_temporary_s3_connections.py"
    )
    spec = util.spec_from_file_location(
        "migration_0106_remove_temporary_s3_connections",
        migration_path,
    )
    assert spec and spec.loader
    migration = util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def _create_schema(engine):
    metadata = sa.MetaData()
    connections = sa.Table(
        "s3_connections",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("is_shared", sa.Boolean(), nullable=False, server_default=sa.text("0")),
        sa.Column("is_temporary", sa.Boolean(), nullable=False, server_default=sa.text("0")),
        sa.Column("temp_user_uid", sa.String(), nullable=True),
        sa.Column("temp_access_key_id", sa.String(), nullable=True),
    )
    metadata.create_all(engine)
    return connections


def _install_operations(monkeypatch, migration, connection) -> None:
    monkeypatch.setattr(
        migration,
        "op",
        Operations(MigrationContext.configure(connection)),
    )


def _column_names(connection) -> set[str]:
    return {
        str(column["name"])
        for column in sa.inspect(connection).get_columns("s3_connections")
    }


def test_migration_removes_empty_temporary_contract_and_downgrades(monkeypatch):
    engine = sa.create_engine("sqlite:///:memory:")
    connections = _create_schema(engine)

    with engine.begin() as connection:
        connection.execute(
            connections.insert().values(
                id=1,
                name="ordinary",
                is_shared=True,
                is_temporary=False,
            )
        )
        migration = _load_migration()
        _install_operations(monkeypatch, migration, connection)

        migration.upgrade()

        assert OBSOLETE_COLUMNS.isdisjoint(_column_names(connection))
        row = connection.execute(
            sa.text("SELECT id, name, is_shared FROM s3_connections")
        ).mappings().one()
        assert row == {"id": 1, "name": "ordinary", "is_shared": 1}

        migration.downgrade()

        assert OBSOLETE_COLUMNS <= _column_names(connection)
        connection.execute(
            sa.text(
                "INSERT INTO s3_connections (id, name, is_shared) "
                "VALUES (2, 'restored', 0)"
            )
        )
        restored = connection.execute(
            sa.text(
                "SELECT is_temporary, temp_user_uid, temp_access_key_id "
                "FROM s3_connections WHERE id = 2"
            )
        ).one()
        assert tuple(restored) == (0, None, None)


def test_migration_refuses_rows_that_require_remote_key_revocation(monkeypatch):
    engine = sa.create_engine("sqlite:///:memory:")
    connections = _create_schema(engine)

    with engine.begin() as connection:
        connection.execute(
            connections.insert().values(
                id=7,
                name="legacy-temporary",
                is_shared=False,
                is_temporary=True,
                temp_user_uid="temporary-user",
                temp_access_key_id="TEMP-AKID",
            )
        )
        migration = _load_migration()
        _install_operations(monkeypatch, migration, connection)

        with pytest.raises(RuntimeError, match="revoke each recorded remote RGW access key"):
            migration.upgrade()

        assert OBSOLETE_COLUMNS <= _column_names(connection)
        assert connection.execute(
            sa.text("SELECT COUNT(*) FROM s3_connections")
        ).scalar_one() == 1
