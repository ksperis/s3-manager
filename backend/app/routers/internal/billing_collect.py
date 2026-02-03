# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.routers.dependencies import require_internal_cron_token
from app.services.billing_service import BillingCollector

router = APIRouter(prefix="/internal/billing", tags=["internal-billing"])


def _parse_day(value: str) -> date:
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid day format, expected YYYY-MM-DD") from exc


@router.post("/collect/daily")
def collect_daily(
    day: str = Query(..., description="UTC day YYYY-MM-DD"),
    _: None = Depends(require_internal_cron_token),
    db: Session = Depends(get_db),
) -> dict:
    parsed = _parse_day(day)
    collector = BillingCollector(db)
    try:
        return collector.collect_daily(parsed)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
