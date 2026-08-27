# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import os
from importlib import util
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

from app.db import TagDefinition, User, UserRole


EXPECTED_ALEMBIC_HEAD = "0120_bucket_ui_tag_definition_settings"
INDEX_NAME = "uq_tag_definitions_bucket_ui_ceph_admin_label"


def _postgresql_url() -> str:
    url = os.getenv("POSTGRES_TEST_DATABASE_URL", "").strip()
    if not url:
        pytest.skip("POSTGRES_TEST_DATABASE_URL is required for PostgreSQL integration tests")
    if not url.startswith(("postgresql://", "postgresql+psycopg2://")):
        pytest.fail("POSTGRES_TEST_DATABASE_URL must target PostgreSQL")
    return url


def _load_migration():
    path = (
        Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "0120_bucket_ui_tag_definition_settings.py"
    )
    spec = util.spec_from_file_location(
        "migration_0120_bucket_ui_tag_definition_settings_postgresql",
        path,
    )
    assert spec is not None and spec.loader is not None
    migration = util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def test_postgresql_bucket_ui_tag_definition_settings_migration():
    engine = sa.create_engine(_postgresql_url(), pool_pre_ping=True)
    marker = "postgres-0120-collision"
    inserted: list[int] = []
    storage_id: int | None = None
    with engine.begin() as connection:
        assert (
            connection.scalar(sa.text("SELECT version_num FROM alembic_version"))
            == EXPECTED_ALEMBIC_HEAD
        )
        migration = _load_migration()
        migration.op = Operations(MigrationContext.configure(connection))
        definitions = TagDefinition.__table__
        users = User.__table__
        owner_ids = [
            int(
                connection.execute(
                    users.insert()
                    .values(
                        email=f"{marker}-{suffix}@example.test",
                        full_name=f"Migration owner {suffix}",
                        hashed_password="x",
                        is_active=True,
                        role=UserRole.UI_ADMIN.value,
                    )
                    .returning(users.c.id)
                ).scalar_one()
            )
            for suffix in ("one", "two")
        ]
        try:
            migration.downgrade()
            for owner_user_id, label, color_key in (
                (None, marker, "amber"),
                (owner_ids[0], marker.upper(), "blue"),
                (owner_ids[1], marker, "rose"),
            ):
                inserted.append(
                    int(
                        connection.execute(
                            definitions.insert()
                            .values(
                                domain_kind="bucket_ui_ceph_admin",
                                owner_user_id=owner_user_id,
                                label=label,
                                label_key=marker,
                                color_key=color_key,
                                scope="standard",
                            )
                            .returning(definitions.c.id)
                        ).scalar_one()
                    )
                )
            storage_id = int(
                connection.execute(
                    definitions.insert()
                    .values(
                        domain_kind="bucket_ui_storage_ops",
                        owner_user_id=owner_ids[0],
                        label=marker,
                        label_key=marker,
                        color_key="teal",
                        scope="standard",
                    )
                    .returning(definitions.c.id)
                ).scalar_one()
            )

            migration.upgrade()

            rows = {
                int(row.id): row
                for row in connection.execute(
                    sa.select(definitions).where(
                        definitions.c.id.in_([*inserted, storage_id])
                    )
                ).mappings()
            }
            assert rows[inserted[0]]["label"] == marker
            assert rows[inserted[0]]["owner_user_id"] is None
            assert rows[inserted[1]]["label"].endswith(
                f"(private {inserted[1]})"
            )
            assert rows[inserted[2]]["label"].endswith(
                f"(private {inserted[2]})"
            )
            assert rows[storage_id]["label"] == marker
            assert INDEX_NAME in {
                index["name"]
                for index in sa.inspect(connection).get_indexes("tag_definitions")
            }

            migration.downgrade()
            assert INDEX_NAME not in {
                index["name"]
                for index in sa.inspect(connection).get_indexes("tag_definitions")
            }
            migration.upgrade()
        finally:
            indexes = {
                index["name"]
                for index in sa.inspect(connection).get_indexes("tag_definitions")
            }
            if INDEX_NAME not in indexes:
                migration.upgrade()
            definition_ids = [*inserted]
            if storage_id is not None:
                definition_ids.append(storage_id)
            if definition_ids:
                connection.execute(
                    sa.delete(definitions).where(
                        definitions.c.id.in_(definition_ids)
                    )
                )
            connection.execute(sa.delete(users).where(users.c.id.in_(owner_ids)))
    engine.dispose()
