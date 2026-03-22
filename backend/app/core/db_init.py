# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import logging
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import func
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


def _should_seed_super_admin(db: Session, *, mode: str, seed_email: str) -> tuple[bool, str]:
    normalized_mode = (mode or "").strip().lower()
    if normalized_mode == "disabled":
        return False, "mode disabled"
    if normalized_mode == "if_missing":
        existing_seed = db.query(User.id).filter(User.email == seed_email).first()
        if existing_seed:
            return False, f"seed user '{seed_email}' already exists"
        return True, f"seed user '{seed_email}' is missing"
    if normalized_mode != "if_empty":
        logger.warning("Unknown seed_super_admin_mode '%s'; falling back to 'if_empty'", mode)
    user_count = int(db.query(func.count(User.id)).scalar() or 0)
    if user_count == 0:
        return True, "no users in database"
    return False, f"database already has {user_count} user(s)"


def _seed_super_admin_if_needed(db: Session) -> bool:
    should_seed, reason = _should_seed_super_admin(
        db,
        mode=settings.seed_super_admin_mode,
        seed_email=settings.seed_super_admin_email,
    )
    if not should_seed:
        logger.info(
            "Super-admin seed skipped (mode=%s, email=%s, reason=%s)",
            settings.seed_super_admin_mode,
            settings.seed_super_admin_email,
            reason,
        )
        return False

    admin_user = User(
        email=settings.seed_super_admin_email,
        full_name=settings.seed_super_admin_full_name,
        hashed_password=get_password_hash(settings.seed_super_admin_password),
        is_active=True,
        role=UserRole.UI_SUPERADMIN.value,
        can_access_ceph_admin=True,
        can_access_storage_ops=True,
    )
    db.add(admin_user)
    db.commit()
    logger.info(
        "Super-admin seed executed (mode=%s, email=%s, reason=%s)",
        settings.seed_super_admin_mode,
        settings.seed_super_admin_email,
        reason,
    )
    if (settings.seed_super_admin_password or "").strip().lower() in {"changeme", "change-me", "admin", "password"}:
        logger.warning(
            "Seeded super-admin user '%s' with a default/weak password. Rotate immediately.",
            settings.seed_super_admin_email,
        )
    return True


def init_db(engine, session_factory) -> None:
    command.upgrade(_alembic_config(), "head")
    if (settings.seed_super_admin_password or "").strip().lower() in {"changeme", "change-me", "admin", "password"}:
        logger.warning(
            "SEED_SUPER_ADMIN_PASSWORD is using a default/weak value. "
            "Change it before exposing this environment."
        )
    # Seed super-admin according to selected strategy.
    db: Session = session_factory()
    try:
        _seed_super_admin_if_needed(db)
        # Ensure env-managed endpoints or default endpoint are registered
        storage_service = StorageEndpointsService(db)
        storage_service.sync_env_endpoints()
        if not storage_service.env_endpoints_locked():
            storage_service.ensure_default_endpoint()
    finally:
        db.close()
