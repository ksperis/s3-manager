# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import importlib.util as import_util
from pathlib import Path

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations


def test_ceph_bucket_replication_endpoint_metadata_migration_adds_and_drops_columns(monkeypatch):
    migration_path = (
        Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "0066_add_ceph_bucket_replication_endpoint_metadata.py"
    )
    spec = import_util.spec_from_file_location("migration_0066_add_ceph_bucket_replication_endpoint_metadata", migration_path)
    assert spec is not None and spec.loader is not None
    migration = import_util.module_from_spec(spec)
    spec.loader.exec_module(migration)

    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    sa.Table(
        "storage_endpoints",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("endpoint_url", sa.String(), nullable=False),
        sa.Column("ceph_zonegroup_name", sa.String(), nullable=True),
        sa.Column("ceph_zonegroup_global_replication_configured", sa.Boolean(), nullable=False, server_default="0"),
        sa.Column("ceph_zonegroup_bucket_replication_allowed", sa.Boolean(), nullable=False, server_default="0"),
    )

    with engine.begin() as connection:
        metadata.create_all(connection)
        connection.execute(
            sa.text(
                "INSERT INTO storage_endpoints "
                "(id, name, endpoint_url, ceph_zonegroup_name, ceph_zonegroup_global_replication_configured, "
                "ceph_zonegroup_bucket_replication_allowed) "
                "VALUES (1, 's3-z1', 'https://s3-z1.example.test', 'zg-lab', 0, 1)"
            )
        )

        operations = Operations(MigrationContext.configure(connection))
        monkeypatch.setattr(migration, "op", operations)

        migration.upgrade()

        inspector = sa.inspect(connection)
        columns = {column["name"] for column in inspector.get_columns("storage_endpoints")}
        assert "ceph_zone_name" in columns
        assert "ceph_bucket_replication_target_zones_json" in columns
        assert "ceph_bucket_replication_owner_mode" in columns

        row = connection.execute(
            sa.text(
                "SELECT ceph_zone_name, ceph_bucket_replication_target_zones_json, "
                "ceph_bucket_replication_owner_mode FROM storage_endpoints WHERE id = 1"
            )
        ).one()
        assert row[0] is None
        assert row[1] == "[]"
        assert row[2] == "rgw_user_only"

        migration.downgrade()

        columns = {column["name"] for column in sa.inspect(connection).get_columns("storage_endpoints")}
        assert "ceph_zone_name" not in columns
        assert "ceph_bucket_replication_target_zones_json" not in columns
        assert "ceph_bucket_replication_owner_mode" not in columns
