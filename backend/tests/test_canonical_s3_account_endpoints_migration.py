# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from importlib import util
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
        / "0095_canonical_s3_account_endpoints.py"
    )
    spec = util.spec_from_file_location("migration_0095_canonical_s3_account_endpoints", migration_path)
    assert spec and spec.loader
    migration = util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def _create_schema(engine):
    metadata = sa.MetaData()
    endpoints = sa.Table(
        "storage_endpoints",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("provider", sa.String(), nullable=False),
        sa.Column("is_default", sa.Boolean(), nullable=False),
    )
    accounts = sa.Table(
        "s3_accounts",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("storage_endpoint_id", sa.Integer(), sa.ForeignKey("storage_endpoints.id"), nullable=True),
    )
    metadata.create_all(engine)
    return endpoints, accounts


def _install_operations(monkeypatch, migration, connection) -> None:
    monkeypatch.setattr(migration, "op", Operations(MigrationContext.configure(connection)))


def test_migration_backfills_default_ceph_endpoint_and_enforces_not_null(monkeypatch):
    engine = sa.create_engine("sqlite:///:memory:")
    endpoints, accounts = _create_schema(engine)

    with engine.begin() as connection:
        connection.execute(
            endpoints.insert(),
            [
                {"id": 1, "provider": "ceph", "is_default": True},
                {"id": 2, "provider": "ceph", "is_default": False},
            ],
        )
        connection.execute(
            accounts.insert(),
            [
                {"id": 10, "storage_endpoint_id": None},
                {"id": 11, "storage_endpoint_id": 2},
            ],
        )
        migration = _load_migration()
        _install_operations(monkeypatch, migration, connection)

        migration.upgrade()

        assert connection.execute(
            sa.text("SELECT id, storage_endpoint_id FROM s3_accounts ORDER BY id")
        ).all() == [(10, 1), (11, 2)]
        columns = {column["name"]: column for column in sa.inspect(connection).get_columns("s3_accounts")}
        assert columns["storage_endpoint_id"]["nullable"] is False
        with pytest.raises(IntegrityError):
            with connection.begin_nested():
                connection.execute(accounts.insert().values(id=12, storage_endpoint_id=None))

        migration.downgrade()

        columns = {column["name"]: column for column in sa.inspect(connection).get_columns("s3_accounts")}
        assert columns["storage_endpoint_id"]["nullable"] is True
        connection.execute(sa.text("INSERT INTO s3_accounts (id, storage_endpoint_id) VALUES (13, NULL)"))


def test_migration_rejects_detached_accounts_without_a_default_ceph_endpoint(monkeypatch):
    engine = sa.create_engine("sqlite:///:memory:")
    endpoints, accounts = _create_schema(engine)

    with engine.begin() as connection:
        connection.execute(endpoints.insert().values(id=1, provider="other", is_default=True))
        connection.execute(accounts.insert().values(id=10, storage_endpoint_id=None))
        migration = _load_migration()
        _install_operations(monkeypatch, migration, connection)

        with pytest.raises(RuntimeError, match="default Ceph storage endpoint"):
            migration.upgrade()
