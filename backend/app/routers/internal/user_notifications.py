# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.routers.dependencies import require_internal_cron_token
from app.services.data_retention_service import DataRetentionService
from app.services.operation_lease_service import (
    OperationLeaseService,
    USER_NOTIFICATIONS_PURGE_OPERATION,
    default_operation_lease_ttl_seconds,
)


router = APIRouter(
    prefix="/internal/notifications",
    tags=["internal-user-notifications"],
)


@router.post("/purge")
def purge_user_notifications(
    _: None = Depends(require_internal_cron_token),
    db: Session = Depends(get_db),
) -> dict:
    lease_service = OperationLeaseService(db)
    lease = lease_service.acquire(
        USER_NOTIFICATIONS_PURGE_OPERATION,
        ttl_seconds=default_operation_lease_ttl_seconds(),
        lease_context={"source": "internal"},
    )
    if lease is None:
        return {
            "status": "skipped",
            "reason": "already_running",
            "operation": USER_NOTIFICATIONS_PURGE_OPERATION,
        }
    try:
        result = DataRetentionService(db).purge_user_notifications()
        return {"status": "completed", **result}
    finally:
        lease_service.release(lease)
