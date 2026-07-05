# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import importlib.util as import_util
from pathlib import Path

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations


def test_project_portal_settings_migration_moves_column_without_copy(monkeypatch):
    migration_path = Path(__file__).resolve().parents[1] / "alembic" / "versions" / "0065_project_portal_settings_overrides.py"
    spec = import_util.spec_from_file_location("migration_0065_project_portal_settings_overrides", migration_path)
    assert spec is not None and spec.loader is not None
    migration = import_util.module_from_spec(spec)
    spec.loader.exec_module(migration)

    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    sa.Table(
        "s3_accounts",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("portal_settings_override", sa.Text(), nullable=True),
    )
    sa.Table(
        "projects",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(), nullable=False),
    )

    with engine.begin() as connection:
        metadata.create_all(connection)
        connection.execute(
            sa.text(
                "INSERT INTO s3_accounts (id, name, portal_settings_override) "
                "VALUES (1, 'account-a', :override)"
            ),
            {"override": '{"admin":{"allow_portal_user_bucket_create":false}}'},
        )
        connection.execute(sa.text("INSERT INTO projects (id, name) VALUES (10, 'project-a')"))

        operations = Operations(MigrationContext.configure(connection))
        monkeypatch.setattr(migration, "op", operations)

        migration.upgrade()

        inspector = sa.inspect(connection)
        account_columns = {column["name"] for column in inspector.get_columns("s3_accounts")}
        project_columns = {column["name"] for column in inspector.get_columns("projects")}
        assert "portal_settings_override" not in account_columns
        assert "portal_settings_override" in project_columns

        project_override = connection.execute(
            sa.text("SELECT portal_settings_override FROM projects WHERE id = 10")
        ).scalar_one()
        assert project_override is None
