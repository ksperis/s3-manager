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
        / "0123_canonical_ui_user_full_name.py"
    )
    spec = util.spec_from_file_location(
        "migration_0123_canonical_ui_user_full_name",
        path,
    )
    assert spec and spec.loader
    migration = util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def _install_migration(connection):
    migration = _load_migration()
    migration.op = Operations(MigrationContext.configure(connection))
    return migration


def test_migration_backfills_missing_full_names_and_removes_duplicate_column():
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    users = sa.Table(
        "users",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("email", sa.String(), nullable=False),
        sa.Column("full_name", sa.String(), nullable=True),
        sa.Column("display_name", sa.String(), nullable=True),
    )
    metadata.create_all(engine)

    with engine.begin() as connection:
        connection.execute(
            users.insert(),
            [
                {
                    "id": 1,
                    "email": "canonical@example.test",
                    "full_name": "Canonical Name",
                    "display_name": "Stale Display Name",
                },
                {
                    "id": 2,
                    "email": "provider@example.test",
                    "full_name": None,
                    "display_name": "Provider Name",
                },
                {
                    "id": 3,
                    "email": "blank@example.test",
                    "full_name": "   ",
                    "display_name": "  Recovered Name  ",
                },
                {
                    "id": 4,
                    "email": "email-only@example.test",
                    "full_name": None,
                    "display_name": None,
                },
            ],
        )
        migration = _install_migration(connection)

        migration.upgrade()

        assert "display_name" not in {
            column["name"]
            for column in sa.inspect(connection).get_columns("users")
        }
        assert connection.execute(
            sa.text("SELECT id, full_name FROM users ORDER BY id")
        ).all() == [
            (1, "Canonical Name"),
            (2, "Provider Name"),
            (3, "Recovered Name"),
            (4, None),
        ]

        migration.downgrade()

        assert connection.execute(
            sa.text("SELECT id, full_name, display_name FROM users ORDER BY id")
        ).all() == [
            (1, "Canonical Name", "Canonical Name"),
            (2, "Provider Name", "Provider Name"),
            (3, "Recovered Name", "Recovered Name"),
            (4, None, None),
        ]
