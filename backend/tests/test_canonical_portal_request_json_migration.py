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
        / "0081_canonical_portal_request_json.py"
    )
    spec = util.spec_from_file_location(
        "migration_0081_canonical_portal_request_json",
        migration_path,
    )
    assert spec and spec.loader
    migration = util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def test_migration_canonicalizes_portal_request_objects(monkeypatch):
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    requests = sa.Table(
        "portal_admin_requests",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("payload_json", sa.Text(), nullable=False),
        sa.Column("result_json", sa.Text(), nullable=True),
    )
    metadata.create_all(engine)

    with engine.begin() as connection:
        connection.execute(
            requests.insert(),
            [
                {
                    "id": 1,
                    "payload_json": json.dumps({"target_email": "a@example.test"}),
                    "result_json": json.dumps({"created": True}),
                },
                {
                    "id": 2,
                    "payload_json": "{",
                    "result_json": json.dumps(["unexpected"]),
                },
                {
                    "id": 3,
                    "payload_json": json.dumps(["unexpected"]),
                    "result_json": None,
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
                "SELECT id, payload_json, result_json "
                "FROM portal_admin_requests ORDER BY id"
            )
        ).all()
        assert json.loads(rows[0].payload_json) == {
            "target_email": "a@example.test"
        }
        assert json.loads(rows[0].result_json) == {"created": True}
        assert json.loads(rows[1].payload_json) == {}
        assert json.loads(rows[1].result_json) == {}
        assert json.loads(rows[2].payload_json) == {}
        assert rows[2].result_json is None
