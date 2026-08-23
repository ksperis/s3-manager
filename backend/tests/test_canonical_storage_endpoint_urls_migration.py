# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from __future__ import annotations

from importlib import util
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy.exc import IntegrityError


def _load_migration():
    path = (
        Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "0118_canonical_storage_endpoint_urls.py"
    )
    spec = util.spec_from_file_location(
        "migration_0118_canonical_storage_endpoint_urls",
        path,
    )
    assert spec and spec.loader
    migration = util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def _storage_endpoints(metadata: sa.MetaData) -> sa.Table:
    return sa.Table(
        "storage_endpoints",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("endpoint_url", sa.String(), nullable=False, unique=True),
    )


def _install_migration(connection, monkeypatch):
    migration = _load_migration()
    monkeypatch.setattr(
        migration,
        "op",
        Operations(MigrationContext.configure(connection)),
    )
    return migration


def test_migration_canonicalizes_and_constrains_endpoint_urls(monkeypatch):
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    endpoints = _storage_endpoints(metadata)
    metadata.create_all(engine)

    with engine.begin() as connection:
        connection.execute(
            endpoints.insert(),
            [
                {"id": 1, "endpoint_url": " https://one.example.test/ "},
                {"id": 2, "endpoint_url": "https://two.example.test///"},
            ],
        )
        migration = _install_migration(connection, monkeypatch)

        migration.upgrade()

        assert connection.execute(
            sa.text("SELECT endpoint_url FROM storage_endpoints ORDER BY id")
        ).scalars().all() == [
            "https://one.example.test",
            "https://two.example.test",
        ]
        checks = sa.inspect(connection).get_check_constraints(
            "storage_endpoints"
        )
        assert any(
            check["name"] == "ck_storage_endpoints_endpoint_url_canonical"
            for check in checks
        )
        with pytest.raises(IntegrityError):
            with connection.begin_nested():
                connection.execute(
                    sa.text(
                        "INSERT INTO storage_endpoints (id, endpoint_url) "
                        "VALUES (3, 'https://three.example.test/')"
                    )
                )

        migration.downgrade()

        checks = sa.inspect(connection).get_check_constraints(
            "storage_endpoints"
        )
        assert all(
            check["name"] != "ck_storage_endpoints_endpoint_url_canonical"
            for check in checks
        )
        connection.execute(
            sa.text(
                "INSERT INTO storage_endpoints (id, endpoint_url) "
                "VALUES (4, 'https://four.example.test/')"
            )
        )


@pytest.mark.parametrize(
    "endpoint_url",
    ["", "   ", "///"],
)
def test_migration_rejects_empty_endpoint_urls(monkeypatch, endpoint_url):
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    endpoints = _storage_endpoints(metadata)
    metadata.create_all(engine)

    with engine.begin() as connection:
        connection.execute(
            endpoints.insert().values(id=7, endpoint_url=endpoint_url)
        )
        migration = _install_migration(connection, monkeypatch)

        with pytest.raises(ValueError, match="empty endpoint URL"):
            migration.upgrade()


def test_migration_rejects_urls_that_collide_after_normalization(monkeypatch):
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    endpoints = _storage_endpoints(metadata)
    metadata.create_all(engine)

    with engine.begin() as connection:
        connection.execute(
            endpoints.insert(),
            [
                {"id": 8, "endpoint_url": "https://same.example.test/"},
                {"id": 9, "endpoint_url": " https://same.example.test "},
            ],
        )
        migration = _install_migration(connection, monkeypatch)

        with pytest.raises(ValueError, match="normalize to the same endpoint URL"):
            migration.upgrade()
