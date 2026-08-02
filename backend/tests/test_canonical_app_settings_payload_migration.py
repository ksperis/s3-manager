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
        / "0082_canonical_app_settings_payload.py"
    )
    spec = util.spec_from_file_location(
        "migration_0082_canonical_app_settings_payload",
        migration_path,
    )
    assert spec and spec.loader
    migration = util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def test_migration_canonicalizes_app_settings_objects(monkeypatch):
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    settings = sa.Table(
        "app_settings",
        metadata,
        sa.Column("key", sa.String(), primary_key=True),
        sa.Column("payload_json", sa.Text(), nullable=False),
    )
    metadata.create_all(engine)

    with engine.begin() as connection:
        connection.execute(
            settings.insert(),
            [
                {
                    "key": "valid",
                    "payload_json": json.dumps(
                        {"branding": {"primary_color": "#123abc"}}
                    ),
                },
                {"key": "malformed", "payload_json": "{"},
                {"key": "non-object", "payload_json": json.dumps([1, 2])},
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
            sa.text("SELECT key, payload_json FROM app_settings ORDER BY key")
        ).all()
        payloads = {row.key: json.loads(row.payload_json) for row in rows}
        assert payloads == {
            "malformed": {},
            "non-object": {},
            "valid": {"branding": {"primary_color": "#123abc"}},
        }
