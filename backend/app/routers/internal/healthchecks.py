# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.routers.dependencies import require_internal_cron_token
from app.services.healthcheck_service import HealthCheckService
from app.services.operation_lease_service import (
    HEALTHCHECK_RUN_OPERATION,
    OperationLeaseService,
    default_operation_lease_ttl_seconds,
)
from app.core.sensitive_data import sanitize_error_detail

router = APIRouter(prefix="/internal/healthchecks", tags=["internal-healthchecks"])


@router.post("/run")
def run_healthchecks(
    _: None = Depends(require_internal_cron_token),
    db: Session = Depends(get_db),
) -> dict:
    lease_service = OperationLeaseService(db)
    lease = lease_service.acquire(
        HEALTHCHECK_RUN_OPERATION,
        ttl_seconds=default_operation_lease_ttl_seconds(),
        lease_context={"source": "internal"},
    )
    if lease is None:
        return {"status": "skipped", "reason": "already_running", "operation": HEALTHCHECK_RUN_OPERATION}
    service = HealthCheckService(db)
    try:
        return service.run_checks()
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=sanitize_error_detail(str(exc))) from exc
    finally:
        lease_service.release(lease)
