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
        / "0083_canonical_oidc_provider_scopes.py"
    )
    spec = util.spec_from_file_location(
        "migration_0083_canonical_oidc_provider_scopes",
        migration_path,
    )
    assert spec and spec.loader
    migration = util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def test_migration_canonicalizes_oidc_provider_scopes(monkeypatch):
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    providers = sa.Table(
        "oidc_providers",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("scopes_json", sa.Text(), nullable=False),
    )
    metadata.create_all(engine)

    with engine.begin() as connection:
        connection.execute(
            providers.insert(),
            [
                {
                    "id": 1,
                    "scopes_json": json.dumps([" openid ", "email"]),
                },
                {"id": 2, "scopes_json": "{"},
                {"id": 3, "scopes_json": json.dumps([])},
                {
                    "id": 4,
                    "scopes_json": json.dumps([None, "", 42, " profile "]),
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
            sa.text("SELECT id, scopes_json FROM oidc_providers ORDER BY id")
        ).all()
        scopes = {row.id: json.loads(row.scopes_json) for row in rows}
        assert scopes == {
            1: ["openid", "email"],
            2: migration.DEFAULT_SCOPES,
            3: migration.DEFAULT_SCOPES,
            4: ["profile"],
        }
