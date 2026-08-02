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
        / "0077_canonical_s3_connection_capabilities.py"
    )
    spec = util.spec_from_file_location(
        "migration_0077_canonical_s3_connection_capabilities",
        migration_path,
    )
    assert spec and spec.loader
    migration = util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def test_migration_canonicalizes_profiles_and_replaces_the_server_default(
    monkeypatch,
):
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    connections = sa.Table(
        "s3_connections",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "capabilities_json",
            sa.Text(),
            nullable=False,
            server_default="{}",
        ),
    )
    metadata.create_all(engine)

    with engine.begin() as connection:
        connection.execute(
            connections.insert(),
            [
                {
                    "id": 1,
                    "capabilities_json": json.dumps(
                        {"can_manage_iam": True, "region_probe": "ok"}
                    ),
                },
                {
                    "id": 2,
                    "capabilities_json": json.dumps(
                        {"iam_capable": True, "region_probe": "legacy"}
                    ),
                },
                {"id": 3, "capabilities_json": "{"},
                {"id": 4, "capabilities_json": json.dumps(["unexpected"])},
            ],
        )
        migration = _load_migration()
        monkeypatch.setattr(
            migration,
            "op",
            Operations(MigrationContext.configure(connection)),
        )

        migration.upgrade()
        connection.execute(sa.text("INSERT INTO s3_connections (id) VALUES (5)"))

        rows = connection.execute(
            sa.text(
                "SELECT id, capabilities_json FROM s3_connections ORDER BY id"
            )
        ).all()
        profiles = {row.id: json.loads(row.capabilities_json) for row in rows}
        assert profiles == {
            1: {"can_manage_iam": True, "region_probe": "ok"},
            2: {"can_manage_iam": False, "region_probe": "legacy"},
            3: migration.DEFAULT_CAPABILITIES,
            4: migration.DEFAULT_CAPABILITIES,
            5: migration.DEFAULT_CAPABILITIES,
        }

        migration.downgrade()
        connection.execute(sa.text("INSERT INTO s3_connections (id) VALUES (6)"))
        downgraded_default = connection.execute(
            sa.text(
                "SELECT capabilities_json FROM s3_connections WHERE id = 6"
            )
        ).scalar_one()
        assert json.loads(downgraded_default) == {}
