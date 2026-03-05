# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import logging
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import get_password_hash
from app.db import User, UserRole
from app.services.storage_endpoints_service import StorageEndpointsService


settings = get_settings()
logger = logging.getLogger(__name__)


def _alembic_config() -> Config:
    base_dir = Path(__file__).resolve().parents[2]
    config = Config(str(base_dir / "alembic.ini"))
    config.set_main_option("script_location", str(base_dir / "alembic"))
    config.set_main_option("sqlalchemy.url", settings.database_url)
    config.attributes["configure_logger"] = False
    return config


def init_db(engine, session_factory) -> None:
    command.upgrade(_alembic_config(), "head")
    if (settings.seed_super_admin_password or "").strip().lower() in {"changeme", "change-me", "admin", "password"}:
        logger.warning(
            "SEED_SUPER_ADMIN_PASSWORD is using a default/weak value. "
            "Change it before exposing this environment."
        )
    # Seed super-admin if missing
    db: Session = session_factory()
    try:
        admin = db.query(User).filter(User.email == settings.seed_super_admin_email).first()
        if not admin:
            admin_user = User(
                email=settings.seed_super_admin_email,
                full_name=settings.seed_super_admin_full_name,
                hashed_password=get_password_hash(settings.seed_super_admin_password),
                is_active=True,
                role=UserRole.UI_SUPERADMIN.value,
            )
            db.add(admin_user)
            db.commit()
            if (settings.seed_super_admin_password or "").strip().lower() in {"changeme", "change-me", "admin", "password"}:
                logger.warning(
                    "Seeded super-admin user '%s' with a default/weak password. Rotate immediately.",
                    settings.seed_super_admin_email,
                )
        # Ensure env-managed endpoints or default endpoint are registered
        storage_service = StorageEndpointsService(db)
        storage_service.sync_env_endpoints()
        if not storage_service.env_endpoints_locked():
            storage_service.ensure_default_endpoint()
    finally:
        db.close()
