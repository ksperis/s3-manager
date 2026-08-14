# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Interactively create the first UI superadministrator."""
from __future__ import annotations

import argparse
import getpass

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.core.security import get_password_hash
from app.db import User
from app.db.enums import UserRole
from app.services.audit_service import AuditService


class FirstAdminError(ValueError):
    pass


def create_first_admin(
    db: Session,
    *,
    email: str,
    full_name: str,
    password: str,
    confirmation: str,
) -> User:
    normalized_email = email.strip().lower()
    expected = f"CREATE FIRST ADMIN {normalized_email}"
    if confirmation != expected:
        raise FirstAdminError(f"Confirmation must exactly match: {expected}")
    if len(password) < 12:
        raise FirstAdminError("Password must contain at least 12 characters")
    if db.query(func.count(User.id)).scalar():
        raise FirstAdminError("The database already contains users; create administrators through the UI")
    user = User(
        email=normalized_email,
        full_name=full_name.strip() or None,
        hashed_password=get_password_hash(password),
        role=UserRole.UI_SUPERADMIN.value,
        is_active=True,
        auth_version=1,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    AuditService(db).record_action(
        user=user,
        scope="security",
        action="operator_create_first_superadmin",
        entity_type="user",
        entity_id=str(user.id),
        metadata={"passkey_enrollment_required": True},
    )
    return user


def main() -> None:
    parser = argparse.ArgumentParser(description="Create the first UI superadministrator interactively.")
    parser.add_argument("--email", required=True)
    parser.add_argument("--full-name", default="")
    args = parser.parse_args()
    normalized_email = args.email.strip().lower()
    password = getpass.getpass("Initial password (minimum 12 characters): ")
    repeated = getpass.getpass("Repeat initial password: ")
    if password != repeated:
        raise SystemExit("Passwords do not match")
    confirmation = input(f"Type 'CREATE FIRST ADMIN {normalized_email}' to continue: ")
    db = SessionLocal()
    try:
        user = create_first_admin(
            db,
            email=normalized_email,
            full_name=args.full_name,
            password=password,
            confirmation=confirmation,
        )
    finally:
        db.close()
    print(f"Created {user.email}. Passkey enrollment is mandatory at first login.")


if __name__ == "__main__":
    main()
