# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from importlib import util
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy.exc import IntegrityError


def _load_migration():
    path = (
        Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "0119_first_admin_bootstrap.py"
    )
    spec = util.spec_from_file_location("migration_0119_first_admin_bootstrap", path)
    assert spec and spec.loader
    migration = util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


@pytest.mark.parametrize("with_existing_user", [False, True])
def test_migration_adds_singleton_state_without_changing_users(monkeypatch, with_existing_user):
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    users = sa.Table(
        "users",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("email", sa.String(), nullable=False),
    )
    metadata.create_all(engine)

    with engine.begin() as connection:
        if with_existing_user:
            connection.execute(users.insert().values(id=7, email="existing@example.com"))
        migration = _load_migration()
        monkeypatch.setattr(
            migration,
            "op",
            Operations(MigrationContext.configure(connection)),
        )

        migration.upgrade()

        inspector = sa.inspect(connection)
        assert "first_admin_bootstrap" in inspector.get_table_names()
        assert connection.scalar(sa.text("SELECT COUNT(*) FROM users")) == int(with_existing_user)
        connection.execute(
            sa.text(
                "INSERT INTO first_admin_bootstrap (id, token_digest) "
                "VALUES (1, 'digest')"
            )
        )
        with pytest.raises(IntegrityError):
            with connection.begin_nested():
                connection.execute(
                    sa.text(
                        "INSERT INTO first_admin_bootstrap (id, token_digest) "
                        "VALUES (2, 'other')"
                    )
                )

        migration.downgrade()
        assert "first_admin_bootstrap" not in sa.inspect(connection).get_table_names()
