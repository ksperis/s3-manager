# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from importlib import util
from pathlib import Path

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations


def _load_migration():
    migration_path = (
        Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "0092_canonical_user_roles.py"
    )
    spec = util.spec_from_file_location(
        "migration_0092_canonical_user_roles",
        migration_path,
    )
    assert spec and spec.loader
    migration = util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def test_migration_canonicalizes_and_constrains_user_roles(monkeypatch) -> None:
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    users = sa.Table(
        "users",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("role", sa.String(), nullable=False),
    )
    metadata.create_all(engine)

    raw_roles = [
        " ui_superadmin ",
        "SUPER_ADMIN",
        "superadmin",
        "account_admin",
        "admin",
        "account_user",
        "user",
        "none",
        "unsupported",
        "",
    ]
    expected_roles = [
        "ui_superadmin",
        "ui_superadmin",
        "ui_superadmin",
        "ui_admin",
        "ui_admin",
        "ui_user",
        "ui_user",
        "ui_none",
        "ui_none",
        "ui_none",
    ]

    with engine.begin() as connection:
        connection.execute(
            users.insert(),
            [
                {"id": index, "role": role}
                for index, role in enumerate(raw_roles, start=1)
            ],
        )
        migration = _load_migration()
        monkeypatch.setattr(
            migration,
            "op",
            Operations(MigrationContext.configure(connection)),
        )

        migration.upgrade()

        roles = connection.execute(
            sa.text("SELECT role FROM users ORDER BY id")
        ).scalars().all()
        assert roles == expected_roles

        checks = sa.inspect(connection).get_check_constraints("users")
        assert any(check["name"] == "ck_users_role" for check in checks)
        role_column = next(
            column
            for column in sa.inspect(connection).get_columns("users")
            if column["name"] == "role"
        )
        assert "ui_user" in str(role_column["default"])
