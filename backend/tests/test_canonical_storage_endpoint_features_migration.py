# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from __future__ import annotations

from importlib import util
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations
import yaml


def _load_migration():
    path = (
        Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "0115_canonical_storage_endpoint_features.py"
    )
    spec = util.spec_from_file_location(
        "migration_0115_canonical_storage_endpoint_features",
        path,
    )
    assert spec and spec.loader
    migration = util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def _storage_endpoints(metadata: sa.MetaData) -> sa.Table:
    return sa.Table(
        "storage_endpoints",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("features_config", sa.Text()),
    )


def test_migration_canonicalizes_persisted_endpoint_features(monkeypatch):
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    endpoints = _storage_endpoints(metadata)
    metadata.create_all(engine)

    with engine.begin() as connection:
        connection.execute(
            endpoints.insert(),
            [
                {
                    "id": 1,
                    "features_config": (
                        "admin:\n"
                        "  enabled: true\n"
                        "  endpoint: https://admin.example.test/\n"
                        "  ignored: value\n"
                        "healthcheck:\n"
                        "  enabled: true\n"
                        "  mode: S3\n"
                        "  url: https://health.example.test/\n"
                        "removed_feature:\n"
                        "  enabled: true\n"
                    ),
                },
                {
                    "id": 2,
                    "features_config": (
                        "features:\n"
                        "  healthcheck:\n"
                        "    endpoint: https://probe.example.test\n"
                    ),
                },
                {"id": 3, "features_config": "   "},
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
            sa.select(endpoints.c.id, endpoints.c.features_config).order_by(
                endpoints.c.id
            )
        ).all()
        payloads = {
            row.id: yaml.safe_load(row.features_config)
            if row.features_config.strip()
            else row.features_config
            for row in rows
        }
        assert payloads == {
            1: {
                "features": {
                    "admin": {
                        "enabled": True,
                        "endpoint": "https://admin.example.test",
                    },
                    "healthcheck": {
                        "enabled": True,
                        "mode": "s3",
                        "healthcheck_url": "https://health.example.test",
                    },
                }
            },
            2: {
                "features": {
                    "healthcheck": {
                        "healthcheck_url": "https://probe.example.test"
                    }
                }
            },
            3: "   ",
        }


@pytest.mark.parametrize(
    ("raw", "message"),
    [
        ("[admin]", "features YAML must be a mapping"),
        ("features: invalid", "features must be a mapping"),
        ("features:\n  admin: true\n", "feature 'admin' must be a mapping"),
        (
            "features:\n  admin:\n    enabled: 1\n",
            "feature 'admin.enabled' must be a boolean",
        ),
    ],
)
def test_migration_rejects_invalid_active_feature_values(
    monkeypatch,
    raw,
    message,
):
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    endpoints = _storage_endpoints(metadata)
    metadata.create_all(engine)

    with engine.begin() as connection:
        connection.execute(
            endpoints.insert().values(id=7, features_config=raw)
        )
        migration = _load_migration()
        monkeypatch.setattr(
            migration,
            "op",
            Operations(MigrationContext.configure(connection)),
        )

        with pytest.raises(ValueError, match=message):
            migration.upgrade()
