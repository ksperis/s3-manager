# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import get_password_hash
from app.db_models import Base, User, UserRole
from app.services.storage_endpoints_service import StorageEndpointsService


settings = get_settings()


def init_db(engine, session_factory) -> None:
    Base.metadata.create_all(bind=engine)
    # Seed super-admin if missing
    db: Session = session_factory()
    try:
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
