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
        / "0111_auth_schema_drift_repair.py"
    )
    spec = util.spec_from_file_location("migration_0111_auth_schema_drift_repair", migration_path)
    assert spec and spec.loader
    migration = util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def _create_drifted_schema(engine) -> None:
    metadata = sa.MetaData()
    users = sa.Table(
        "users",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("email", sa.String(), nullable=False),
        sa.Column("auth_provider", sa.String(), nullable=True),
        sa.Column("auth_provider_subject", sa.String(), nullable=True),
        sa.UniqueConstraint(
            "auth_provider",
            "auth_provider_subject",
            name="uq_users_provider_subject",
        ),
    )
    auth_sessions = sa.Table(
        "auth_sessions",
        metadata,
        sa.Column("id", sa.String(), primary_key=True),
    )
    external_identities = sa.Table(
        "external_identities",
        metadata,
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("provider_type", sa.String(), nullable=False),
        sa.Column("provider_id", sa.String(), nullable=False),
        sa.Column("subject", sa.String(), nullable=False),
        sa.Column("email", sa.String(), nullable=True),
        sa.Column("email_verified", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint(
            "provider_type",
            "provider_id",
            "subject",
            name="uq_external_identity_subject",
        ),
    )
    auth_challenges = sa.Table(
        "auth_challenges",
        metadata,
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column(
            "auth_session_id",
            sa.String(),
            sa.ForeignKey("auth_sessions.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("purpose", sa.String(), nullable=False),
        sa.Column("challenge_hash", sa.String(), nullable=False, unique=True),
        sa.Column("payload_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=True),
    )
    sa.Index("ix_auth_challenges_user_id", auth_challenges.c.user_id)
    sa.Index("ix_auth_challenges_auth_session_id", auth_challenges.c.auth_session_id)
    sa.Index("ix_auth_challenges_purpose", auth_challenges.c.purpose)
    sa.Index("ix_auth_challenges_expires_at", auth_challenges.c.expires_at)
    metadata.create_all(engine)

    with engine.begin() as connection:
        connection.execute(
            users.insert(),
            [
                {
                    "id": 1,
                    "email": "oidc@example.com",
                    "auth_provider": "company",
                    "auth_provider_subject": "oidc-subject",
                },
                {
                    "id": 2,
                    "email": "ldap@example.com",
                    "auth_provider": "ldap:directory",
                    "auth_provider_subject": "uid=ldap",
                },
            ],
        )
        connection.execute(auth_sessions.insert().values(id="session-1"))
        connection.execute(
            external_identities.insert().values(
                id="existing-ldap",
                user_id=2,
                provider_type="ldap",
                provider_id="directory",
                subject="uid=ldap",
                email="ldap@example.com",
                email_verified=False,
                created_at=sa.func.now(),
            )
        )
        connection.execute(
            auth_challenges.insert().values(
                id="challenge-1",
                user_id=1,
                auth_session_id="session-1",
                purpose="webauthn_register",
                challenge_hash="challenge-hash",
                payload_json="{}",
                created_at=sa.func.now(),
                expires_at=sa.func.now(),
            )
        )


def test_migration_repairs_pre_release_auth_schema_drift(monkeypatch):
    engine = sa.create_engine("sqlite:///:memory:")
    _create_drifted_schema(engine)
    migration = _load_migration()

    with engine.begin() as connection:
        monkeypatch.setattr(
            migration,
            "op",
            Operations(MigrationContext.configure(connection)),
        )
        migration.upgrade()

        inspector = sa.inspect(connection)
        assert "oidc_authorization_codes" in inspector.get_table_names()
        oidc_indexes = {index["name"] for index in inspector.get_indexes("oidc_authorization_codes")}
        assert oidc_indexes == {
            "ix_oidc_authorization_codes_code_hash",
            "ix_oidc_authorization_codes_expires_at",
            "ix_oidc_authorization_codes_provider",
        }

        challenge_columns = {
            column["name"] for column in inspector.get_columns("auth_challenges")
        }
        assert "binding_sid" in challenge_columns
        assert "auth_session_id" not in challenge_columns
        challenge_indexes = {
            index["name"] for index in inspector.get_indexes("auth_challenges")
        }
        assert "ix_auth_challenges_binding_sid" in challenge_indexes
        assert "ix_auth_challenges_auth_session_id" not in challenge_indexes
        assert connection.scalar(sa.text("SELECT COUNT(*) FROM auth_challenges")) == 0

        user_columns = {column["name"] for column in inspector.get_columns("users")}
        assert "auth_provider" not in user_columns
        assert "auth_provider_subject" not in user_columns
        identities = connection.execute(
            sa.text(
                "SELECT provider_type, provider_id, subject FROM external_identities "
                "ORDER BY provider_type"
            )
        ).mappings().all()
        assert identities == [
            {
                "provider_type": "ldap",
                "provider_id": "directory",
                "subject": "uid=ldap",
            },
            {
                "provider_type": "oidc",
                "provider_id": "company",
                "subject": "oidc-subject",
            },
        ]

        # The repair is intentionally idempotent for installations that only
        # contain part of the pre-release drift.
        migration.upgrade()
        assert connection.scalar(sa.text("SELECT COUNT(*) FROM external_identities")) == 2
