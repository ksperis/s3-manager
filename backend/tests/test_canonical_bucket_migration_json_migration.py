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
        / "0090_canonical_bucket_migration_json.py"
    )
    spec = util.spec_from_file_location(
        "migration_0090_canonical_bucket_migration_json",
        migration_path,
    )
    assert spec and spec.loader
    migration = util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def test_migration_canonicalizes_bucket_migration_json(monkeypatch):
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    migrations = sa.Table(
        "bucket_migrations",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("precheck_report_json", sa.Text(), nullable=True),
    )
    item_columns = [
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("diff_sample_json", sa.Text(), nullable=True),
        *[
            sa.Column(field, sa.Text(), nullable=True)
            for field in (
                "source_snapshot_json",
                "target_snapshot_json",
                "execution_plan_json",
                "replication_state_json",
                "source_policy_backup_json",
                "target_policy_backup_json",
            )
        ],
    ]
    items = sa.Table("bucket_migration_items", metadata, *item_columns)
    events = sa.Table(
        "bucket_migration_events",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("metadata_json", sa.Text(), nullable=True),
    )
    metadata.create_all(engine)

    with engine.begin() as connection:
        connection.execute(
            migrations.insert(),
            [
                {"id": 1, "precheck_report_json": json.dumps({"status": "passed"})},
                {"id": 2, "precheck_report_json": "{"},
            ],
        )
        connection.execute(
            items.insert(),
            {
                "id": 1,
                "diff_sample_json": json.dumps(["difference"]),
                "source_snapshot_json": json.dumps({"versioning": {}}),
                "target_snapshot_json": "{",
                "execution_plan_json": json.dumps([]),
                "replication_state_json": json.dumps({"watermark": {}}),
                "source_policy_backup_json": "null",
                "target_policy_backup_json": json.dumps({"Version": "2012-10-17"}),
            },
        )
        connection.execute(
            events.insert(),
            [
                {"id": 1, "metadata_json": "{"},
                {"id": 2, "metadata_json": json.dumps("legacy")},
            ],
        )
        migration = _load_migration()
        monkeypatch.setattr(
            migration,
            "op",
            Operations(MigrationContext.configure(connection)),
        )

        migration.upgrade()

        migration_rows = connection.execute(
            sa.text(
                "SELECT id, precheck_report_json FROM bucket_migrations ORDER BY id"
            )
        ).all()
        assert json.loads(migration_rows[0].precheck_report_json) == {
            "status": "passed"
        }
        assert migration_rows[1].precheck_report_json is None

        item = connection.execute(
            sa.text("SELECT * FROM bucket_migration_items WHERE id = 1")
        ).one()
        assert json.loads(item.diff_sample_json) == {"value": ["difference"]}
        assert json.loads(item.source_snapshot_json) == {"versioning": {}}
        assert item.target_snapshot_json is None
        assert item.execution_plan_json is None
        assert json.loads(item.replication_state_json) == {"watermark": {}}
        assert item.source_policy_backup_json is None
        assert json.loads(item.target_policy_backup_json) == {
            "Version": "2012-10-17"
        }

        event_rows = connection.execute(
            sa.text(
                "SELECT id, metadata_json FROM bucket_migration_events ORDER BY id"
            )
        ).all()
        assert json.loads(event_rows[0].metadata_json) == {"unparsed": "{"}
        assert json.loads(event_rows[1].metadata_json) == {"value": "legacy"}
