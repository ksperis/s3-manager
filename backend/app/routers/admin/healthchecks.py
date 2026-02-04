# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.healthcheck import (
    EndpointHealthIncidentsResponse,
    EndpointHealthSeries,
    EndpointHealthSummaryResponse,
)
from app.routers.dependencies import get_current_super_admin
from app.services.healthcheck_service import HealthCheckService, HealthWindow

router = APIRouter(prefix="/admin/health", tags=["admin-healthchecks"])


@router.get("/summary", response_model=EndpointHealthSummaryResponse)
def health_summary(
    _: dict = Depends(get_current_super_admin),
    db: Session = Depends(get_db),
) -> EndpointHealthSummaryResponse:
    service = HealthCheckService(db)
    return EndpointHealthSummaryResponse(**service.build_summary())


@router.get("/series", response_model=EndpointHealthSeries)
def health_series(
    endpoint_id: int = Query(..., alias="endpoint_id"),
    window: HealthWindow = Query(HealthWindow.WEEK, description="Window: day, week, month, quarter, year"),
    _: dict = Depends(get_current_super_admin),
    db: Session = Depends(get_db),
) -> EndpointHealthSeries:
    service = HealthCheckService(db)
    try:
        return EndpointHealthSeries(**service.build_series(endpoint_id, window))
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.get("/incidents", response_model=EndpointHealthIncidentsResponse)
def health_incidents(
    endpoint_id: int = Query(..., alias="endpoint_id"),
    window: HealthWindow = Query(HealthWindow.MONTH, description="Window: day, week, month, quarter, year"),
    _: dict = Depends(get_current_super_admin),
    db: Session = Depends(get_db),
    ) -> EndpointHealthIncidentsResponse:
    service = HealthCheckService(db)
    try:
        return EndpointHealthIncidentsResponse(**service.build_incidents(endpoint_id, window))
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.post("/run")
def run_healthchecks(
    _: dict = Depends(get_current_super_admin),
    db: Session = Depends(get_db),
) -> dict:
    service = HealthCheckService(db)
    try:
        return service.run_checks()
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
