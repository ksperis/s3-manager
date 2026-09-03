# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Shared Manager bucket-migration route helpers."""

from __future__ import annotations

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.core.sensitive_data import sanitized_error_log_detail
from app.models.access_context import BucketMigrationAccessScope
from app.services.bucket_migration.worker import get_bucket_migration_worker
from app.services.bucket_migration_service import BucketMigrationService


def _raise_migration_value_error(exc: ValueError) -> None:
    raw_message = str(exc)
    error_status = (
        status.HTTP_404_NOT_FOUND
        if raw_message == "Migration not found"
        else status.HTTP_400_BAD_REQUEST
    )
    raise HTTPException(status_code=error_status, detail=sanitized_error_log_detail(exc)) from exc


def _worker_wake_up() -> None:
    worker = get_bucket_migration_worker(SessionLocal)
    worker.wake_up()


def _build_service(
    db: Session,
    scope: BucketMigrationAccessScope,
) -> BucketMigrationService:
    return BucketMigrationService(
        db,
        authorized_context_ids=scope.allowed_context_ids,
        admin_account_context_ids=scope.admin_account_context_ids,
    )
