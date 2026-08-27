# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import json
import os

from app.core.config import get_settings
from app.core.database import SessionLocal
from app.db import User
from app.services.auth_session_service import AuthSessionService
from app.services.first_admin_bootstrap_service import FirstAdminBootstrapService


def main() -> None:
    settings = get_settings()
    email = os.environ["CEPH_TEST_SUPERADMIN_EMAIL"].strip().lower()
    password = os.environ["CEPH_TEST_SUPERADMIN_PASSWORD"]
    full_name = os.getenv("CEPH_TEST_SUPERADMIN_FULL_NAME", "Ceph Functional CI Admin")
    with SessionLocal() as db:
        FirstAdminBootstrapService(db).create_from_cli(
            email=email,
            full_name=full_name,
            password=password,
            confirmation=f"CREATE FIRST ADMIN {email}",
        )
        user = db.query(User).filter(User.email == email).first()
        if user is None:
            raise RuntimeError("Ceph functional super-admin bootstrap failed")
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
                "refresh_cookie_name": settings.refresh_token_cookie_name,
                "refresh_cookie_value": credentials.refresh_token,
                "csrf_cookie_name": settings.csrf_cookie_name,
                "csrf_cookie_value": credentials.csrf_token,
            }
        )
    )


if __name__ == "__main__":
    main()
