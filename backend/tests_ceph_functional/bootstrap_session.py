# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import json

from app.core.config import get_settings
from app.core.database import SessionLocal
from app.db import User
from app.services.auth_session_service import AuthSessionService


def main() -> None:
    settings = get_settings()
    with SessionLocal() as db:
        user = db.query(User).filter(User.email == settings.seed_super_admin_email).first()
        if user is None:
            raise RuntimeError("Seeded Ceph functional super-admin was not found")
        credentials = AuthSessionService(db).create_for_user(
            user,
            auth_type="webauthn",
            ip_address="127.0.0.1",
            user_agent="ceph-functional-ci-bootstrap",
            mfa_verified=True,
        )
    print(
        json.dumps(
            {
                "access_cookie_name": settings.access_token_cookie_name,
                "access_cookie_value": credentials.access_token,
                "csrf_cookie_name": settings.csrf_cookie_name,
                "csrf_cookie_value": credentials.csrf_token,
            }
        )
    )


if __name__ == "__main__":
    main()
