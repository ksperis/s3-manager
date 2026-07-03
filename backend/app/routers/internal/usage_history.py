# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.routers.dependencies import require_internal_cron_token
from app.services.quota_monitoring_service import QuotaMonitoringService
from app.routers.http_errors import sanitize_error_detail

router = APIRouter(prefix="/internal/usage-history", tags=["internal-usage-history"])


@router.post("/collect")
def collect_usage_history(
    _: None = Depends(require_internal_cron_token),
    db: Session = Depends(get_db),
) -> dict:
    service = QuotaMonitoringService(db)
    try:
        return service.run_monitor(include_quota_alerts=False, include_usage_history=True)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=sanitize_error_detail(str(exc))) from exc
