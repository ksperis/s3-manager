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
        / "0112_canonical_portal_storage_space_sharing.py"
    )
    spec = util.spec_from_file_location(
        "migration_0112_canonical_portal_storage_space_sharing",
        migration_path,
    )
    assert spec and spec.loader
    migration = util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def _create_schema(engine):
    metadata = sa.MetaData()
    storage_spaces = sa.Table(
        "portal_storage_space_metadata",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("visibility", sa.String(), nullable=False),
        sa.Column("share_scope", sa.String(), nullable=False),
        sa.Column("account_member_role", sa.String(), nullable=True),
        sa.CheckConstraint(
            "share_scope IN ('restricted', 'account')",
            name="ck_portal_storage_space_metadata_share_scope",
        ),
        sa.CheckConstraint(
            "account_member_role IS NULL OR account_member_role IN ('Viewer', 'Editor')",
            name="ck_portal_storage_space_metadata_account_member_role",
        ),
    )
    metadata.create_all(engine)
    return storage_spaces


def _install_operations(monkeypatch, migration, connection) -> None:
    monkeypatch.setattr(
        migration,
        "op",
        Operations(MigrationContext.configure(connection)),
    )


def test_migration_canonicalizes_sharing_metadata_and_enforces_combinations(monkeypatch):
    engine = sa.create_engine("sqlite:///:memory:")
    storage_spaces = _create_schema(engine)

    with engine.begin() as connection:
        connection.execute(
            storage_spaces.insert(),
            [
                {"id": 1, "visibility": "private", "share_scope": "account", "account_member_role": "Viewer"},
                {"id": 2, "visibility": "shared", "share_scope": "restricted", "account_member_role": "Editor"},
                {"id": 3, "visibility": "shared", "share_scope": "account", "account_member_role": None},
                {"id": 4, "visibility": "shared", "share_scope": "account", "account_member_role": "Viewer"},
            ],
        )
        migration = _load_migration()
        _install_operations(monkeypatch, migration, connection)

        migration.upgrade()

        rows = connection.execute(
            sa.text(
                "SELECT id, visibility, share_scope, account_member_role "
                "FROM portal_storage_space_metadata ORDER BY id"
            )
        ).all()
        assert rows == [
            (1, "private", "restricted", None),
            (2, "shared", "restricted", None),
            (3, "shared", "account", "Editor"),
            (4, "shared", "account", "Viewer"),
        ]

        for values in (
            {"id": 5, "visibility": "private", "share_scope": "account", "account_member_role": None},
            {"id": 6, "visibility": "private", "share_scope": "restricted", "account_member_role": "Viewer"},
            {"id": 7, "visibility": "shared", "share_scope": "restricted", "account_member_role": "Editor"},
            {"id": 8, "visibility": "shared", "share_scope": "account", "account_member_role": None},
        ):
            with pytest.raises(IntegrityError):
                with connection.begin_nested():
                    connection.execute(storage_spaces.insert().values(**values))

        migration.downgrade()

        connection.execute(
            storage_spaces.insert().values(
                id=9,
                visibility="private",
                share_scope="account",
                account_member_role="Viewer",
            )
        )
