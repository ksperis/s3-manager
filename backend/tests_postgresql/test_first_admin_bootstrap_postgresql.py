# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import hashlib
import os
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
import sqlalchemy as sa
from sqlalchemy import create_engine
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker

from app.db import AuditLog, FirstAdminBootstrap, User
from app.services.first_admin_bootstrap_service import (
    FIRST_ADMIN_BOOTSTRAP_ID,
    FirstAdminBootstrapService,
    FirstAdminBootstrapUnavailableError,
)


PASSWORD = "correct horse battery staple"
EXPECTED_ALEMBIC_HEAD = "0120_bucket_ui_tag_definition_settings"


def _postgresql_url() -> str:
    url = os.getenv("POSTGRES_TEST_DATABASE_URL", "").strip()
    if not url:
        pytest.skip("POSTGRES_TEST_DATABASE_URL is required for PostgreSQL integration tests")
    if not url.startswith(("postgresql://", "postgresql+psycopg2://")):
        pytest.fail("POSTGRES_TEST_DATABASE_URL must target PostgreSQL")
    return url


def test_postgresql_migration_rotation_rollback_and_concurrent_consumption(monkeypatch):
    engine = create_engine(_postgresql_url(), pool_pre_ping=True)
    session_factory = sessionmaker(bind=engine, autocommit=False, autoflush=False)

    with engine.begin() as connection:
        revision = connection.scalar(sa.text("SELECT version_num FROM alembic_version"))
        assert revision == EXPECTED_ALEMBIC_HEAD
        version_column = sa.inspect(connection).get_columns("alembic_version")[0]
        assert version_column["type"].length >= len(EXPECTED_ALEMBIC_HEAD)
        columns = {
            column["name"]: column
            for column in sa.inspect(connection).get_columns("first_admin_bootstrap")
        }
        assert set(columns) >= {
            "token_digest",
            "issued_at",
            "expires_at",
            "consumed_at",
            "created_user_id",
        }
        assert columns["expires_at"]["type"].timezone is True
        connection.execute(
            sa.delete(AuditLog).where(
                AuditLog.action.in_(
                    [
                        "first_admin_bootstrap_issued",
                        "first_admin_bootstrap_completed",
                    ]
                )
            )
        )
        connection.execute(sa.delete(FirstAdminBootstrap))
        connection.execute(
            sa.delete(User).where(User.email.like("postgres-bootstrap-%@example.com"))
        )
        assert connection.scalar(sa.select(sa.func.count(User.id))) == 0

    with session_factory() as db:
        service = FirstAdminBootstrapService(db)
        first = service.issue_token()
        second = service.issue_token()
        row = db.get(FirstAdminBootstrap, FIRST_ADMIN_BOOTSTRAP_ID)
        assert row is not None
        assert first.token != second.token
        assert row.token_digest == hashlib.sha256(second.token.encode()).hexdigest()

        with pytest.raises(FirstAdminBootstrapUnavailableError):
            service.create_with_token(
                token=first.token,
                email="postgres-bootstrap-old@example.com",
                full_name=None,
                password=PASSWORD,
            )

        original_flush = db.flush
        failed = False

        def fail_once(*args, **kwargs):
            nonlocal failed
            if not failed:
                failed = True
                raise IntegrityError("forced", {}, RuntimeError("forced"))
            return original_flush(*args, **kwargs)

        monkeypatch.setattr(db, "flush", fail_once)
        with pytest.raises(FirstAdminBootstrapUnavailableError):
            service.create_with_token(
                token=second.token,
                email="postgres-bootstrap-rollback@example.com",
                full_name=None,
                password=PASSWORD,
            )
        monkeypatch.setattr(db, "flush", original_flush)
        assert db.query(User).count() == 0
        assert service.is_available() is True

    barrier = Barrier(2)

    def create(email: str) -> str:
        with session_factory() as db:
            barrier.wait(timeout=10)
            try:
                FirstAdminBootstrapService(db).create_with_token(
                    token=second.token,
                    email=email,
                    full_name="PostgreSQL Bootstrap Admin",
                    password=PASSWORD,
                )
            except FirstAdminBootstrapUnavailableError:
                return "unavailable"
            return "created"

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(
            executor.map(
                create,
                [
                    "postgres-bootstrap-one@example.com",
                    "postgres-bootstrap-two@example.com",
                ],
            )
        )

    with session_factory() as db:
        assert sorted(results) == ["created", "unavailable"]
        assert db.query(User).count() == 1
        row = db.get(FirstAdminBootstrap, FIRST_ADMIN_BOOTSTRAP_ID)
        assert row is not None
        assert row.consumed_at is not None
        assert row.token_digest is None
        audit = (
            db.query(AuditLog)
            .filter(AuditLog.action == "first_admin_bootstrap_completed")
            .one()
        )
        audit_text = " ".join(
            filter(
                None,
                [
                    audit.user_email,
                    audit.message,
                    audit.metadata_json,
                    audit.request_id,
                    audit.ip_address,
                    audit.user_agent,
                ],
            )
        )
        assert second.token not in audit_text

    engine.dispose()
