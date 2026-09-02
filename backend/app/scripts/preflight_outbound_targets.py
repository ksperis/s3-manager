# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Inventory persisted outbound hosts that are not covered by operator allowlists.

Run from ``backend`` with ``python -m app.scripts.preflight_outbound_targets``.
Only hostnames are emitted; URLs, paths, query strings, credentials, and secrets
are deliberately excluded from the output.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Callable
from urllib.parse import urlparse

from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.core.database import SessionLocal
from app.db import BucketMigration, S3Connection
from app.utils.network_targets import host_matches_allowlist
from app.utils.s3_connection_endpoint import parse_custom_endpoint_config


@dataclass(frozen=True, order=True)
class UncoveredTarget:
    target_type: str
    hostname: str


def _hostname(url: str) -> str:
    return str(urlparse(url).hostname or "").strip().lower().rstrip(".")


def find_uncovered_outbound_targets(db: Session, settings: Settings) -> list[UncoveredTarget]:
    uncovered: set[UncoveredTarget] = set()
    s3_allowed = settings.user_supplied_s3_endpoint_allowed_hosts
    webhook_allowed = settings.bucket_migration_webhook_allowed_hosts

    connections = (
        db.query(S3Connection)
        .filter(
            S3Connection.is_shared.is_(False),
            S3Connection.server_managed.is_(False),
            S3Connection.storage_endpoint_id.is_(None),
            S3Connection.custom_endpoint_config.is_not(None),
        )
        .all()
    )
    for connection in connections:
        try:
            hostname = _hostname(parse_custom_endpoint_config(connection.custom_endpoint_config).endpoint_url or "")
        except (TypeError, ValueError):
            hostname = "<invalid>"
        if not host_matches_allowlist(hostname, s3_allowed):
            uncovered.add(UncoveredTarget("user-s3-endpoint", hostname or "<invalid>"))

    webhooks = db.query(BucketMigration.webhook_url).filter(BucketMigration.webhook_url.is_not(None)).all()
    for (webhook_url,) in webhooks:
        hostname = _hostname(webhook_url or "") or "<invalid>"
        if not host_matches_allowlist(hostname, webhook_allowed):
            uncovered.add(UncoveredTarget("migration-webhook", hostname))

    return sorted(uncovered)


def run_preflight(
    db: Session,
    settings: Settings,
    *,
    emit: Callable[[str], None] = print,
) -> int:
    targets = find_uncovered_outbound_targets(db, settings)
    for target in targets:
        emit(f"{target.target_type}: {target.hostname}")
    if targets:
        emit(f"Blocked outbound hostnames: {len(targets)}")
        return 1
    emit("All persisted outbound hostnames are covered by the configured allowlists.")
    return 0


def main() -> int:
    db = SessionLocal()
    try:
        return run_preflight(db, get_settings())
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
