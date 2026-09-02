# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

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
        / "0121_identity_security_policies.py"
    )
    spec = util.spec_from_file_location("migration_0121_identity_security_policies", path)
    assert spec and spec.loader
    migration = util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def _install_operations(monkeypatch, migration, connection) -> None:
    monkeypatch.setattr(
        migration,
        "op",
        Operations(MigrationContext.configure(connection)),
    )


def test_upgrade_resumes_after_sqlite_columns_were_added_without_version_stamp(
    monkeypatch,
):
    metadata = sa.MetaData()
    sa.Table(
        "oidc_providers",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "linking_policy",
            sa.String(),
            nullable=False,
            server_default="manual",
        ),
    )
    sa.Table(
        "external_identities",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "link_source",
            sa.String(),
            nullable=False,
            server_default="jit",
        ),
    )
    sa.Table(
        "external_identity_link_requests",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("decision_source", sa.String(), nullable=True),
    )

    engine = sa.create_engine("sqlite:///:memory:")
    with engine.begin() as connection:
        metadata.create_all(connection)
        migration = _load_migration()
        _install_operations(monkeypatch, migration, connection)

        migration.upgrade()
        migration.upgrade()

        inspector = sa.inspect(connection)
        assert {
            "linking_policy",
            "trusted_email_domains_json",
        } <= {
            column["name"]
            for column in inspector.get_columns("oidc_providers")
        }
        assert "link_source" in {
            column["name"]
            for column in inspector.get_columns("external_identities")
        }
        assert "decision_source" in {
            column["name"]
            for column in inspector.get_columns("external_identity_link_requests")
        }
