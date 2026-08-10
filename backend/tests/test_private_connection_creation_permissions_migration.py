# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from __future__ import annotations

from importlib import util
import json
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
        / "0100_private_connection_creation_permissions.py"
    )
    spec = util.spec_from_file_location(
        "migration_0100_private_connection_creation_permissions",
        migration_path,
    )
    assert spec and spec.loader
    migration = util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def _create_legacy_schema(engine):
    metadata = sa.MetaData()
    users = sa.Table(
        "users",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("email", sa.String(), nullable=False),
        sa.Column("role", sa.String(), nullable=False),
    )
    groups = sa.Table(
        "ui_groups",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(), nullable=False),
    )
    settings = sa.Table(
        "app_settings",
        metadata,
        sa.Column("key", sa.String(), primary_key=True),
        sa.Column("payload_json", sa.Text(), nullable=False),
    )
    metadata.create_all(engine)
    return users, groups, settings


def _run_migration(connection, monkeypatch) -> None:
    migration = _load_migration()
    monkeypatch.setattr(
        migration,
        "op",
        Operations(MigrationContext.configure(connection)),
    )
    migration.upgrade()


@pytest.mark.parametrize("legacy_enabled", [False, True])
def test_migration_backfills_existing_roles_and_removes_legacy_setting(
    monkeypatch,
    legacy_enabled,
):
    engine = sa.create_engine("sqlite:///:memory:")
    users, groups, settings = _create_legacy_schema(engine)
    with engine.begin() as connection:
        connection.execute(
            users.insert(),
            [
                {"id": 1, "email": "super@example.test", "role": "ui_superadmin"},
                {"id": 2, "email": "admin@example.test", "role": "ui_admin"},
                {"id": 3, "email": "user@example.test", "role": "ui_user"},
                {"id": 4, "email": "none@example.test", "role": "ui_none"},
            ],
        )
        connection.execute(groups.insert().values(id=1, name="existing group"))
        connection.execute(
            settings.insert(),
            [
                {
                    "key": "default",
                    "payload_json": json.dumps(
                        {
                            "general": {
                                "manager_enabled": True,
                                "allow_user_private_connections": legacy_enabled,
                            }
                        }
                    ),
                },
                {
                    "key": "secondary",
                    "payload_json": json.dumps(
                        {"general": {"allow_user_private_connections": True}}
                    ),
                },
            ],
        )

        _run_migration(connection, monkeypatch)

        rows = connection.execute(
            sa.text(
                "SELECT role, can_create_manual_private_connections, "
                "can_provision_managed_private_connections FROM users ORDER BY id"
            )
        ).all()
        assert rows == [
            ("ui_superadmin", 1, 1),
            ("ui_admin", 1, 1),
            ("ui_user", int(legacy_enabled), int(legacy_enabled)),
            ("ui_none", 0, 0),
        ]
        group_row = connection.execute(
            sa.text(
                "SELECT can_create_manual_private_connections, "
                "can_provision_managed_private_connections FROM ui_groups WHERE id = 1"
            )
        ).one()
        assert group_row == (0, 0)
        payloads = [
            json.loads(raw)
            for raw in connection.execute(
                sa.text("SELECT payload_json FROM app_settings ORDER BY key")
            ).scalars()
        ]
        assert payloads[0] == {"general": {"manager_enabled": True}}
        assert payloads[1] == {"general": {}}

        connection.execute(
            sa.text(
                "INSERT INTO users (id, email, role) VALUES "
                "(5, 'future@example.test', 'ui_user')"
            )
        )
        future = connection.execute(
            sa.text(
                "SELECT can_create_manual_private_connections, "
                "can_provision_managed_private_connections FROM users WHERE id = 5"
            )
        ).one()
        assert future == (0, 0)
        connection.execute(
            sa.text("INSERT INTO ui_groups (id, name) VALUES (2, 'future group')")
        )
        future_group = connection.execute(
            sa.text(
                "SELECT can_create_manual_private_connections, "
                "can_provision_managed_private_connections FROM ui_groups WHERE id = 2"
            )
        ).one()
        assert future_group == (0, 0)


@pytest.mark.parametrize(
    "invalid_payload",
    [
        "{",
        json.dumps(["not-an-object"]),
        json.dumps({"general": ["not-an-object"]}),
        json.dumps({"general": {"allow_user_private_connections": 1}}),
    ],
)
def test_migration_rejects_invalid_settings_before_schema_or_data_mutation(
    monkeypatch,
    invalid_payload,
):
    engine = sa.create_engine("sqlite:///:memory:")
    users, _, settings = _create_legacy_schema(engine)
    valid_payload = json.dumps(
        {"general": {"allow_user_private_connections": True}}
    )
    with engine.begin() as connection:
        connection.execute(
            users.insert().values(id=1, email="admin@example.test", role="ui_admin")
        )
        connection.execute(
            settings.insert(),
            [
                {"key": "default", "payload_json": valid_payload},
                {"key": "invalid", "payload_json": invalid_payload},
            ],
        )

        with pytest.raises(ValueError, match="must (contain a JSON object|be a boolean)"):
            _run_migration(connection, monkeypatch)

        user_columns = {column["name"] for column in sa.inspect(connection).get_columns("users")}
        group_columns = {column["name"] for column in sa.inspect(connection).get_columns("ui_groups")}
        assert "can_create_manual_private_connections" not in user_columns
        assert "can_provision_managed_private_connections" not in user_columns
        assert "can_create_manual_private_connections" not in group_columns
        stored = connection.execute(
            sa.text("SELECT payload_json FROM app_settings WHERE key = 'default'")
        ).scalar_one()
        assert stored == valid_payload
