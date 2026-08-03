# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from importlib import util
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations


def _load_migration():
    migration_path = (
        Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "0069_canonical_account_access_roles.py"
    )
    spec = util.spec_from_file_location("migration_0069_canonical_account_access_roles", migration_path)
    assert spec is not None and spec.loader is not None
    migration = util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def _create_legacy_schema(connection) -> None:
    metadata = sa.MetaData()
    sa.Table(
        "user_s3_accounts",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("account_id", sa.Integer(), nullable=False),
        sa.Column("is_root", sa.Boolean(), nullable=False, server_default="0"),
        sa.Column("account_admin", sa.Boolean(), nullable=False, server_default="0"),
        sa.Column("account_role", sa.String(), nullable=False, server_default="portal_none"),
    )
    sa.Table(
        "ui_group_s3_accounts",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("group_id", sa.Integer(), nullable=False),
        sa.Column("account_id", sa.Integer(), nullable=False),
        sa.Column("account_admin", sa.Boolean(), nullable=False, server_default="0"),
        sa.Column("account_role", sa.String(), nullable=False, server_default="portal_none"),
    )
    sa.Table(
        "s3_connections",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("is_shared", sa.Boolean(), nullable=False, server_default="0"),
        sa.Column("access_manager", sa.Boolean(), nullable=False, server_default="0"),
        sa.Column("access_browser", sa.Boolean(), nullable=False, server_default="1"),
    )
    metadata.create_all(connection)


def _install_operations(monkeypatch, migration, connection) -> None:
    monkeypatch.setattr(migration, "op", Operations(MigrationContext.configure(connection)))


def test_upgrade_requires_verified_backup_before_deleting_no_right_links(monkeypatch):
    engine = sa.create_engine("sqlite:///:memory:")
    with engine.begin() as connection:
        _create_legacy_schema(connection)
        connection.execute(
            sa.text(
                "INSERT INTO user_s3_accounts "
                "(id, user_id, account_id, is_root, account_admin, account_role) "
                "VALUES (1, 1, 1, 0, 0, 'portal_none')"
            )
        )
        migration = _load_migration()
        _install_operations(monkeypatch, migration, connection)
        monkeypatch.delenv("S3_MANAGER_DB_BACKUP_VERIFIED", raising=False)

        with pytest.raises(RuntimeError, match="restorable database backup"):
            migration.upgrade()

        columns = {column["name"] for column in sa.inspect(connection).get_columns("user_s3_accounts")}
        assert "role" not in columns
        assert connection.execute(sa.text("SELECT COUNT(*) FROM user_s3_accounts")).scalar_one() == 1


def test_upgrade_allows_empty_database_without_backup_override(monkeypatch):
    engine = sa.create_engine("sqlite:///:memory:")
    with engine.begin() as connection:
        _create_legacy_schema(connection)
        migration = _load_migration()
        _install_operations(monkeypatch, migration, connection)
        monkeypatch.delenv("S3_MANAGER_DB_BACKUP_VERIFIED", raising=False)

        migration.upgrade()

        direct_columns = {
            column["name"]
            for column in sa.inspect(connection).get_columns("user_s3_accounts")
        }
        group_columns = {
            column["name"]
            for column in sa.inspect(connection).get_columns("ui_group_s3_accounts")
        }
        assert "role" in direct_columns
        assert "role" in group_columns
        assert {"account_admin", "account_role"}.isdisjoint(direct_columns)
        assert {"account_admin", "account_role"}.isdisjoint(group_columns)


def test_upgrade_allows_convertible_links_without_backup_override(monkeypatch):
    engine = sa.create_engine("sqlite:///:memory:")
    with engine.begin() as connection:
        _create_legacy_schema(connection)
        connection.execute(
            sa.text(
                "INSERT INTO user_s3_accounts "
                "(id, user_id, account_id, is_root, account_admin, account_role) "
                "VALUES (1, 1, 1, 0, 0, 'portal_user')"
            )
        )
        connection.execute(
            sa.text(
                "INSERT INTO ui_group_s3_accounts "
                "(id, group_id, account_id, account_admin, account_role) "
                "VALUES (1, 1, 1, 0, 'portal_manager')"
            )
        )
        migration = _load_migration()
        _install_operations(monkeypatch, migration, connection)
        monkeypatch.delenv("S3_MANAGER_DB_BACKUP_VERIFIED", raising=False)

        migration.upgrade()

        assert connection.execute(
            sa.text("SELECT role FROM user_s3_accounts")
        ).scalar_one() == "portal_user"
        assert connection.execute(
            sa.text("SELECT role FROM ui_group_s3_accounts")
        ).scalar_one() == "portal_manager"


def test_upgrade_deletes_no_right_links_and_quarantines_shared_connections(monkeypatch):
    engine = sa.create_engine("sqlite:///:memory:")
    with engine.begin() as connection:
        _create_legacy_schema(connection)
        connection.execute(
            sa.text(
                "INSERT INTO user_s3_accounts "
                "(id, user_id, account_id, is_root, account_admin, account_role) VALUES "
                "(1, 1, 1, 0, 1, 'portal_user'), "
                "(2, 2, 1, 0, 0, 'portal_manager'), "
                "(3, 3, 1, 0, 0, 'portal_user'), "
                "(4, 4, 1, 1, 0, 'portal_none'), "
                "(5, 5, 1, 0, 0, 'portal_none')"
            )
        )
        connection.execute(
            sa.text(
                "INSERT INTO ui_group_s3_accounts "
                "(id, group_id, account_id, account_admin, account_role) VALUES "
                "(1, 1, 1, 1, 'portal_user'), "
                "(2, 2, 1, 0, 'portal_user'), "
                "(3, 3, 1, 0, 'portal_none')"
            )
        )
        connection.execute(
            sa.text(
                "INSERT INTO s3_connections "
                "(id, name, is_shared, access_manager, access_browser) VALUES "
                "(1, 'shared-ready', 1, 1, 1), "
                "(2, 'shared-remediation', 1, 0, 1), "
                "(3, 'private-owner', 0, 0, 1)"
            )
        )
        migration = _load_migration()
        _install_operations(monkeypatch, migration, connection)
        monkeypatch.setenv("S3_MANAGER_DB_BACKUP_VERIFIED", "true")

        migration.upgrade()

        direct_rows = connection.execute(
            sa.text("SELECT id, role, is_root FROM user_s3_accounts ORDER BY id")
        ).all()
        assert direct_rows == [
            (1, "account_administrator", 0),
            (2, "portal_manager", 0),
            (3, "portal_user", 0),
            (4, "account_administrator", 1),
        ]
        group_rows = connection.execute(
            sa.text("SELECT id, role FROM ui_group_s3_accounts ORDER BY id")
        ).all()
        assert group_rows == [
            (1, "account_administrator"),
            (2, "portal_user"),
        ]
        columns = {column["name"] for column in sa.inspect(connection).get_columns("user_s3_accounts")}
        assert {"account_admin", "account_role"}.isdisjoint(columns)
        assert "role" in columns
        connection_rows = connection.execute(
            sa.text(
                "SELECT id, access_manager, access_browser, remediation_required, remediation_reason "
                "FROM s3_connections ORDER BY id"
            )
        ).all()
        assert connection_rows == [
            (1, 1, 0, 0, None),
            (2, 0, 0, 1, "shared_connection_manager_access_disabled"),
            (3, 0, 1, 0, None),
        ]

        migration.downgrade()

        restored_rows = connection.execute(
            sa.text(
                "SELECT id, account_admin, account_role FROM user_s3_accounts ORDER BY id"
            )
        ).all()
        assert restored_rows == [
            (1, 1, "portal_manager"),
            (2, 0, "portal_manager"),
            (3, 0, "portal_user"),
            (4, 1, "portal_manager"),
        ]
        assert connection.execute(sa.text("SELECT COUNT(*) FROM user_s3_accounts WHERE id = 5")).scalar_one() == 0
        connection_columns = {
            column["name"] for column in sa.inspect(connection).get_columns("s3_connections")
        }
        assert {"remediation_required", "remediation_reason"}.isdisjoint(connection_columns)
