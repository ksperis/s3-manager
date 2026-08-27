# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import logging
from contextlib import contextmanager
from pathlib import Path
from urllib.parse import urlparse

from alembic import command
from alembic.config import Config
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import is_postgresql_url, is_sqlite_url, sqlite_integrity_status
from app.db import LdapProvider, OidcProvider
from app.services.storage_endpoints_service import StorageEndpointsService


settings = get_settings()
logger = logging.getLogger(__name__)
_POSTGRES_STARTUP_LOCK_ID = 2_026_070_300_001


def _validate_persisted_auth_providers(db: Session) -> None:
    if settings.app_env != "production":
        return
    for provider in db.query(OidcProvider).filter(OidcProvider.enabled.is_(True)).all():
        discovery = urlparse(provider.discovery_url)
        redirect = urlparse(provider.redirect_uri)
        if discovery.scheme != "https" or not discovery.hostname:
            raise RuntimeError(f"OIDC provider {provider.provider_id} must use HTTPS discovery in production")
        if redirect.scheme != "https" or redirect.netloc != urlparse(settings.public_origin).netloc:
            raise RuntimeError(f"OIDC provider {provider.provider_id} redirect must use PUBLIC_ORIGIN in production")
        if not provider.use_pkce or not provider.use_nonce:
            raise RuntimeError(f"OIDC provider {provider.provider_id} must require PKCE and nonce in production")
    for provider in db.query(LdapProvider).filter(LdapProvider.enabled.is_(True)).all():
        scheme = urlparse(provider.url).scheme
        encrypted_transport = scheme == "ldaps" or (scheme == "ldap" and provider.start_tls)
        if (
            not encrypted_transport
            or provider.allow_insecure
            or not provider.tls_verify
            or provider.allow_legacy_tls
        ):
            raise RuntimeError(f"LDAP provider {provider.provider_id} violates the production TLS policy")


def _alembic_config() -> Config:
    base_dir = Path(__file__).resolve().parents[2]
    config = Config(str(base_dir / "alembic.ini"))
    config.set_main_option("script_location", str(base_dir / "alembic"))
    config.set_main_option("sqlalchemy.url", settings.database_url)
    config.attributes["configure_logger"] = False
    return config


@contextmanager
def _postgres_startup_lock(engine):
    if not is_postgresql_url(str(engine.url)):
        yield
        return
    with engine.connect() as connection:
        logger.info("Acquiring PostgreSQL startup advisory lock %s", _POSTGRES_STARTUP_LOCK_ID)
        connection.execute(text("SELECT pg_advisory_lock(:lock_id)"), {"lock_id": _POSTGRES_STARTUP_LOCK_ID})
        try:
            yield
        finally:
            connection.execute(text("SELECT pg_advisory_unlock(:lock_id)"), {"lock_id": _POSTGRES_STARTUP_LOCK_ID})
            logger.info("Released PostgreSQL startup advisory lock %s", _POSTGRES_STARTUP_LOCK_ID)


def _init_db_locked(engine, session_factory) -> None:
    integrity_ok, integrity_details = sqlite_integrity_status(engine)
    if is_sqlite_url(settings.database_url) and not integrity_ok:
        raise RuntimeError(
            "SQLite database integrity check failed before startup. "
            "Stop the backend, back up the database files, run `sqlite3 <db> 'PRAGMA integrity_check;'`, "
            f"then restore or rebuild the database before retrying. Details: {integrity_details}"
        )
    command.upgrade(_alembic_config(), "head")
    integrity_ok, integrity_details = sqlite_integrity_status(engine)
    if is_sqlite_url(settings.database_url) and not integrity_ok:
        raise RuntimeError(
            "SQLite database integrity check failed after migrations. "
            "Stop the backend, back up the database files, run `sqlite3 <db> 'PRAGMA integrity_check;'`, "
            f"then restore or rebuild the database before retrying. Details: {integrity_details}"
        )
    db: Session = session_factory()
    try:
        from app.services.auth_session_service import AuthSessionService

        expired_sessions = AuthSessionService(db).cleanup_expired()
        if expired_sessions:
            logger.info("Revoked %s expired authentication session row(s) during startup", expired_sessions)
        _validate_persisted_auth_providers(db)
        # Ensure env-managed endpoints or default endpoint are registered
        storage_service = StorageEndpointsService(db)
        storage_service.sync_env_endpoints()
        if not storage_service.env_endpoints_locked():
            storage_service.ensure_default_endpoint()
    finally:
        db.close()


def init_db(engine, session_factory) -> None:
    with _postgres_startup_lock(engine):
        _init_db_locked(engine, session_factory)
