# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic import command
from alembic.config import Config

from app.core.config import get_settings


def _config() -> Config:
    config = Config(str(Path(__file__).resolve().parents[1] / "alembic.ini"))
    config.attributes["configure_logger"] = False
    return config


def _load_cutover_migration():
    path = Path(__file__).resolve().parents[1] / "alembic" / "versions" / "0109_authentication_cutover.py"
    spec = importlib.util.spec_from_file_location("authentication_cutover_migration", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_cutover_migrates_subjects_and_revokes_every_legacy_authenticator(tmp_path, monkeypatch):
    database_path = tmp_path / "authentication-cutover.sqlite"
    database_url = f"sqlite:///{database_path}"
    monkeypatch.setenv("DATABASE_URL", database_url)
    get_settings.cache_clear()
    try:
        command.upgrade(_config(), "0106_remove_temporary_s3_connections")
        engine = sa.create_engine(database_url)
        with engine.begin() as connection:
            connection.execute(sa.text(
                "INSERT INTO users (id, email, is_active, role, is_root, auth_provider, "
                "auth_provider_subject, updated_at) VALUES "
                "(1, 'oidc@example.com', 1, 'ui_user', 0, 'company', 'subject-1', CURRENT_TIMESTAMP), "
                "(2, 'ldap@example.com', 1, 'ui_user', 0, 'ldap:directory', 'uid=ldap', CURRENT_TIMESTAMP)"
            ))
            connection.execute(sa.text(
                "INSERT INTO api_tokens (id, jti, token_hash, user_id, name, created_at, expires_at) "
                "VALUES ('api-1', 'jti-1', 'hash-1', 1, 'legacy', CURRENT_TIMESTAMP, '2099-01-01 00:00:00')"
            ))
            connection.execute(sa.text(
                "INSERT INTO s3_sessions (id, access_key_enc, secret_key_enc, access_key_hash, actor_type, role, "
                "capabilities, created_at, last_used_at) VALUES "
                "('s3-1', 'encrypted-access', 'encrypted-secret', 'key-hash', 's3_account', 'ui_user', '{}', "
                "CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
            ))
            connection.execute(sa.text(
                "INSERT INTO refresh_sessions (id, token_hash, user_id, auth_type, created_at, last_used_at, expires_at) "
                "VALUES ('refresh-1', 'refresh-hash', 1, 'password', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, "
                "'2099-01-01 00:00:00')"
            ))
            connection.execute(sa.text(
                "INSERT INTO oidc_login_states (state, provider, code_verifier, nonce, created_at) "
                "VALUES ('state-1', 'company', 'verifier', 'nonce', CURRENT_TIMESTAMP)"
            ))
        engine.dispose()

        monkeypatch.setenv("S3_MANAGER_DB_BACKUP_VERIFIED", "true")
        command.upgrade(_config(), "head")
        engine = sa.create_engine(database_url)
        with engine.connect() as connection:
            inspector = sa.inspect(connection)
            user_columns = {column["name"] for column in inspector.get_columns("users")}
            assert "auth_provider" not in user_columns
            assert "auth_provider_subject" not in user_columns
            assert "refresh_sessions" not in inspector.get_table_names()
            identities = connection.execute(sa.text(
                "SELECT provider_type, provider_id, subject, email_verified "
                "FROM external_identities ORDER BY provider_type"
            )).mappings().all()
            assert identities == [
                {"provider_type": "ldap", "provider_id": "directory", "subject": "uid=ldap", "email_verified": 0},
                {"provider_type": "oidc", "provider_id": "company", "subject": "subject-1", "email_verified": 0},
            ]
            assert connection.scalar(sa.text("SELECT COUNT(*) FROM s3_sessions")) == 0
            assert connection.scalar(sa.text("SELECT COUNT(*) FROM oidc_login_states")) == 0
            token = connection.execute(sa.text(
                "SELECT scopes_json, auth_version, revoked_at FROM api_tokens WHERE id = 'api-1'"
            )).mappings().one()
            assert token["scopes_json"] == "[]"
            assert token["auth_version"] == 1
            assert token["revoked_at"] is not None
        engine.dispose()
    finally:
        get_settings.cache_clear()


def test_cutover_downgrade_requires_restoring_the_predeployment_backup():
    with pytest.raises(RuntimeError, match="irreversible.*backup"):
        _load_cutover_migration().downgrade()


def test_cutover_refuses_to_erase_live_authenticators_without_verified_backup(tmp_path, monkeypatch):
    database_path = tmp_path / "authentication-cutover-backup-guard.sqlite"
    database_url = f"sqlite:///{database_path}"
    monkeypatch.setenv("DATABASE_URL", database_url)
    monkeypatch.delenv("S3_MANAGER_DB_BACKUP_VERIFIED", raising=False)
    get_settings.cache_clear()
    try:
        command.upgrade(_config(), "0106_remove_temporary_s3_connections")
        engine = sa.create_engine(database_url)
        with engine.begin() as connection:
            connection.execute(sa.text(
                "INSERT INTO s3_sessions (id, access_key_enc, secret_key_enc, access_key_hash, actor_type, role, "
                "capabilities, created_at, last_used_at) VALUES "
                "('s3-live', 'encrypted-access', 'encrypted-secret', 'key-hash', 's3_account', 'ui_user', '{}', "
                "CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
            ))
        engine.dispose()

        with pytest.raises(RuntimeError, match="restorable database backup"):
            command.upgrade(_config(), "head")
    finally:
        get_settings.cache_clear()
