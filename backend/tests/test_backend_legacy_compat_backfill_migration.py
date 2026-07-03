# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import importlib.util as import_util
from pathlib import Path

import sqlalchemy as sa
import yaml
from alembic.migration import MigrationContext
from alembic.operations import Operations


def test_backend_legacy_compat_backfill_migration_materializes_runtime_fallbacks(monkeypatch):
    migration_path = Path(__file__).resolve().parents[1] / "alembic" / "versions" / "0059_backend_legacy_compat_backfill.py"
    spec = import_util.spec_from_file_location("migration_0059_backend_legacy_compat_backfill", migration_path)
    assert spec is not None and spec.loader is not None
    migration = import_util.module_from_spec(spec)
    spec.loader.exec_module(migration)

    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    sa.Table(
        "storage_endpoints",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("provider", sa.String()),
        sa.Column("features_config", sa.Text()),
        sa.Column("tags_json", sa.Text()),
    )
    sa.Table(
        "tag_definitions",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("domain_kind", sa.String(), nullable=False),
        sa.Column("owner_user_id", sa.Integer(), nullable=True),
        sa.Column("label", sa.String(), nullable=False),
        sa.Column("label_key", sa.String(), nullable=False),
        sa.Column("color_key", sa.String(), nullable=False),
        sa.Column("scope", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    sa.Table(
        "storage_endpoint_tags",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("storage_endpoint_id", sa.Integer(), nullable=False),
        sa.Column("tag_definition_id", sa.Integer(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    sa.Table(
        "portal_storage_space_metadata",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("origin", sa.String(), nullable=False, server_default="legacy"),
    )

    with engine.begin() as connection:
        metadata.create_all(connection)
        connection.execute(
            sa.text(
                "INSERT INTO storage_endpoints (id, provider, features_config, tags_json) "
                "VALUES (1, 'ceph', :features_config, :tags_json)"
            ),
            {
                "features_config": (
                    "features:\n"
                    "  admin:\n"
                    "    enabled: true\n"
                    "  healthcheck:\n"
                    "    enabled: true\n"
                    "    endpoint: https://health.example.test\n"
                ),
                "tags_json": '["prod", "rgw-a"]',
            },
        )
        connection.execute(sa.text("INSERT INTO portal_storage_space_metadata (id, origin) VALUES (1, 'legacy')"))

        operations = Operations(MigrationContext.configure(connection))
        monkeypatch.setattr(migration, "op", operations)

        migration.upgrade()

        tag_rows = connection.execute(
            sa.text(
                "SELECT td.label, setags.position "
                "FROM storage_endpoint_tags setags "
                "JOIN tag_definitions td ON td.id = setags.tag_definition_id "
                "ORDER BY setags.position"
            )
        ).all()
        assert [(row.label, row.position) for row in tag_rows] == [("prod", 0), ("rgw-a", 1)]

        features_raw = connection.execute(sa.text("SELECT features_config FROM storage_endpoints WHERE id = 1")).scalar_one()
        features = yaml.safe_load(features_raw)["features"]
        assert features["account"]["enabled"] is True
        assert features["healthcheck"]["healthcheck_url"] == "https://health.example.test"
        assert "endpoint" not in features["healthcheck"]

        origin = connection.execute(sa.text("SELECT origin FROM portal_storage_space_metadata WHERE id = 1")).scalar_one()
        assert origin == "imported"
