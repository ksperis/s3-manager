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
        / "0084_canonical_managed_access_iam_lists.py"
    )
    spec = util.spec_from_file_location(
        "migration_0084_canonical_managed_access_iam_lists",
        migration_path,
    )
    assert spec and spec.loader
    migration = util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def test_migration_canonicalizes_managed_access_iam_lists(monkeypatch):
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    accesses = sa.Table(
        "managed_private_accesses",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("iam_groups_json", sa.Text(), nullable=False),
        sa.Column("iam_managed_policies_json", sa.Text(), nullable=False),
        sa.Column("iam_inline_policy_names_json", sa.Text(), nullable=False),
    )
    metadata.create_all(engine)

    with engine.begin() as connection:
        connection.execute(
            accesses.insert(),
            [
                {
                    "id": 1,
                    "iam_groups_json": json.dumps(
                        [" operators ", "operators", "", None, 42]
                    ),
                    "iam_managed_policies_json": "{",
                    "iam_inline_policy_names_json": json.dumps("inline-read"),
                },
                {
                    "id": 2,
                    "iam_groups_json": "[]",
                    "iam_managed_policies_json": json.dumps(
                        [" arn:test:readonly "]
                    ),
                    "iam_inline_policy_names_json": json.dumps(
                        [" inline-read ", "inline-read"]
                    ),
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
                "SELECT id, iam_groups_json, iam_managed_policies_json, "
                "iam_inline_policy_names_json "
                "FROM managed_private_accesses ORDER BY id"
            )
        ).all()
        assert json.loads(rows[0].iam_groups_json) == ["operators"]
        assert json.loads(rows[0].iam_managed_policies_json) == []
        assert json.loads(rows[0].iam_inline_policy_names_json) == []
        assert json.loads(rows[1].iam_groups_json) == []
        assert json.loads(rows[1].iam_managed_policies_json) == [
            "arn:test:readonly"
        ]
        assert json.loads(rows[1].iam_inline_policy_names_json) == [
            "inline-read"
        ]
