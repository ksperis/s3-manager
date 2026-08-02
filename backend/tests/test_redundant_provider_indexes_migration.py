# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from __future__ import annotations

from importlib import util
from pathlib import Path

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations


def _load_migration():
    migration_path = (
        Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "0076_remove_redundant_provider_indexes.py"
    )
    spec = util.spec_from_file_location(
        "migration_0076_remove_redundant_provider_indexes",
        migration_path,
    )
    assert spec and spec.loader
    migration = util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def test_migration_removes_only_indexes_duplicated_by_unique_constraints(monkeypatch):
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    for table_name in ("ldap_providers", "oidc_providers"):
        sa.Table(
            table_name,
            metadata,
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("provider_id", sa.String(), nullable=False, unique=True),
        )
    metadata.create_all(engine)

    with engine.begin() as connection:
        for table_name, index_name in (
            ("ldap_providers", "ix_ldap_providers_provider_id"),
            ("oidc_providers", "ix_oidc_providers_provider_id"),
        ):
            connection.execute(
                sa.text(
                    f'CREATE INDEX "{index_name}" ON "{table_name}" (provider_id)'
                )
            )

        migration = _load_migration()
        monkeypatch.setattr(
            migration,
            "op",
            Operations(MigrationContext.configure(connection)),
        )
        migration.upgrade()

        inspector = sa.inspect(connection)
        for table_name, index_name in migration.PROVIDER_INDEXES:
            assert index_name not in {
                index["name"] for index in inspector.get_indexes(table_name)
            }
            assert inspector.get_unique_constraints(table_name)

        migration.downgrade()
        inspector.clear_cache()
        for table_name, index_name in migration.PROVIDER_INDEXES:
            assert index_name in {
                index["name"] for index in inspector.get_indexes(table_name)
            }
