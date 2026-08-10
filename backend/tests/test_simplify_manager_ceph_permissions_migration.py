# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from __future__ import annotations

from importlib import util
import json
from pathlib import Path

from alembic.migration import MigrationContext
from alembic.operations import Operations
import pytest
import sqlalchemy as sa


def _load_migration():
    migration_path = (
        Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "0101_simplify_manager_ceph_permissions.py"
    )
    spec = util.spec_from_file_location("migration_0101_simplify_manager_ceph_permissions", migration_path)
    assert spec and spec.loader
    migration = util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def _create_legacy_schema(engine):
    metadata = sa.MetaData()
    users = sa.Table(
        "users",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("can_access_manager_bucket_quota", sa.Boolean(), nullable=False, server_default="0"),
        sa.Column("can_access_manager_ceph_s3_user_keys", sa.Boolean(), nullable=False, server_default="0"),
    )
    groups = sa.Table(
        "ui_groups",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("can_access_manager_bucket_quota", sa.Boolean(), nullable=False, server_default="0"),
        sa.Column("can_access_manager_ceph_s3_user_keys", sa.Boolean(), nullable=False, server_default="0"),
    )
    accounts = sa.Table(
        "s3_accounts",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("allow_manager_bucket_quota", sa.Boolean(), nullable=False, server_default="0"),
    )
    s3_users = sa.Table(
        "s3_users",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("allow_manager_bucket_quota", sa.Boolean(), nullable=False, server_default="0"),
        sa.Column("allow_manager_ceph_s3_user_keys", sa.Boolean(), nullable=False, server_default="0"),
    )
    settings = sa.Table(
        "app_settings",
        metadata,
        sa.Column("key", sa.String(), primary_key=True),
        sa.Column("payload_json", sa.Text(), nullable=False),
    )
    metadata.create_all(engine)
    return users, groups, accounts, s3_users, settings


def _operations(connection, monkeypatch):
    migration = _load_migration()
    monkeypatch.setattr(migration, "op", Operations(MigrationContext.configure(connection)))
    return migration


def _columns(connection, table: str) -> set[str]:
    return {column["name"] for column in sa.inspect(connection).get_columns(table)}


def test_migration_renames_grants_splits_private_opt_in_and_downgrades_least_privilege(monkeypatch):
    engine = sa.create_engine("sqlite:///:memory:")
    users, groups, accounts, s3_users, settings = _create_legacy_schema(engine)
    with engine.begin() as connection:
        connection.execute(users.insert().values(id=1, can_access_manager_bucket_quota=True, can_access_manager_ceph_s3_user_keys=True))
        connection.execute(groups.insert().values(id=1, can_access_manager_bucket_quota=True, can_access_manager_ceph_s3_user_keys=True))
        connection.execute(accounts.insert().values(id=1, allow_manager_bucket_quota=True))
        connection.execute(accounts.insert().values(id=2, allow_manager_bucket_quota=False))
        connection.execute(
            s3_users.insert().values(
                id=1,
                allow_manager_bucket_quota=True,
                allow_manager_ceph_s3_user_keys=True,
            )
        )
        connection.execute(
            settings.insert().values(
                key="default",
                payload_json=json.dumps(
                    {"general": {"manager_ceph_s3_user_keys_enabled": False}}
                ),
            )
        )
        connection.execute(settings.insert().values(key="defaults", payload_json="{}"))

        migration = _operations(connection, monkeypatch)
        migration.upgrade()

        assert "can_access_manager_bucket_quota" not in _columns(connection, "users")
        assert "can_access_manager_ceph_s3_user_keys" not in _columns(connection, "ui_groups")
        assert "allow_bucket_quota_management" in _columns(connection, "s3_accounts")
        assert {
            "allow_bucket_quota_management",
            "allow_access_key_management",
            "allow_managed_private_connection_provisioning",
        }.issubset(_columns(connection, "s3_users"))
        assert connection.execute(
            sa.text(
                "SELECT allow_bucket_quota_management FROM s3_accounts ORDER BY id"
            )
        ).all() == [(1,), (0,)]
        assert connection.execute(
            sa.text(
                "SELECT allow_bucket_quota_management, allow_access_key_management, "
                "allow_managed_private_connection_provisioning FROM s3_users WHERE id = 1"
            )
        ).one() == (1, 1, 1)
        payload = json.loads(
            connection.execute(sa.text("SELECT payload_json FROM app_settings WHERE key = 'default'")).scalar_one()
        )
        assert payload["general"] == {
            "bucket_quota_management_enabled": True,
            "ceph_s3_user_access_key_management_enabled": False,
        }
        defaults_payload = json.loads(
            connection.execute(
                sa.text("SELECT payload_json FROM app_settings WHERE key = 'defaults'")
            ).scalar_one()
        )
        assert defaults_payload["general"] == {
            "bucket_quota_management_enabled": True,
            "ceph_s3_user_access_key_management_enabled": True,
        }

        connection.execute(
            sa.text(
                "UPDATE s3_users SET allow_managed_private_connection_provisioning = FALSE WHERE id = 1"
            )
        )
        migration.downgrade()

        assert {
            "can_access_manager_bucket_quota",
            "can_access_manager_ceph_s3_user_keys",
        }.issubset(_columns(connection, "users"))
        assert connection.execute(
            sa.text(
                "SELECT can_access_manager_bucket_quota, "
                "can_access_manager_ceph_s3_user_keys FROM users WHERE id = 1"
            )
        ).one() == (0, 0)
        assert connection.execute(
            sa.text(
                "SELECT can_access_manager_bucket_quota, "
                "can_access_manager_ceph_s3_user_keys FROM ui_groups WHERE id = 1"
            )
        ).one() == (0, 0)
        assert connection.execute(
            sa.text("SELECT allow_manager_ceph_s3_user_keys FROM s3_users WHERE id = 1")
        ).scalar_one() == 0
        payload = json.loads(
            connection.execute(sa.text("SELECT payload_json FROM app_settings WHERE key = 'default'")).scalar_one()
        )
        assert payload["general"] == {"manager_ceph_s3_user_keys_enabled": False}


@pytest.mark.parametrize(
    "invalid_payload",
    [
        "{",
        json.dumps([]),
        json.dumps({"general": []}),
        json.dumps({"general": {"manager_ceph_s3_user_keys_enabled": 1}}),
        json.dumps({"general": {"bucket_quota_management_enabled": "yes"}}),
    ],
)
def test_migration_validates_all_settings_before_schema_mutation(monkeypatch, invalid_payload):
    engine = sa.create_engine("sqlite:///:memory:")
    _, _, _, _, settings = _create_legacy_schema(engine)
    with engine.begin() as connection:
        connection.execute(settings.insert().values(key="invalid", payload_json=invalid_payload))
        migration = _operations(connection, monkeypatch)

        with pytest.raises(ValueError, match="must (contain a JSON object|be a boolean)"):
            migration.upgrade()

        assert "allow_manager_bucket_quota" in _columns(connection, "s3_accounts")
        assert "allow_bucket_quota_management" not in _columns(connection, "s3_accounts")
        assert "can_access_manager_bucket_quota" in _columns(connection, "users")
