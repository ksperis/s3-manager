# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from importlib import util
from pathlib import Path

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations


def _load_migration():
    path = (
        Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "0114_scale_bucket_ui_tags.py"
    )
    spec = util.spec_from_file_location("migration_0114_scale_bucket_ui_tags", path)
    assert spec is not None and spec.loader is not None
    migration = util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def _indexes(connection) -> dict[str, list[str]]:
    return {
        str(index["name"]): list(index["column_names"])
        for index in sa.inspect(connection).get_indexes(
            "bucket_ui_tag_assignments"
        )
    }


def test_bucket_ui_tag_index_migration_upgrade_and_downgrade(monkeypatch):
    engine = sa.create_engine("sqlite:///:memory:")
    with engine.begin() as connection:
        metadata = sa.MetaData()
        assignments = sa.Table(
            "bucket_ui_tag_assignments",
            metadata,
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("storage_endpoint_id", sa.Integer(), nullable=False),
            sa.Column("tag_definition_id", sa.Integer(), nullable=False),
        )
        sa.Index(
            "ix_bucket_ui_tag_assignments_definition",
            assignments.c.tag_definition_id,
        )
        metadata.create_all(connection)
        migration = _load_migration()
        monkeypatch.setattr(
            migration,
            "op",
            Operations(MigrationContext.configure(connection)),
        )

        migration.upgrade()

        assert _indexes(connection) == {
            "ix_bucket_ui_tag_assignments_definition_endpoint": [
                "tag_definition_id",
                "storage_endpoint_id",
            ]
        }

        migration.downgrade()

        assert _indexes(connection) == {
            "ix_bucket_ui_tag_assignments_definition": ["tag_definition_id"]
        }
