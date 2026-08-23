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
    path = (
        Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "0116_canonical_storage_endpoint_providers.py"
    )
    spec = util.spec_from_file_location(
        "migration_0116_canonical_storage_endpoint_providers",
        path,
    )
    assert spec and spec.loader
    migration = util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def test_migration_canonicalizes_and_constrains_endpoint_providers(monkeypatch):
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    endpoints = sa.Table(
        "storage_endpoints",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("provider", sa.String(), nullable=False),
    )
    metadata.create_all(engine)

    with engine.begin() as connection:
        connection.execute(
            endpoints.insert(),
            [
                {"id": 1, "provider": " CEPH "},
                {"id": 2, "provider": "Aws"},
                {"id": 3, "provider": "other"},
                {"id": 4, "provider": "swift"},
                {"id": 5, "provider": ""},
            ],
        )
        migration = _load_migration()
        monkeypatch.setattr(
            migration,
            "op",
            Operations(MigrationContext.configure(connection)),
        )

        migration.upgrade()

        assert connection.execute(
            sa.text("SELECT provider FROM storage_endpoints ORDER BY id")
        ).scalars().all() == ["ceph", "aws", "other", "ceph", "ceph"]
        checks = sa.inspect(connection).get_check_constraints(
            "storage_endpoints"
        )
        assert any(
            check["name"] == "ck_storage_endpoints_provider"
            for check in checks
        )
        with pytest.raises(IntegrityError):
            with connection.begin_nested():
                connection.execute(
                    sa.text(
                        "INSERT INTO storage_endpoints (id, provider) "
                        "VALUES (6, 'swift')"
                    )
                )

        migration.downgrade()

        checks = sa.inspect(connection).get_check_constraints(
            "storage_endpoints"
        )
        assert all(
            check["name"] != "ck_storage_endpoints_provider"
            for check in checks
        )
        connection.execute(
            sa.text(
                "INSERT INTO storage_endpoints (id, provider) "
                "VALUES (7, 'swift')"
            )
        )
