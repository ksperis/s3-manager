# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.routers.dependencies import require_internal_cron_token
from app.services.quota_monitoring_service import QuotaMonitoringService

router = APIRouter(prefix="/internal/quota-monitor", tags=["internal-quota-monitor"])


@router.post("/run")
def run_quota_monitor(
    _: None = Depends(require_internal_cron_token),
    db: Session = Depends(get_db),
) -> dict:
    service = QuotaMonitoringService(db)
    try:
        return service.run_monitor()
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
