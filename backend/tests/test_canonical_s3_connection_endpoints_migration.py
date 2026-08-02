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
        / "0089_canonical_s3_connection_endpoints.py"
    )
    spec = util.spec_from_file_location(
        "migration_0089_canonical_s3_connection_endpoints",
        migration_path,
    )
    assert spec and spec.loader
    migration = util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def _table(metadata: sa.MetaData) -> sa.Table:
    return sa.Table(
        "s3_connections",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("storage_endpoint_id", sa.Integer(), nullable=True),
        sa.Column("custom_endpoint_config", sa.Text(), nullable=True),
    )


def test_migration_canonicalizes_custom_connection_endpoints(monkeypatch):
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    connections = _table(metadata)
    metadata.create_all(engine)

    with engine.begin() as connection:
        connection.execute(
            connections.insert(),
            [
                {
                    "id": 1,
                    "storage_endpoint_id": None,
                    "custom_endpoint_config": json.dumps(
                        {
                            "endpoint_url": " https://s3.example.test/ ",
                            "region": " eu-west-1 ",
                            "provider_hint": " aws ",
                        }
                    ),
                },
                {
                    "id": 2,
                    "storage_endpoint_id": 7,
                    "custom_endpoint_config": "not-json",
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
            sa.text(
                "SELECT id, custom_endpoint_config FROM s3_connections ORDER BY id"
            )
        ).all()
        assert json.loads(rows[0].custom_endpoint_config) == {
            "endpoint_url": "https://s3.example.test",
            "force_path_style": False,
            "provider": "aws",
            "region": "eu-west-1",
            "verify_tls": True,
        }
        assert rows[1].custom_endpoint_config is None


@pytest.mark.parametrize("raw", [None, "{", "[]", "{}"])
def test_migration_rejects_unusable_manual_connection_endpoints(raw):
    migration = _load_migration()

    with pytest.raises(ValueError):
        migration._normalize_custom_endpoint(raw)
