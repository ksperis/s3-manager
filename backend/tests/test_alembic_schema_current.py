# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from __future__ import annotations

from pathlib import Path

from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.migration import MigrationContext
import sqlalchemy as sa

from app.core.config import get_settings
from app.db import Base


def test_alembic_head_matches_sqlalchemy_metadata(tmp_path, monkeypatch):
    database_path = tmp_path / "schema-current.sqlite"
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{database_path}")
    monkeypatch.delenv("KAELO_DB_BACKUP_VERIFIED", raising=False)
    get_settings.cache_clear()

    config = Config(str(Path(__file__).resolve().parents[1] / "alembic.ini"))
    config.attributes["configure_logger"] = False
    try:
        command.upgrade(config, "head")
        engine = sa.create_engine(f"sqlite:///{database_path}")
        with engine.connect() as connection:
            context = MigrationContext.configure(
                connection,
                opts={"compare_type": True},
            )
            assert compare_metadata(context, Base.metadata) == []
        engine.dispose()
    finally:
        get_settings.cache_clear()
