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
    QUOTA_MONITOR_ALERTS_OPERATION,
    default_operation_lease_ttl_seconds,
)
from app.core.sensitive_data import sanitize_error_detail

router = APIRouter(prefix="/internal/quota-monitor", tags=["internal-quota-monitor"])


@router.post("/run")
def run_quota_monitor(
    _: None = Depends(require_internal_cron_token),
    db: Session = Depends(get_db),
) -> dict:
    lease_service = OperationLeaseService(db)
    lease = lease_service.acquire(
        QUOTA_MONITOR_ALERTS_OPERATION,
        ttl_seconds=default_operation_lease_ttl_seconds(),
        lease_context={"source": "internal"},
    )
    if lease is None:
        return {"status": "skipped", "reason": "already_running", "operation": QUOTA_MONITOR_ALERTS_OPERATION}
    service = QuotaMonitoringService(db)
    try:
        return service.run_monitor(include_usage_history=False)
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=sanitize_error_detail(str(exc))) from exc
    finally:
        lease_service.release(lease)
