# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import verify_password
from app.db import User


def seed_login_active(db: Session) -> bool:
    settings = get_settings()
    seed_user = db.query(User).filter(User.email == settings.seed_super_admin_email).first()
    if not seed_user or not seed_user.hashed_password:
        return False
    return verify_password(settings.seed_super_admin_password, seed_user.hashed_password)

