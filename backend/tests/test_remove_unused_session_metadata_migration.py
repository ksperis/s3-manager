# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from __future__ import annotations

from importlib import util
from pathlib import Path

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations


UNUSED_COLUMNS = {
    "revoked_by_user_id",
    "last_ip",
    "last_user_agent",
    "revoked_reason",
}


def _load_migration():
    migration_path = (
        Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "0096_remove_unused_session_metadata.py"
    )
    spec = util.spec_from_file_location(
        "migration_0096_remove_unused_session_metadata",
        migration_path,
    )
    assert spec and spec.loader
    migration = util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def _column_names(connection, table_name: str) -> set[str]:
    return {column["name"] for column in sa.inspect(connection).get_columns(table_name)}


def _index_names(connection, table_name: str) -> set[str]:
    return {index["name"] for index in sa.inspect(connection).get_indexes(table_name)}


def _foreign_key_names(connection, table_name: str) -> set[str | None]:
    return {constraint["name"] for constraint in sa.inspect(connection).get_foreign_keys(table_name)}


def test_migration_removes_and_restores_unused_session_metadata(monkeypatch):
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    users = sa.Table(
        "users",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
    )
    api_tokens = sa.Table(
        "api_tokens",
        metadata,
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column(
            "revoked_by_user_id",
            sa.Integer(),
            sa.ForeignKey(
                "users.id",
                name="fk_api_tokens_revoked_by_user_id_users",
            ),
            nullable=True,
        ),
        sa.Column("last_ip", sa.String(), nullable=True),
        sa.Column("last_user_agent", sa.String(), nullable=True),
        sa.Column("revoked_reason", sa.String(), nullable=True),
    )
    refresh_sessions = sa.Table(
        "refresh_sessions",
        metadata,
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column(
            "revoked_by_user_id",
            sa.Integer(),
            sa.ForeignKey(
                "users.id",
                name="fk_refresh_sessions_revoked_by_user_id_users",
            ),
            nullable=True,
        ),
        sa.Column("last_ip", sa.String(), nullable=True),
        sa.Column("last_user_agent", sa.String(), nullable=True),
        sa.Column("revoked_reason", sa.String(), nullable=True),
    )
    sa.Index("ix_api_tokens_revoked_by_user_id", api_tokens.c.revoked_by_user_id)
    sa.Index(
        "ix_refresh_sessions_revoked_by_user_id",
        refresh_sessions.c.revoked_by_user_id,
    )
    metadata.create_all(engine)

    with engine.begin() as connection:
        connection.execute(users.insert().values(id=1))
        connection.execute(
            api_tokens.insert().values(
                id="api-token",
                revoked_by_user_id=1,
                last_ip="192.0.2.10",
                last_user_agent="unused-agent",
                revoked_reason="unused-reason",
            )
        )
        connection.execute(
            refresh_sessions.insert().values(
                id="refresh-session",
                revoked_by_user_id=1,
                last_ip="192.0.2.20",
                last_user_agent="unused-agent",
                revoked_reason="unused-reason",
            )
        )

        migration = _load_migration()
        monkeypatch.setattr(
            migration,
            "op",
            Operations(MigrationContext.configure(connection)),
        )

        migration.upgrade()

        for table_name in ("api_tokens", "refresh_sessions"):
            assert UNUSED_COLUMNS.isdisjoint(_column_names(connection, table_name))
        api_token_id = connection.execute(sa.text("SELECT id FROM api_tokens")).scalar_one()
        refresh_session_id = connection.execute(
            sa.text("SELECT id FROM refresh_sessions")
        ).scalar_one()
        assert api_token_id == "api-token"
        assert refresh_session_id == "refresh-session"

        migration.downgrade()

        for table_name in ("api_tokens", "refresh_sessions"):
            assert UNUSED_COLUMNS <= _column_names(connection, table_name)
            selected_columns = ", ".join(sorted(UNUSED_COLUMNS))
            row = connection.execute(
                sa.text(f"SELECT {selected_columns} FROM {table_name}")
            ).one()
            assert tuple(row) == (None, None, None, None)
            assert f"ix_{table_name}_revoked_by_user_id" in _index_names(connection, table_name)
            assert (
                f"fk_{table_name}_revoked_by_user_id_users"
                in _foreign_key_names(connection, table_name)
            )
