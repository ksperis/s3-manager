# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from __future__ import annotations

from importlib import util
import json
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy.exc import IntegrityError


def _load_migration():
    migration_path = (
        Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "0075_canonical_s3_session_capabilities.py"
    )
    spec = util.spec_from_file_location(
        "migration_0075_canonical_s3_session_capabilities",
        migration_path,
    )
    assert spec and spec.loader
    migration = util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def test_migration_canonicalizes_snapshots_and_enforces_not_null(monkeypatch):
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    sessions = sa.Table(
        "s3_sessions",
        metadata,
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("capabilities", sa.Text(), nullable=True),
    )
    metadata.create_all(engine)

    with engine.begin() as connection:
        connection.execute(
            sessions.insert(),
            [
                {"id": "missing", "capabilities": None},
                {
                    "id": "partial",
                    "capabilities": json.dumps(
                        {
                            "can_manage_iam": True,
                            "endpoint_url": " https://s3.example.test/ ",
                        }
                    ),
                },
                {"id": "malformed", "capabilities": "{"},
                {"id": "invalid", "capabilities": json.dumps(["unexpected"])},
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
            sa.text("SELECT id, capabilities FROM s3_sessions ORDER BY id")
        ).all()
        snapshots = {row.id: json.loads(row.capabilities) for row in rows}
        assert snapshots["partial"] == {
            "access_browser": True,
            "can_manage_buckets": True,
            "can_manage_iam": True,
            "can_view_traffic": False,
            "endpoint_url": "https://s3.example.test",
        }
        assert snapshots["missing"] == migration.CAPABILITY_DEFAULTS
        assert snapshots["malformed"] == migration.CAPABILITY_DEFAULTS
        assert snapshots["invalid"] == migration.CAPABILITY_DEFAULTS
        assert sa.inspect(connection).get_columns("s3_sessions")[1]["nullable"] is False

        with pytest.raises(IntegrityError):
            connection.execute(
                sa.text(
                    "INSERT INTO s3_sessions (id, capabilities) VALUES ('null-upgrade', NULL)"
                )
            )

        migration.downgrade()
        connection.execute(
            sa.text(
                "INSERT INTO s3_sessions (id, capabilities) VALUES ('null-downgrade', NULL)"
            )
        )
