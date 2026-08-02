# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from importlib import util
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

from app.services.audit_policy import NON_PERSISTED_AUDIT_ACTIONS


def _load_migration():
    migration_path = (
        Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "0091_purge_data_plane_audit_logs.py"
    )
    spec = util.spec_from_file_location(
        "migration_0091_purge_data_plane_audit_logs",
        migration_path,
    )
    assert spec and spec.loader
    migration = util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def test_migration_purges_only_excluded_audit_actions(monkeypatch) -> None:
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    audit_logs = sa.Table(
        "audit_logs",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("action", sa.String(), nullable=False),
    )
    metadata.create_all(engine)

    retained_actions = [
        "login_success",
        "create_iam_user",
        "update_bucket_versioning",
        "start_bucket_migration",
    ]
    all_actions = sorted(NON_PERSISTED_AUDIT_ACTIONS) + retained_actions

    with engine.begin() as connection:
        connection.execute(
            audit_logs.insert(),
            [{"id": index, "action": action} for index, action in enumerate(all_actions, 1)],
        )
        migration = _load_migration()
        monkeypatch.setattr(
            migration,
            "op",
            Operations(MigrationContext.configure(connection)),
        )

        assert set(migration.PURGED_ACTIONS) == NON_PERSISTED_AUDIT_ACTIONS
        migration.upgrade()

        remaining = connection.execute(
            sa.select(audit_logs.c.action).order_by(audit_logs.c.action)
        ).scalars().all()
        assert remaining == sorted(retained_actions)


def test_migration_downgrade_is_explicitly_unsupported() -> None:
    migration = _load_migration()

    with pytest.raises(RuntimeError, match="irreversibly deletes audit rows"):
        migration.downgrade()
