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
    path = (
        Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "0122_split_account_access_roles.py"
    )
    spec = util.spec_from_file_location("migration_0122_split_account_access_roles", path)
    assert spec and spec.loader
    migration = util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def _create_legacy_schema(connection) -> None:
    metadata = sa.MetaData()
    sa.Table(
        "users",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("is_root", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    sa.Table(
        "user_s3_accounts",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("account_id", sa.Integer(), nullable=False),
        sa.Column("role", sa.String(), nullable=False),
        sa.Column("is_root", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column(
            "allow_manager_browser_data_access",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
        sa.CheckConstraint(
            "role IN ('portal_user', 'portal_manager', 'account_administrator')",
            name="ck_user_s3_accounts_role",
        ),
    )
    sa.Table(
        "ui_group_s3_accounts",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("group_id", sa.Integer(), nullable=False),
        sa.Column("account_id", sa.Integer(), nullable=False),
        sa.Column("role", sa.String(), nullable=False),
        sa.Column(
            "allow_manager_browser_data_access",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
        sa.CheckConstraint(
            "role IN ('portal_user', 'portal_manager', 'account_administrator')",
            name="ck_ui_group_s3_accounts_role",
        ),
    )
    metadata.create_all(connection)


def _install_operations(monkeypatch, migration, connection) -> None:
    monkeypatch.setattr(
        migration,
        "op",
        Operations(MigrationContext.configure(connection)),
    )


def test_upgrade_splits_roles_removes_root_flags_and_enforces_constraints(monkeypatch):
    engine = sa.create_engine("sqlite:///:memory:")
    with engine.begin() as connection:
        _create_legacy_schema(connection)
        connection.execute(sa.text("INSERT INTO users (id, is_root) VALUES (1, 1), (2, 0)"))
        connection.execute(
            sa.text(
                "INSERT INTO user_s3_accounts "
                "(id, user_id, account_id, role, is_root, allow_manager_browser_data_access) VALUES "
                "(1, 1, 1, 'portal_user', 0, 0), "
                "(2, 2, 1, 'portal_manager', 0, 0), "
                "(3, 2, 2, 'account_administrator', 0, 1), "
                "(4, 1, 3, 'portal_manager', 1, 1)"
            )
        )
        connection.execute(
            sa.text(
                "INSERT INTO ui_group_s3_accounts "
                "(id, group_id, account_id, role, allow_manager_browser_data_access) VALUES "
                "(1, 1, 1, 'portal_user', 0), "
                "(2, 2, 1, 'portal_manager', 0), "
                "(3, 3, 1, 'account_administrator', 1)"
            )
        )
        migration = _load_migration()
        _install_operations(monkeypatch, migration, connection)

        migration.upgrade()

        assert connection.execute(
            sa.text(
                "SELECT id, manager_role, portal_role, allow_manager_browser_data_access "
                "FROM user_s3_accounts ORDER BY id"
            )
        ).all() == [
            (1, None, "portal_user", 0),
            (2, None, "portal_manager", 0),
            (3, "account_administrator", None, 1),
            (4, "account_administrator", None, 1),
        ]
        assert connection.execute(
            sa.text(
                "SELECT id, manager_role, portal_role, allow_manager_browser_data_access "
                "FROM ui_group_s3_accounts ORDER BY id"
            )
        ).all() == [
            (1, None, "portal_user", 0),
            (2, None, "portal_manager", 0),
            (3, "account_administrator", None, 1),
        ]

        inspector = sa.inspect(connection)
        assert "is_root" not in {column["name"] for column in inspector.get_columns("users")}
        direct_columns = {column["name"] for column in inspector.get_columns("user_s3_accounts")}
        assert "role" not in direct_columns
        assert "is_root" not in direct_columns
        assert {"manager_role", "portal_role"} <= direct_columns
        direct_checks = {
            constraint["name"]: constraint["sqltext"]
            for constraint in inspector.get_check_constraints("user_s3_accounts")
        }
        assert {
            "ck_user_s3_accounts_manager_role",
            "ck_user_s3_accounts_portal_role",
            "ck_user_s3_accounts_has_role",
            "ck_user_s3_accounts_manager_browser_role",
        } <= direct_checks.keys()
        assert direct_checks["ck_user_s3_accounts_has_role"] == (
            "manager_role IS NOT NULL OR portal_role IS NOT NULL"
        )
        assert direct_checks["ck_user_s3_accounts_manager_browser_role"] == (
            "allow_manager_browser_data_access IS FALSE OR "
            "manager_role = 'account_administrator'"
        )
        assert connection.exec_driver_sql("PRAGMA ignore_check_constraints").scalar_one() == 0


def test_upgrade_resumes_after_sqlite_added_split_columns_without_version_stamp(
    monkeypatch,
):
    engine = sa.create_engine("sqlite:///:memory:")
    with engine.begin() as connection:
        _create_legacy_schema(connection)
        connection.execute(sa.text("INSERT INTO users (id, is_root) VALUES (1, 0)"))
        connection.execute(
            sa.text(
                "INSERT INTO user_s3_accounts "
                "(id, user_id, account_id, role, is_root, allow_manager_browser_data_access) VALUES "
                "(1, 1, 1, 'portal_user', 0, 0), "
                "(2, 1, 2, 'portal_manager', 1, 1)"
            )
        )
        connection.execute(
            sa.text(
                "INSERT INTO ui_group_s3_accounts "
                "(id, group_id, account_id, role, allow_manager_browser_data_access) "
                "VALUES (1, 1, 1, 'account_administrator', 1)"
            )
        )
        connection.exec_driver_sql(
            "ALTER TABLE user_s3_accounts ADD COLUMN manager_role VARCHAR"
        )
        connection.exec_driver_sql(
            "ALTER TABLE user_s3_accounts ADD COLUMN portal_role VARCHAR"
        )
        migration = _load_migration()
        _install_operations(monkeypatch, migration, connection)

        migration.upgrade()
        migration.upgrade()

        assert connection.execute(
            sa.text(
                "SELECT id, manager_role, portal_role, allow_manager_browser_data_access "
                "FROM user_s3_accounts ORDER BY id"
            )
        ).all() == [
            (1, None, "portal_user", 0),
            (2, "account_administrator", None, 1),
        ]
        assert connection.execute(
            sa.text(
                "SELECT manager_role, portal_role, allow_manager_browser_data_access "
                "FROM ui_group_s3_accounts"
            )
        ).one() == ("account_administrator", None, 1)

        inspector = sa.inspect(connection)
        assert "role" not in {
            column["name"]
            for column in inspector.get_columns("user_s3_accounts")
        }
        assert "is_root" not in {
            column["name"] for column in inspector.get_columns("users")
        }


def test_downgrade_refuses_combined_roles_before_changing_schema(monkeypatch):
    engine = sa.create_engine("sqlite:///:memory:")
    with engine.begin() as connection:
        _create_legacy_schema(connection)
        connection.execute(sa.text("INSERT INTO users (id, is_root) VALUES (1, 0)"))
        connection.execute(
            sa.text(
                "INSERT INTO user_s3_accounts "
                "(id, user_id, account_id, role, is_root, allow_manager_browser_data_access) "
                "VALUES (1, 1, 1, 'portal_manager', 0, 0)"
            )
        )
        migration = _load_migration()
        _install_operations(monkeypatch, migration, connection)
        migration.upgrade()
        connection.execute(
            sa.text(
                "UPDATE user_s3_accounts "
                "SET manager_role = 'account_administrator' WHERE id = 1"
            )
        )

        with pytest.raises(RuntimeError, match="both Manager and Portal access"):
            migration.downgrade()

        columns = {
            column["name"]
            for column in sa.inspect(connection).get_columns("user_s3_accounts")
        }
        assert {"manager_role", "portal_role"} <= columns
        assert "role" not in columns
        assert "is_root" not in {
            column["name"] for column in sa.inspect(connection).get_columns("users")
        }
