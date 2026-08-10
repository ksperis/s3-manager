# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from importlib import util
from pathlib import Path

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations


TABLES = (
    "user_s3_accounts",
    "ui_group_s3_accounts",
    "user_s3_users",
    "ui_group_s3_users",
)


def _load_migration():
    path = (
        Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "0103_manager_browser_data_access.py"
    )
    spec = util.spec_from_file_location("migration_0103_manager_browser_data_access", path)
    assert spec and spec.loader
    migration = util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def _create_legacy_schema(engine) -> None:
    metadata = sa.MetaData()
    for table_name in TABLES:
        sa.Table(
            table_name,
            metadata,
            sa.Column("id", sa.Integer(), primary_key=True),
        )
    metadata.create_all(engine)


def test_manager_browser_permission_migration_is_secure_and_reversible(monkeypatch):
    engine = sa.create_engine("sqlite:///:memory:")
    _create_legacy_schema(engine)
    migration = _load_migration()

    with engine.begin() as connection:
        for table_name in TABLES:
            connection.execute(sa.text(f"INSERT INTO {table_name} (id) VALUES (1)"))
        monkeypatch.setattr(
            migration,
            "op",
            Operations(MigrationContext.configure(connection)),
        )
        migration.upgrade()

        inspector = sa.inspect(connection)
        for table_name in TABLES:
            columns = {column["name"]: column for column in inspector.get_columns(table_name)}
            permission = columns["allow_manager_browser_data_access"]
            assert permission["nullable"] is False
            assert connection.execute(
                sa.text(
                    f"SELECT allow_manager_browser_data_access FROM {table_name} WHERE id = 1"
                )
            ).scalar_one() == 0
            connection.execute(sa.text(f"INSERT INTO {table_name} (id) VALUES (2)"))
            assert connection.execute(
                sa.text(
                    f"SELECT allow_manager_browser_data_access FROM {table_name} WHERE id = 2"
                )
            ).scalar_one() == 0

        migration.downgrade()
        inspector = sa.inspect(connection)
        for table_name in TABLES:
            assert "allow_manager_browser_data_access" not in {
                column["name"] for column in inspector.get_columns(table_name)
            }
