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
        / "0073_canonical_connection_owner_types.py"
    )
    spec = util.spec_from_file_location(
        "migration_0073_canonical_connection_owner_types",
        migration_path,
    )
    assert spec and spec.loader
    migration = util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def test_migration_canonicalizes_owner_types_and_enforces_the_contract(monkeypatch):
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    connections = sa.Table(
        "s3_connections",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("credential_owner_type", sa.String(), nullable=True),
    )
    metadata.create_all(engine)

    with engine.begin() as connection:
        connection.execute(
            connections.insert(),
            [
                {"id": 1, "credential_owner_type": "rgw_user"},
                {"id": 2, "credential_owner_type": " IAM_USER "},
                {"id": 3, "credential_owner_type": "custom"},
                {"id": 4, "credential_owner_type": None},
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
                "SELECT id, credential_owner_type FROM s3_connections ORDER BY id"
            )
        ).all()
        assert rows == [(1, "s3_user"), (2, "iam_user"), (3, None), (4, None)]
        with pytest.raises(IntegrityError):
            connection.execute(
                sa.text(
                    "INSERT INTO s3_connections (id, credential_owner_type) "
                    "VALUES (5, 'rgw_user')"
                )
            )

        migration.downgrade()
        connection.execute(
            sa.text(
                "INSERT INTO s3_connections (id, credential_owner_type) "
                "VALUES (6, 'rgw_user')"
            )
        )
