# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from __future__ import annotations

from importlib import util
import json
from pathlib import Path

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations


def _load_migration():
    migration_path = (
        Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "0079_canonical_user_ui_preferences.py"
    )
    spec = util.spec_from_file_location(
        "migration_0079_canonical_user_ui_preferences",
        migration_path,
    )
    assert spec and spec.loader
    migration = util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def test_migration_canonicalizes_user_ui_preferences(monkeypatch):
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    users = sa.Table(
        "users",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "ui_preferences_json",
            sa.Text(),
            nullable=False,
            server_default="{}",
        ),
    )
    metadata.create_all(engine)

    with engine.begin() as connection:
        connection.execute(
            users.insert(),
            [
                {
                    "id": 1,
                    "ui_preferences_json": json.dumps(
                        {
                            "theme": "dark",
                            "selected_portal_account_id": " 101 ",
                            "removed_preference": True,
                        }
                    ),
                },
                {"id": 2, "ui_preferences_json": "{"},
                {"id": 3, "ui_preferences_json": json.dumps(["dark"])},
                {
                    "id": 4,
                    "ui_preferences_json": json.dumps(
                        {
                            "theme": "contrast",
                            "selected_portal_account_id": "202",
                        }
                    ),
                },
                {
                    "id": 5,
                    "ui_preferences_json": json.dumps(
                        {"selected_portal_account_id": "   "}
                    ),
                },
            ],
        )
        migration = _load_migration()
        monkeypatch.setattr(
            migration,
            "op",
            Operations(MigrationContext.configure(connection)),
        )

        migration.upgrade()

        rows = connection.execute(
            sa.text("SELECT id, ui_preferences_json FROM users ORDER BY id")
        ).all()
        preferences = {
            row.id: json.loads(row.ui_preferences_json) for row in rows
        }
        assert preferences == {
            1: {"selected_portal_account_id": "101", "theme": "dark"},
            2: {},
            3: {},
            4: {},
            5: {},
        }
