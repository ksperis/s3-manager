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
        / "0086_canonical_billing_ops_breakdown.py"
    )
    spec = util.spec_from_file_location(
        "migration_0086_canonical_billing_ops_breakdown",
        migration_path,
    )
    assert spec and spec.loader
    migration = util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def test_migration_canonicalizes_optional_billing_breakdowns(monkeypatch):
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    usage = sa.Table(
        "billing_usage_daily",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("ops_breakdown", sa.Text(), nullable=True),
    )
    metadata.create_all(engine)

    with engine.begin() as connection:
        connection.execute(
            usage.insert(),
            [
                {
                    "id": 1,
                    "ops_breakdown": json.dumps(
                        {"get": "12", "put": 3, "invalid": "many"}
                    ),
                },
                {"id": 2, "ops_breakdown": "{"},
                {"id": 3, "ops_breakdown": json.dumps([])},
                {"id": 4, "ops_breakdown": json.dumps({})},
                {"id": 5, "ops_breakdown": None},
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
                "SELECT id, ops_breakdown FROM billing_usage_daily ORDER BY id"
            )
        ).all()
        assert json.loads(rows[0].ops_breakdown) == {
            "get": 12,
            "invalid": 0,
            "put": 3,
        }
        assert all(row.ops_breakdown is None for row in rows[1:])
