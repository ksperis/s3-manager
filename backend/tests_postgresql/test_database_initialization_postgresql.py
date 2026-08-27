# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
import os
import uuid

from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from alembic.script import ScriptDirectory
import pytest
import sqlalchemy as sa
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db import Base
from app.services import database_initialization


def _postgresql_url() -> str:
    url = os.getenv("POSTGRES_TEST_DATABASE_URL", "").strip()
    if not url:
        pytest.skip("POSTGRES_TEST_DATABASE_URL is required for PostgreSQL integration tests")
    if not url.startswith(("postgresql://", "postgresql+psycopg2://")):
        pytest.fail("POSTGRES_TEST_DATABASE_URL must target PostgreSQL")
    return url


def test_postgresql_concurrent_startup_bootstraps_isolated_empty_schema(monkeypatch) -> None:
    database_url = _postgresql_url()
    schema_name = f"bucketreef_bootstrap_{uuid.uuid4().hex}"
    admin_engine = create_engine(database_url, pool_pre_ping=True)
    scoped_engine = None
    try:
        with admin_engine.begin() as connection:
            connection.execute(sa.text(f'CREATE SCHEMA "{schema_name}"'))

        scoped_engine = create_engine(
            database_url,
            connect_args={"options": f"-csearch_path={schema_name}"},
            pool_pre_ping=True,
        )
        session_factory = sessionmaker(bind=scoped_engine, autocommit=False, autoflush=False)
        monkeypatch.setattr(
            database_initialization.StorageEndpointsService,
            "sync_env_endpoints",
            lambda self: None,
        )
        monkeypatch.setattr(
            database_initialization.StorageEndpointsService,
            "env_endpoints_locked",
            lambda self: True,
        )
        barrier = Barrier(2)

        def initialize() -> None:
            barrier.wait(timeout=10)
            database_initialization.init_db(scoped_engine, session_factory)

        with ThreadPoolExecutor(max_workers=2) as executor:
            list(executor.map(lambda _index: initialize(), range(2)))

        with scoped_engine.connect() as connection:
            table_names = set(sa.inspect(connection).get_table_names())
            assert set(Base.metadata.tables).issubset(table_names)
            config = database_initialization._alembic_config()
            expected_head = ScriptDirectory.from_config(config).get_current_head()
            assert connection.scalar(sa.text("SELECT version_num FROM alembic_version")) == expected_head
            version_column = sa.inspect(connection).get_columns("alembic_version")[0]
            assert version_column["type"].length == 255
            context = MigrationContext.configure(connection, opts={"compare_type": True})
            assert compare_metadata(context, Base.metadata) == []
    finally:
        if scoped_engine is not None:
            scoped_engine.dispose()
        with admin_engine.begin() as connection:
            connection.execute(sa.text(f'DROP SCHEMA IF EXISTS "{schema_name}" CASCADE'))
        admin_engine.dispose()
