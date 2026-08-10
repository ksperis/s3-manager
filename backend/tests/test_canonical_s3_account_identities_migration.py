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
        / "0104_canonical_s3_account_identities.py"
    )
    spec = util.spec_from_file_location(
        "migration_0104_canonical_s3_account_identities",
        migration_path,
    )
    assert spec and spec.loader
    migration = util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def _create_schema(engine):
    metadata = sa.MetaData()
    accounts = sa.Table(
        "s3_accounts",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("rgw_account_id", sa.String(), nullable=True),
        sa.Column("rgw_user_uid", sa.String(), nullable=True),
    )
    metadata.create_all(engine)
    return accounts


def _install_operations(monkeypatch, migration, connection) -> None:
    monkeypatch.setattr(
        migration,
        "op",
        Operations(MigrationContext.configure(connection)),
    )


def test_migration_enforces_complete_nonempty_rgw_identities(monkeypatch):
    engine = sa.create_engine("sqlite:///:memory:")
    accounts = _create_schema(engine)

    with engine.begin() as connection:
        connection.execute(
            accounts.insert().values(
                id=1,
                name="canonical",
                rgw_account_id="RGW0001",
                rgw_user_uid="rgw0001-admin",
            )
        )
        migration = _load_migration()
        _install_operations(monkeypatch, migration, connection)

        migration.upgrade()

        columns = {
            column["name"]: column
            for column in sa.inspect(connection).get_columns("s3_accounts")
        }
        assert columns["rgw_account_id"]["nullable"] is False
        assert columns["rgw_user_uid"]["nullable"] is False
        for values in (
            {
                "id": 2,
                "name": "missing-account-id",
                "rgw_account_id": None,
                "rgw_user_uid": "uid-2",
            },
            {
                "id": 3,
                "name": "blank-root-uid",
                "rgw_account_id": "RGW0003",
                "rgw_user_uid": "  ",
            },
        ):
            with pytest.raises(IntegrityError):
                with connection.begin_nested():
                    connection.execute(accounts.insert().values(**values))

        migration.downgrade()

        columns = {
            column["name"]: column
            for column in sa.inspect(connection).get_columns("s3_accounts")
        }
        assert columns["rgw_account_id"]["nullable"] is True
        assert columns["rgw_user_uid"]["nullable"] is True
        connection.execute(
            sa.text(
                "INSERT INTO s3_accounts "
                "(id, name, rgw_account_id, rgw_user_uid) "
                "VALUES (4, 'legacy', NULL, NULL)"
            )
        )


@pytest.mark.parametrize(
    ("rgw_account_id", "rgw_user_uid"),
    [
        (None, "root-uid"),
        ("", "root-uid"),
        ("RGW0001", None),
        ("RGW0001", "  "),
    ],
)
def test_migration_rejects_incomplete_existing_identities(
    monkeypatch,
    rgw_account_id,
    rgw_user_uid,
):
    engine = sa.create_engine("sqlite:///:memory:")
    accounts = _create_schema(engine)

    with engine.begin() as connection:
        connection.execute(
            accounts.insert().values(
                id=7,
                name="incomplete",
                rgw_account_id=rgw_account_id,
                rgw_user_uid=rgw_user_uid,
            )
        )
        migration = _load_migration()
        _install_operations(monkeypatch, migration, connection)

        with pytest.raises(RuntimeError, match="Repair rgw_account_id and rgw_user_uid"):
            migration.upgrade()
