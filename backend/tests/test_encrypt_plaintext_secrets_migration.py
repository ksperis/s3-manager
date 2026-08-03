# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from __future__ import annotations

from importlib import util
from pathlib import Path

from cryptography.fernet import Fernet
import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

from app.core.security import (
    clear_credential_keys_override,
    decrypt_secret,
    encrypt_secret,
    set_credential_keys_override,
)


SECRET_COLUMNS: dict[str, tuple[str, ...]] = {
    "storage_endpoints": (
        "admin_secret_key",
        "supervision_secret_key",
        "ceph_admin_secret_key",
    ),
    "s3_accounts": ("rgw_secret_key",),
    "account_iam_users": ("active_secret_key",),
    "s3_users": ("rgw_secret_key",),
    "s3_connections": ("secret_access_key", "session_token"),
    "ldap_providers": ("bind_password",),
    "oidc_providers": ("client_secret",),
    "s3_sessions": ("access_key_enc", "secret_key_enc"),
}


def _load_migration():
    migration_path = (
        Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "0098_encrypt_plaintext_secrets.py"
    )
    spec = util.spec_from_file_location(
        "migration_0098_encrypt_plaintext_secrets",
        migration_path,
    )
    assert spec and spec.loader
    migration = util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def _create_secret_tables(engine) -> dict[str, sa.Table]:
    metadata = sa.MetaData()
    tables = {
        table_name: sa.Table(
            table_name,
            metadata,
            sa.Column("id", sa.String(), primary_key=True),
            *(sa.Column(column_name, sa.String(), nullable=True) for column_name in column_names),
        )
        for table_name, column_names in SECRET_COLUMNS.items()
    }
    metadata.create_all(engine)
    return tables


def test_migration_encrypts_plaintext_and_preserves_decryptable_values(monkeypatch):
    engine = sa.create_engine("sqlite:///:memory:")
    tables = _create_secret_tables(engine)
    set_credential_keys_override(["migration-primary-key"])
    try:
        encrypted_values: dict[tuple[str, str], str] = {}
        with engine.begin() as connection:
            for table_name, column_names in SECRET_COLUMNS.items():
                plaintext_row = {"id": "plaintext"}
                encrypted_row = {"id": "encrypted"}
                for column_name in column_names:
                    plaintext_row[column_name] = f"plain-{table_name}-{column_name}"
                    encrypted_value = encrypt_secret(f"encrypted-{table_name}-{column_name}")
                    encrypted_values[(table_name, column_name)] = encrypted_value
                    encrypted_row[column_name] = encrypted_value
                connection.execute(tables[table_name].insert(), [plaintext_row, encrypted_row])

            migration = _load_migration()
            monkeypatch.setattr(
                migration,
                "op",
                Operations(MigrationContext.configure(connection)),
            )
            migration.upgrade()

            for table_name, column_names in SECRET_COLUMNS.items():
                rows = {
                    row["id"]: row
                    for row in connection.execute(sa.select(tables[table_name])).mappings()
                }
                for column_name in column_names:
                    plaintext = rows["plaintext"][column_name]
                    assert plaintext != f"plain-{table_name}-{column_name}"
                    assert decrypt_secret(plaintext) == f"plain-{table_name}-{column_name}"
                    assert rows["encrypted"][column_name] == encrypted_values[(table_name, column_name)]

            migration.downgrade()
    finally:
        clear_credential_keys_override()


def test_migration_rejects_fernet_tokens_without_their_historical_key(monkeypatch):
    engine = sa.create_engine("sqlite:///:memory:")
    tables = _create_secret_tables(engine)
    inaccessible_token = Fernet(Fernet.generate_key()).encrypt(b"secret").decode()
    set_credential_keys_override(["migration-primary-key"])
    try:
        with engine.begin() as connection:
            connection.execute(
                tables["storage_endpoints"].insert().values(
                    id="missing-key",
                    admin_secret_key=inaccessible_token,
                )
            )
            migration = _load_migration()
            monkeypatch.setattr(
                migration,
                "op",
                Operations(MigrationContext.configure(connection)),
            )

            with pytest.raises(RuntimeError, match="historical credential key"):
                migration.upgrade()
    finally:
        clear_credential_keys_override()
