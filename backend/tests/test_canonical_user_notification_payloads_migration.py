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
        / "0080_canonical_user_notification_payloads.py"
    )
    spec = util.spec_from_file_location(
        "migration_0080_canonical_user_notification_payloads",
        migration_path,
    )
    assert spec and spec.loader
    migration = util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def test_migration_canonicalizes_payloads_and_enforces_not_null(monkeypatch):
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    notifications = sa.Table(
        "user_notifications",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("payload_json", sa.Text(), nullable=True),
    )
    metadata.create_all(engine)

    with engine.begin() as connection:
        connection.execute(
            notifications.insert(),
            [
                {"id": 1, "payload_json": json.dumps({"ratio": 90})},
                {"id": 2, "payload_json": None},
                {"id": 3, "payload_json": "{"},
                {"id": 4, "payload_json": json.dumps(["unexpected"])},
            ],
        )
        migration = _load_migration()
        monkeypatch.setattr(
            migration,
            "op",
            Operations(MigrationContext.configure(connection)),
        )

        migration.upgrade()
        connection.execute(
            sa.text("INSERT INTO user_notifications (id) VALUES (5)")
        )

        rows = connection.execute(
            sa.text("SELECT id, payload_json FROM user_notifications ORDER BY id")
        ).all()
        payloads = {row.id: json.loads(row.payload_json) for row in rows}
        assert payloads == {
            1: {"ratio": 90},
            2: {},
            3: {},
            4: {},
            5: {},
        }
        with pytest.raises(IntegrityError):
            connection.execute(
                sa.text(
                    "INSERT INTO user_notifications (id, payload_json) "
                    "VALUES (6, NULL)"
                )
            )
