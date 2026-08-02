# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from __future__ import annotations

from importlib import util
import json
from pathlib import Path

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations


def _load_migration():
    migration_path = (
        Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "0088_canonical_portal_settings_override.py"
    )
    spec = util.spec_from_file_location(
        "migration_0088_canonical_portal_settings_override",
        migration_path,
    )
    assert spec and spec.loader
    migration = util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def test_migration_flattens_and_validates_portal_overrides(monkeypatch):
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    accounts = sa.Table(
        "s3_accounts",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("portal_settings_override", sa.Text(), nullable=True),
    )
    metadata.create_all(engine)

    with engine.begin() as connection:
        connection.execute(
            accounts.insert(),
            [
                {
                    "id": 1,
                    "portal_settings_override": json.dumps(
                        {
                            "admin": {
                                "browser_access_enabled": False,
                                "allow_portal_named_bucket_create": "invalid",
                                "bucket_defaults": {
                                    "enable_cors": True,
                                    "noncurrent_version_expiration_days": 45,
                                    "unknown": True,
                                },
                            },
                            "portal_manager": {
                                "allow_portal_user_access_key_create": False
                            },
                        }
                    ),
                },
                {
                    "id": 2,
                    "portal_settings_override": json.dumps(
                        {"allow_private_storage_space_create": True}
                    ),
                },
                {
                    "id": 3,
                    "portal_settings_override": json.dumps(
                        {"portal_manager": {"browser_access_enabled": True}}
                    ),
                },
                {"id": 4, "portal_settings_override": "{"},
                {"id": 5, "portal_settings_override": None},
            ],
        )
        migration = _load_migration()
        monkeypatch.setattr(
            migration,
            "op",
            Operations(MigrationContext.configure(connection)),
        )

        migration.upgrade()

        rows = connection.execute(
            sa.text(
                "SELECT id, portal_settings_override FROM s3_accounts ORDER BY id"
            )
        ).all()
        assert json.loads(rows[0].portal_settings_override) == {
            "browser_access_enabled": False,
            "bucket_defaults": {
                "enable_cors": True,
                "noncurrent_version_expiration_days": 45,
            },
        }
        assert json.loads(rows[1].portal_settings_override) == {
            "allow_private_storage_space_create": True
        }
        assert all(row.portal_settings_override is None for row in rows[2:])
