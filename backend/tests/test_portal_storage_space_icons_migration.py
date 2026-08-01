# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from importlib import util
from pathlib import Path

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations


def _load_migration():
    path = (
        Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "0071_portal_storage_space_icons.py"
    )
    spec = util.spec_from_file_location("migration_0071_portal_storage_space_icons", path)
    assert spec is not None and spec.loader is not None
    migration = util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def test_portal_storage_space_icon_migration_preserves_rows_and_adds_defaults(monkeypatch):
    engine = sa.create_engine("sqlite:///:memory:")
    with engine.begin() as connection:
        connection.execute(
            sa.text(
                "CREATE TABLE portal_storage_space_metadata ("
                "id INTEGER PRIMARY KEY, account_id INTEGER NOT NULL, bucket_name VARCHAR NOT NULL)"
            )
        )
        connection.execute(
            sa.text(
                "INSERT INTO portal_storage_space_metadata (id, account_id, bucket_name) "
                "VALUES (1, 4, 'research-data')"
            )
        )
        migration = _load_migration()
        monkeypatch.setattr(
            migration,
            "op",
            Operations(MigrationContext.configure(connection)),
        )

        migration.upgrade()

        row = connection.execute(
            sa.text(
                "SELECT icon_source, icon_preset, icon_image, icon_content_type, icon_updated_at "
                "FROM portal_storage_space_metadata WHERE id = 1"
            )
        ).one()
        assert row == ("preset", "bucket", None, None, None)
        constraint_names = {
            constraint["name"]
            for constraint in sa.inspect(connection).get_check_constraints(
                "portal_storage_space_metadata"
            )
        }
        assert {
            "ck_portal_storage_space_metadata_icon_source",
            "ck_portal_storage_space_metadata_icon_preset",
            "ck_portal_storage_space_metadata_icon_content_type",
        } <= constraint_names

        migration.downgrade()

        columns = {
            column["name"]
            for column in sa.inspect(connection).get_columns(
                "portal_storage_space_metadata"
            )
        }
        assert columns == {"id", "account_id", "bucket_name"}
