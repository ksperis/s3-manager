# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Interactively create the first UI superadministrator."""
from __future__ import annotations

import argparse
import getpass

from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.db import User
from app.services.first_admin_bootstrap_service import (
    FirstAdminBootstrapError,
    FirstAdminBootstrapService,
)


FirstAdminError = FirstAdminBootstrapError


def create_first_admin(
    db: Session,
    *,
    email: str,
    full_name: str,
    password: str,
    confirmation: str,
) -> User:
    created = FirstAdminBootstrapService(db).create_from_cli(
        email=email,
        full_name=full_name,
        password=password,
        confirmation=confirmation,
    )
    user = db.get(User, created.user_id)
    if user is None:
        raise FirstAdminError("Created administrator could not be reloaded")
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
        created_email = user.email
    finally:
        db.close()
    print(
        f"Created {created_email}. "
        "Passkey enrollment is mandatory at first login."
    )


if __name__ == "__main__":
    main()
