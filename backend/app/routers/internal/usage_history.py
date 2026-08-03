# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.routers.dependencies import require_internal_cron_token
from app.services.quota_monitoring_service import QuotaMonitoringService
from app.services.operation_lease_service import (
    OperationLeaseService,
    USAGE_HISTORY_COLLECT_OPERATION,
    default_operation_lease_ttl_seconds,
)
from app.core.sensitive_data import sanitize_error_detail

router = APIRouter(prefix="/internal/usage-history", tags=["internal-usage-history"])


@router.post("/collect")
def collect_usage_history(
    _: None = Depends(require_internal_cron_token),
    db: Session = Depends(get_db),
) -> dict:
    lease_service = OperationLeaseService(db)
    lease = lease_service.acquire(
        USAGE_HISTORY_COLLECT_OPERATION,
        ttl_seconds=default_operation_lease_ttl_seconds(),
        lease_context={"source": "internal"},
    )
    if lease is None:
        return {"status": "skipped", "reason": "already_running", "operation": USAGE_HISTORY_COLLECT_OPERATION}
    service = QuotaMonitoringService(db)
    try:
        return service.run_monitor(include_quota_alerts=False, include_usage_history=True)
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=sanitize_error_detail(str(exc))) from exc
    finally:
        lease_service.release(lease)
