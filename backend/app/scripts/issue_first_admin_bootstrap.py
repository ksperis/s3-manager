# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Issue a short-lived one-time URL for creating the first administrator."""
from __future__ import annotations

import argparse

from app.core.config import get_settings
from app.core.database import SessionLocal
from app.services.first_admin_bootstrap_service import (
    DEFAULT_BOOTSTRAP_TTL_MINUTES,
    FirstAdminBootstrapError,
    FirstAdminBootstrapService,
)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Issue a one-time first-administrator bootstrap URL."
    )
    parser.add_argument(
        "--ttl-minutes",
        type=int,
        default=DEFAULT_BOOTSTRAP_TTL_MINUTES,
        help="Token lifetime between 1 and 60 minutes (default: 15)",
    )
    args = parser.parse_args()
    db = SessionLocal()
    try:
        issued = FirstAdminBootstrapService(db).issue_token(
            ttl_minutes=args.ttl_minutes
        )
    except FirstAdminBootstrapError as exc:
        raise SystemExit(str(exc)) from exc
    finally:
        db.close()

    public_origin = get_settings().public_origin.rstrip("/")
    print(
        f"Bootstrap URL: "
        f"{public_origin}/setup/first-admin#token={issued.token}"
    )
    print(f"Expires at: {issued.expires_at.isoformat()}")


if __name__ == "__main__":
    main()
