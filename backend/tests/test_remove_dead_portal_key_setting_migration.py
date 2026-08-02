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
        / "0093_remove_dead_portal_key_setting.py"
    )
    spec = util.spec_from_file_location(
        "migration_0093_remove_dead_portal_key_setting",
        migration_path,
    )
    assert spec and spec.loader
    migration = util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def test_migration_removes_dead_portal_key_setting(monkeypatch):
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    accounts = sa.Table(
        "s3_accounts",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("portal_settings_override", sa.Text(), nullable=True),
    )
    settings = sa.Table(
        "app_settings",
        metadata,
        sa.Column("key", sa.String(), primary_key=True),
        sa.Column("payload_json", sa.Text(), nullable=False),
    )
    metadata.create_all(engine)

    with engine.begin() as connection:
        connection.execute(
            accounts.insert(),
            [
                {
                    "id": 1,
                    "portal_settings_override": json.dumps(
                        {
                            "allow_portal_key": True,
                            "browser_access_enabled": True,
                        }
                    ),
                },
                {
                    "id": 2,
                    "portal_settings_override": json.dumps(
                        {"allow_portal_key": False}
                    ),
                },
                {
                    "id": 3,
                    "portal_settings_override": json.dumps(
                        {"browser_access_enabled": False}
                    ),
                },
            ],
        )
        connection.execute(
            settings.insert(),
            [
                {
                    "key": "default",
                    "payload_json": json.dumps(
                        {
                            "general": {"portal_enabled": True},
                            "portal": {
                                "allow_portal_key": True,
                                "browser_access_enabled": True,
                            },
                        }
                    ),
                },
                {
                    "key": "unrelated",
                    "payload_json": json.dumps(
                        {"branding": {"primary_color": "#123abc"}}
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

        account_rows = connection.execute(
            sa.text(
                "SELECT id, portal_settings_override FROM s3_accounts ORDER BY id"
            )
        ).all()
        assert json.loads(account_rows[0].portal_settings_override) == {
            "browser_access_enabled": True
        }
        assert account_rows[1].portal_settings_override is None
        assert json.loads(account_rows[2].portal_settings_override) == {
            "browser_access_enabled": False
        }

        setting_rows = connection.execute(
            sa.text("SELECT key, payload_json FROM app_settings ORDER BY key")
        ).all()
        payloads = {row.key: json.loads(row.payload_json) for row in setting_rows}
        assert payloads == {
            "default": {
                "general": {"portal_enabled": True},
                "portal": {"browser_access_enabled": True},
            },
            "unrelated": {"branding": {"primary_color": "#123abc"}},
        }
