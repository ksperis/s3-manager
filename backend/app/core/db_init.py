# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from sqlalchemy import inspect, text
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import get_password_hash
from app.db_models import Base, StorageEndpoint, StorageProvider, User, UserRole
from app.services.storage_endpoints_service import StorageEndpointsService
from app.utils.storage_endpoint_features import dump_features_config, normalize_legacy_capabilities


settings = get_settings()


def _ensure_storage_endpoint_features(engine, db: Session) -> None:
    inspector = inspect(engine)
    if "storage_endpoints" not in inspector.get_table_names():
        return
    columns = {column["name"] for column in inspector.get_columns("storage_endpoints")}
    if "features_config" not in columns:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE storage_endpoints ADD COLUMN features_config TEXT"))
        columns.add("features_config")
    if "features_config" not in columns:
        return
    endpoints = db.query(StorageEndpoint).all()
    updated = False
    for endpoint in endpoints:
        raw = endpoint.features_config
        if isinstance(raw, str) and raw.strip():
            continue
        legacy_caps = normalize_legacy_capabilities(endpoint.capabilities)
        provider = StorageProvider(str(endpoint.provider)) if endpoint.provider else StorageProvider.CEPH
        admin_configured = bool(endpoint.admin_access_key or endpoint.admin_secret_key or endpoint.admin_endpoint)
        features = {
            "admin": {"enabled": provider == StorageProvider.CEPH and admin_configured, "endpoint": endpoint.admin_endpoint},
            "sts": {"enabled": legacy_caps.get("sts", provider == StorageProvider.CEPH), "endpoint": None},
            "usage": {"enabled": provider == StorageProvider.CEPH and admin_configured, "endpoint": None},
            "metrics": {"enabled": provider == StorageProvider.CEPH and admin_configured, "endpoint": None},
            "static_website": {"enabled": legacy_caps.get("static_website", provider == StorageProvider.CEPH), "endpoint": None},
        }
        endpoint.features_config = dump_features_config(features)
        endpoint.admin_endpoint = features["admin"]["endpoint"]
        endpoint.capabilities = {
            "admin": bool(features["admin"]["enabled"]),
            "sts": bool(features["sts"]["enabled"]),
            "usage": bool(features["usage"]["enabled"]),
            "metrics": bool(features["metrics"]["enabled"]),
            "static_website": bool(features["static_website"]["enabled"]),
        }
        updated = True
    if updated:
        db.commit()


def init_db(engine, session_factory) -> None:
    Base.metadata.create_all(bind=engine)
    # Seed super-admin if missing
    db: Session = session_factory()
    try:
        _ensure_storage_endpoint_features(engine, db)
        admin = db.query(User).filter(User.email == settings.super_admin_email).first()
        if not admin:
            admin_user = User(
                email=settings.super_admin_email,
                full_name=settings.super_admin_full_name,
                hashed_password=get_password_hash(settings.super_admin_password),
                is_active=True,
                role=UserRole.UI_ADMIN.value,
            )
            db.add(admin_user)
            db.commit()
        # Ensure the environment-provided storage endpoint is registered
        StorageEndpointsService(db).ensure_default_endpoint()
    finally:
        db.close()
