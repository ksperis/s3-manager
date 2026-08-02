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
        / "0078_remove_legacy_tags_json.py"
    )
    spec = util.spec_from_file_location(
        "migration_0078_remove_legacy_tags_json",
        migration_path,
    )
    assert spec and spec.loader
    migration = util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def test_migration_drops_json_mirrors_and_downgrade_rebuilds_them(monkeypatch):
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    definitions = sa.Table(
        "tag_definitions",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("label", sa.String(), nullable=False),
    )
    migration = _load_migration()
    parent_tables: dict[str, sa.Table] = {}
    link_tables: dict[str, sa.Table] = {}
    for parent_table, link_table, parent_column in migration.TAG_PARENTS:
        parent_tables[parent_table] = sa.Table(
            parent_table,
            metadata,
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column(
                "tags_json",
                sa.Text(),
                nullable=False,
                server_default="[]",
            ),
        )
        link_tables[link_table] = sa.Table(
            link_table,
            metadata,
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column(parent_column, sa.Integer(), nullable=False),
            sa.Column("tag_definition_id", sa.Integer(), nullable=False),
            sa.Column("position", sa.Integer(), nullable=False),
        )
    metadata.create_all(engine)

    with engine.begin() as connection:
        connection.execute(
            definitions.insert(),
            [{"id": 1, "label": "finance"}, {"id": 2, "label": "prod"}],
        )
        for parent_table, link_table, parent_column in migration.TAG_PARENTS:
            connection.execute(
                parent_tables[parent_table].insert().values(
                    id=1,
                    tags_json='["stale"]',
                )
            )
            connection.execute(
                link_tables[link_table].insert(),
                [
                    {
                        "id": 1,
                        parent_column: 1,
                        "tag_definition_id": 1,
                        "position": 1,
                    },
                    {
                        "id": 2,
                        parent_column: 1,
                        "tag_definition_id": 2,
                        "position": 0,
                    },
                ],
            )

        monkeypatch.setattr(
            migration,
            "op",
            Operations(MigrationContext.configure(connection)),
        )
        migration.upgrade()

        for parent_table, _, _ in migration.TAG_PARENTS:
            assert "tags_json" not in {
                column["name"]
                for column in sa.inspect(connection).get_columns(parent_table)
            }

        migration.downgrade()

        for parent_table, _, _ in migration.TAG_PARENTS:
            value = connection.execute(
                sa.text(f"SELECT tags_json FROM {parent_table} WHERE id = 1")
            ).scalar_one()
            assert json.loads(value) == ["prod", "finance"]
