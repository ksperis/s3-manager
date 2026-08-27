# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from importlib import util
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy.exc import IntegrityError


def _load_migration():
    path = (
        Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "0120_bucket_ui_tag_definition_settings.py"
    )
    spec = util.spec_from_file_location(
        "migration_0120_bucket_ui_tag_definition_settings",
        path,
    )
    assert spec is not None and spec.loader is not None
    migration = util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def _definitions(metadata: sa.MetaData) -> sa.Table:
    return sa.Table(
        "tag_definitions",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("domain_kind", sa.String(), nullable=False),
        sa.Column("owner_user_id", sa.Integer(), nullable=True),
        sa.Column("label", sa.String(), nullable=False),
        sa.Column("label_key", sa.String(), nullable=False),
        sa.Column("color_key", sa.String(), nullable=False),
        sa.Column("scope", sa.String(), nullable=False),
    )


def test_bucket_ui_tag_definition_settings_migration_upgrade_and_downgrade(
    monkeypatch,
):
    engine = sa.create_engine("sqlite:///:memory:")
    with engine.begin() as connection:
        metadata = sa.MetaData()
        definitions = _definitions(metadata)
        metadata.create_all(connection)
        connection.execute(
            definitions.insert(),
            [
                {
                    "id": 1,
                    "domain_kind": "bucket_ui_ceph_admin",
                    "owner_user_id": 10,
                    "label": "Production",
                    "label_key": "production",
                    "color_key": "blue",
                    "scope": "standard",
                },
                {
                    "id": 2,
                    "domain_kind": "bucket_ui_ceph_admin",
                    "owner_user_id": 20,
                    "label": "PRODUCTION",
                    "label_key": "production",
                    "color_key": "rose",
                    "scope": "standard",
                },
                {
                    "id": 5,
                    "domain_kind": "bucket_ui_ceph_admin",
                    "owner_user_id": None,
                    "label": "Production",
                    "label_key": "production",
                    "color_key": "amber",
                    "scope": "standard",
                },
                {
                    "id": 6,
                    "domain_kind": "bucket_ui_ceph_admin",
                    "owner_user_id": 10,
                    "label": "Production (private 1)",
                    "label_key": "production (private 1)",
                    "color_key": "gray",
                    "scope": "standard",
                },
                {
                    "id": 3,
                    "domain_kind": "bucket_ui_ceph_admin",
                    "owner_user_id": 10,
                    "label": "Review",
                    "label_key": "review",
                    "color_key": "teal",
                    "scope": "standard",
                },
                {
                    "id": 4,
                    "domain_kind": "bucket_ui_ceph_admin",
                    "owner_user_id": 20,
                    "label": "review",
                    "label_key": "review",
                    "color_key": "cyan",
                    "scope": "standard",
                },
                {
                    "id": 7,
                    "domain_kind": "bucket_ui_storage_ops",
                    "owner_user_id": 10,
                    "label": "Production",
                    "label_key": "production",
                    "color_key": "blue",
                    "scope": "standard",
                },
                {
                    "id": 8,
                    "domain_kind": "bucket_ui_storage_ops",
                    "owner_user_id": 20,
                    "label": "Production",
                    "label_key": "production",
                    "color_key": "rose",
                    "scope": "standard",
                },
                {
                    "id": 9,
                    "domain_kind": "endpoint",
                    "owner_user_id": None,
                    "label": "Production",
                    "label_key": "production",
                    "color_key": "green",
                    "scope": "standard",
                },
            ],
        )
        migration = _load_migration()
        monkeypatch.setattr(
            migration,
            "op",
            Operations(MigrationContext.configure(connection)),
        )

        migration.upgrade()

        rows = {
            int(row.id): row
            for row in connection.execute(
                sa.select(definitions).order_by(definitions.c.id)
            ).mappings()
        }
        assert rows[5]["label"] == "Production"
        assert rows[5]["owner_user_id"] is None
        assert rows[1]["label"] == "Production (private 1) 2"
        assert rows[2]["label"] == "PRODUCTION (private 2)"
        assert rows[3]["label"] == "Review"
        assert rows[4]["label"] == "review (private 4)"
        assert rows[7]["label"] == rows[8]["label"] == "Production"
        assert rows[9]["label"] == "Production"
        assert {
            index["name"]
            for index in sa.inspect(connection).get_indexes("tag_definitions")
        } == {"uq_tag_definitions_bucket_ui_ceph_admin_label"}

        with pytest.raises(IntegrityError):
            connection.execute(
                definitions.insert().values(
                    id=10,
                    domain_kind="bucket_ui_ceph_admin",
                    owner_user_id=30,
                    label="production",
                    label_key="production",
                    color_key="neutral",
                    scope="standard",
                )
            )

        migration.downgrade()
        assert sa.inspect(connection).get_indexes("tag_definitions") == []
        connection.execute(
            definitions.insert().values(
                id=10,
                domain_kind="bucket_ui_ceph_admin",
                owner_user_id=30,
                label="production",
                label_key="production",
                color_key="neutral",
                scope="standard",
            )
        )
