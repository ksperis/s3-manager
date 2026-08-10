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

from app.models.app_settings import AppSettings


def _load_migration():
    migration_path = (
        Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "0099_migrate_legacy_portal_app_settings.py"
    )
    spec = util.spec_from_file_location(
        "migration_0099_migrate_legacy_portal_app_settings",
        migration_path,
    )
    assert spec and spec.loader
    migration = util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def _create_settings_table(engine) -> sa.Table:
    metadata = sa.MetaData()
    settings = sa.Table(
        "app_settings",
        metadata,
        sa.Column("key", sa.String(), primary_key=True),
        sa.Column("payload_json", sa.Text(), nullable=False),
    )
    metadata.create_all(engine)
    return settings


def _run_migration(connection, monkeypatch) -> None:
    migration = _load_migration()
    monkeypatch.setattr(
        migration,
        "op",
        Operations(MigrationContext.configure(connection)),
    )
    migration.upgrade()


def test_migration_updates_legacy_portal_settings(monkeypatch):
    engine = sa.create_engine("sqlite:///:memory:")
    settings = _create_settings_table(engine)
    already_clean = json.dumps(
        {
            "branding": {"primary_color": "#123abc"},
            "portal": {"allow_private_storage_space_create": True},
        },
        indent=2,
    )

    with engine.begin() as connection:
        connection.execute(
            settings.insert(),
            [
                {
                    "key": "legacy-true",
                    "payload_json": json.dumps(
                        {
                            "branding": {"primary_color": "#123abc"},
                            "portal": {
                                "allow_portal_user_bucket_create": True,
                                "bucket_access_policy": {"actions": ["s3:GetObject"]},
                                "iam_group_manager_policy": {"actions": []},
                                "iam_group_user_policy": {"advanced_policy": {}},
                            },
                        }
                    ),
                },
                {
                    "key": "legacy-false",
                    "payload_json": json.dumps(
                        {
                            "portal": {
                                "allow_portal_user_bucket_create": False,
                                "browser_access_enabled": True,
                            }
                        }
                    ),
                },
                {
                    "key": "current-wins",
                    "payload_json": json.dumps(
                        {
                            "portal": {
                                "allow_portal_user_bucket_create": True,
                                "allow_private_storage_space_create": False,
                                "bucket_access_policy": None,
                            }
                        }
                    ),
                },
                {
                    "key": "already-clean",
                    "payload_json": already_clean,
                },
                {
                    "key": "without-portal",
                    "payload_json": json.dumps({"onboarding": {"dismissed": True}}),
                },
            ],
        )

        _run_migration(connection, monkeypatch)

        rows = connection.execute(
            sa.text("SELECT key, payload_json FROM app_settings ORDER BY key")
        ).all()
        raw_payloads = {row.key: row.payload_json for row in rows}
        payloads = {key: json.loads(value) for key, value in raw_payloads.items()}

        assert payloads["legacy-true"] == {
            "branding": {"primary_color": "#123abc"},
            "portal": {"allow_private_storage_space_create": True},
        }
        assert payloads["legacy-false"] == {
            "portal": {
                "allow_private_storage_space_create": False,
                "browser_access_enabled": True,
            }
        }
        assert payloads["current-wins"] == {
            "portal": {"allow_private_storage_space_create": False}
        }
        assert raw_payloads["already-clean"] == already_clean
        assert payloads["without-portal"] == {"onboarding": {"dismissed": True}}

        for payload in payloads.values():
            AppSettings.model_validate(payload)


@pytest.mark.parametrize(
    "invalid_payload",
    [
        "{",
        json.dumps(["not-an-object"]),
        json.dumps({"portal": ["not-an-object"]}),
    ],
)
def test_migration_rejects_structurally_invalid_json_atomically(
    monkeypatch,
    invalid_payload,
):
    engine = sa.create_engine("sqlite:///:memory:")
    settings = _create_settings_table(engine)
    valid_legacy = json.dumps(
        {"portal": {"allow_portal_user_bucket_create": True}}
    )

    with engine.begin() as connection:
        connection.execute(
            settings.insert(),
            [
                {"key": "valid-legacy", "payload_json": valid_legacy},
                {"key": "invalid", "payload_json": invalid_payload},
            ],
        )

        with pytest.raises(ValueError, match="must contain a JSON object"):
            _run_migration(connection, monkeypatch)

        stored = connection.execute(
            sa.text(
                "SELECT payload_json FROM app_settings WHERE key = 'valid-legacy'"
            )
        ).scalar_one()
        assert stored == valid_legacy


@pytest.mark.parametrize("legacy_value", [1, "true", None])
def test_migration_rejects_non_boolean_legacy_create_setting(
    monkeypatch,
    legacy_value,
):
    engine = sa.create_engine("sqlite:///:memory:")
    settings = _create_settings_table(engine)
    payload_json = json.dumps(
        {"portal": {"allow_portal_user_bucket_create": legacy_value}}
    )

    with engine.begin() as connection:
        connection.execute(
            settings.insert().values(key="invalid-legacy", payload_json=payload_json)
        )

        with pytest.raises(
            ValueError,
            match="allow_portal_user_bucket_create must be a boolean",
        ):
            _run_migration(connection, monkeypatch)

        stored = connection.execute(
            sa.text(
                "SELECT payload_json FROM app_settings WHERE key = 'invalid-legacy'"
            )
        ).scalar_one()
        assert stored == payload_json
