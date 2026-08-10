# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from __future__ import annotations

from importlib import util
import json
from pathlib import Path

from alembic.migration import MigrationContext
from alembic.operations import Operations
import pytest
import sqlalchemy as sa


def _load_migration():
    migration_path = (
        Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "0102_reorganize_manager_global_settings.py"
    )
    spec = util.spec_from_file_location("migration_0102_reorganize_manager_global_settings", migration_path)
    assert spec and spec.loader
    migration = util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def _create_schema(engine):
    metadata = sa.MetaData()
    settings = sa.Table(
        "app_settings",
        metadata,
        sa.Column("key", sa.String(), primary_key=True),
        sa.Column("payload_json", sa.Text(), nullable=False),
    )
    metadata.create_all(engine)
    return settings


def _operations(connection, monkeypatch):
    migration = _load_migration()
    monkeypatch.setattr(migration, "op", Operations(MigrationContext.configure(connection)))
    return migration


def _payload(connection, key: str) -> dict:
    raw = connection.execute(
        sa.text("SELECT payload_json FROM app_settings WHERE key = :key"),
        {"key": key},
    ).scalar_one()
    return json.loads(raw)


def test_migration_preserves_disabled_values_and_round_trips(monkeypatch):
    engine = sa.create_engine("sqlite:///:memory:")
    settings = _create_schema(engine)
    with engine.begin() as connection:
        connection.execute(
            settings.insert().values(
                key="default",
                payload_json=json.dumps(
                    {
                        "general": {
                            "bucket_usage_stats_enabled": False,
                            "bucket_quota_management_enabled": False,
                            "ceph_s3_user_access_key_management_enabled": False,
                        },
                        "manager": {
                            "allow_manager_user_usage_stats": False,
                            "bucket_migration_parallelism_default": 4,
                        },
                        "unrelated": {"preserved": True},
                    }
                ),
            )
        )
        connection.execute(settings.insert().values(key="defaults", payload_json="{}"))
        migration = _operations(connection, monkeypatch)

        migration.upgrade()

        payload = _payload(connection, "default")
        assert payload["general"] == {
            "bucket_quota_management_enabled": False,
            "bucket_usage_stats_enabled": False,
            "manager_ceph_s3_user_keys_enabled": False,
        }
        assert payload["manager"] == {
            "bucket_migration_parallelism_default": 4,
            "manager_rgw_usage_metrics_enabled": False,
        }
        assert payload["unrelated"] == {"preserved": True}
        assert _payload(connection, "defaults") == {
            "general": {"manager_ceph_s3_user_keys_enabled": True},
            "manager": {"manager_rgw_usage_metrics_enabled": True},
        }

        migration.downgrade()

        payload = _payload(connection, "default")
        assert payload["general"]["ceph_s3_user_access_key_management_enabled"] is False
        assert "manager_ceph_s3_user_keys_enabled" not in payload["general"]
        assert payload["manager"]["allow_manager_user_usage_stats"] is False
        assert "manager_rgw_usage_metrics_enabled" not in payload["manager"]


@pytest.mark.parametrize(
    "invalid_payload",
    [
        "{",
        json.dumps([]),
        json.dumps({"general": []}),
        json.dumps({"manager": []}),
        json.dumps({"general": {"ceph_s3_user_access_key_management_enabled": 1}}),
        json.dumps({"general": {"manager_ceph_s3_user_keys_enabled": "yes"}}),
        json.dumps({"manager": {"allow_manager_user_usage_stats": 1}}),
        json.dumps({"manager": {"manager_rgw_usage_metrics_enabled": "yes"}}),
    ],
)
def test_migration_validates_every_row_before_updating(monkeypatch, invalid_payload):
    engine = sa.create_engine("sqlite:///:memory:")
    settings = _create_schema(engine)
    original = json.dumps(
        {
            "general": {"ceph_s3_user_access_key_management_enabled": False},
            "manager": {"allow_manager_user_usage_stats": False},
        }
    )
    with engine.begin() as connection:
        connection.execute(settings.insert().values(key="valid", payload_json=original))
        connection.execute(settings.insert().values(key="invalid", payload_json=invalid_payload))
        migration = _operations(connection, monkeypatch)

        with pytest.raises(ValueError, match="must (contain a JSON object|be a boolean)"):
            migration.upgrade()

        assert connection.execute(
            sa.text("SELECT payload_json FROM app_settings WHERE key = 'valid'")
        ).scalar_one() == original
