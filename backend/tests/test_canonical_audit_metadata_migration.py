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
        / "0087_canonical_audit_metadata.py"
    )
    spec = util.spec_from_file_location(
        "migration_0087_canonical_audit_metadata",
        migration_path,
    )
    assert spec and spec.loader
    migration = util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def test_migration_preserves_audit_metadata_as_objects(monkeypatch):
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    audit_logs = sa.Table(
        "audit_logs",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("metadata_json", sa.Text(), nullable=True),
    )
    metadata.create_all(engine)

    with engine.begin() as connection:
        connection.execute(
            audit_logs.insert(),
            [
                {"id": 1, "metadata_json": json.dumps({"key": "value"})},
                {"id": 2, "metadata_json": json.dumps(["one", "two"])},
                {"id": 3, "metadata_json": '{"truncated": true, "preview": "'},
                {"id": 4, "metadata_json": None},
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
            sa.text("SELECT id, metadata_json FROM audit_logs ORDER BY id")
        ).all()
        assert json.loads(rows[0].metadata_json) == {"key": "value"}
        assert json.loads(rows[1].metadata_json) == {"value": ["one", "two"]}
        assert json.loads(rows[2].metadata_json) == {
            "unparsed": '{"truncated": true, "preview": "'
        }
        assert rows[3].metadata_json is None
