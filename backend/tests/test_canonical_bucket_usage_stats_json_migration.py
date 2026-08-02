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
        / "0085_canonical_bucket_usage_stats_json.py"
    )
    spec = util.spec_from_file_location(
        "migration_0085_canonical_bucket_usage_stats_json",
        migration_path,
    )
    assert spec and spec.loader
    migration = util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def test_migration_canonicalizes_bucket_usage_stats_json(monkeypatch):
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    columns = {
        name: sa.Column(name, sa.Text(), nullable=False)
        for name in (
            "data_type_distribution_json",
            "storage_class_distribution_json",
            "size_distribution_json",
            "age_distribution_json",
            "current_noncurrent_distribution_json",
        )
    }
    snapshots = sa.Table(
        "bucket_usage_stats_snapshots",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        *columns.values(),
        sa.Column("warnings_json", sa.Text(), nullable=True),
    )
    metadata.create_all(engine)

    entry = {"key": "documents", "label": "Documents"}
    with engine.begin() as connection:
        connection.execute(
            snapshots.insert(),
            [
                {
                    "id": 1,
                    "data_type_distribution_json": json.dumps(
                        [entry, "invalid"]
                    ),
                    "storage_class_distribution_json": "{",
                    "size_distribution_json": json.dumps({"unexpected": True}),
                    "age_distribution_json": json.dumps([]),
                    "current_noncurrent_distribution_json": json.dumps(
                        [entry]
                    ),
                    "warnings_json": json.dumps(["partial", 42]),
                },
                {
                    "id": 2,
                    **{name: "[]" for name in columns},
                    "warnings_json": None,
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
                "SELECT * FROM bucket_usage_stats_snapshots ORDER BY id"
            )
        ).all()
        assert json.loads(rows[0].data_type_distribution_json) == [entry]
        assert json.loads(rows[0].storage_class_distribution_json) == []
        assert json.loads(rows[0].size_distribution_json) == []
        assert json.loads(rows[0].age_distribution_json) == []
        assert json.loads(rows[0].current_noncurrent_distribution_json) == [
            entry
        ]
        assert json.loads(rows[0].warnings_json) == ["partial"]
        assert rows[1].warnings_json is None
