# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.healthcheck import (
    EndpointHealthGlobalIncidentsResponse,
    EndpointHealthIncidentsResponse,
    EndpointHealthLatencyOverviewResponse,
    EndpointHealthOverviewResponse,
    EndpointHealthRawChecksResponse,
    EndpointHealthSeries,
    EndpointHealthSummaryResponse,
    WorkspaceEndpointHealthOverviewResponse,
)
from app.routers.dependencies import get_current_super_admin
from app.services.app_settings_service import load_app_settings
from app.services.healthcheck_service import HealthCheckService, HealthWindow

router = APIRouter(prefix="/admin/health", tags=["admin-healthchecks"])


def _ensure_endpoint_status_enabled() -> None:
    app_settings = load_app_settings()
    if not app_settings.general.endpoint_status_enabled:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Endpoint Status feature is disabled.",
        )


@router.get("/summary", response_model=EndpointHealthSummaryResponse)
def health_summary(
    _: dict = Depends(get_current_super_admin),
    db: Session = Depends(get_db),
) -> EndpointHealthSummaryResponse:
    _ensure_endpoint_status_enabled()
    service = HealthCheckService(db)
    return EndpointHealthSummaryResponse(**service.build_summary())


@router.get("/series", response_model=EndpointHealthSeries)
def health_series(
    endpoint_id: int = Query(..., alias="endpoint_id"),
    window: HealthWindow = Query(HealthWindow.WEEK, description="Window: day, week, month, quarter, half_year, year"),
    _: dict = Depends(get_current_super_admin),
    db: Session = Depends(get_db),
) -> EndpointHealthSeries:
    _ensure_endpoint_status_enabled()
    service = HealthCheckService(db)
    try:
        return EndpointHealthSeries(**service.build_series(endpoint_id, window))
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.get("/incidents", response_model=EndpointHealthIncidentsResponse)
def health_incidents(
    endpoint_id: int = Query(..., alias="endpoint_id"),
    window: HealthWindow = Query(HealthWindow.MONTH, description="Window: day, week, month, quarter, half_year, year"),
    _: dict = Depends(get_current_super_admin),
    db: Session = Depends(get_db),
) -> EndpointHealthIncidentsResponse:
    _ensure_endpoint_status_enabled()
    service = HealthCheckService(db)
    try:
        return EndpointHealthIncidentsResponse(**service.build_incidents(endpoint_id, window))
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.get("/raw-checks", response_model=EndpointHealthRawChecksResponse)
def health_raw_checks(
    endpoint_id: int = Query(..., alias="endpoint_id"),
    window: HealthWindow = Query(HealthWindow.WEEK, description="Window: day, week, month, quarter, half_year, year"),
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=200),
    _: dict = Depends(get_current_super_admin),
    db: Session = Depends(get_db),
) -> EndpointHealthRawChecksResponse:
    _ensure_endpoint_status_enabled()
    service = HealthCheckService(db)
    try:
        return EndpointHealthRawChecksResponse(**service.build_raw_checks(endpoint_id, window, page=page, page_size=page_size))
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.get("/overview", response_model=EndpointHealthOverviewResponse)
def health_overview(
    window: HealthWindow = Query(HealthWindow.WEEK, description="Window: day, week, month, quarter, half_year, year"),
    _: dict = Depends(get_current_super_admin),
    db: Session = Depends(get_db),
) -> EndpointHealthOverviewResponse:
    _ensure_endpoint_status_enabled()
    service = HealthCheckService(db)
    return EndpointHealthOverviewResponse(**service.build_overview(window))


@router.get("/latency-overview", response_model=EndpointHealthLatencyOverviewResponse)
def health_latency_overview(
    window: HealthWindow = Query(HealthWindow.DAY, description="Window: day, week, month, quarter, half_year, year"),
    _: dict = Depends(get_current_super_admin),
    db: Session = Depends(get_db),
) -> EndpointHealthLatencyOverviewResponse:
    _ensure_endpoint_status_enabled()
    service = HealthCheckService(db)
    return EndpointHealthLatencyOverviewResponse(**service.build_latency_overview(window))


@router.get("/incidents-global", response_model=EndpointHealthGlobalIncidentsResponse)
def health_global_incidents(
    window: HealthWindow = Query(HealthWindow.HALF_YEAR, description="Window: day, week, month, quarter, half_year, year"),
    limit: int = Query(300, ge=1, le=2000),
    _: dict = Depends(get_current_super_admin),
    db: Session = Depends(get_db),
) -> EndpointHealthGlobalIncidentsResponse:
    _ensure_endpoint_status_enabled()
    service = HealthCheckService(db)
    return EndpointHealthGlobalIncidentsResponse(**service.build_global_incidents(window, limit=limit))


@router.get("/workspace-overview", response_model=WorkspaceEndpointHealthOverviewResponse)
def workspace_health_overview(
    endpoint_id: int | None = Query(None, ge=1),
    _: dict = Depends(get_current_super_admin),
    db: Session = Depends(get_db),
) -> WorkspaceEndpointHealthOverviewResponse:
    _ensure_endpoint_status_enabled()
    service = HealthCheckService(db)
    try:
        return WorkspaceEndpointHealthOverviewResponse(**service.build_workspace_health_overview(endpoint_id=endpoint_id))
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.post("/run")
def run_healthchecks(
    _: dict = Depends(get_current_super_admin),
    db: Session = Depends(get_db),
) -> dict:
    _ensure_endpoint_status_enabled()
    service = HealthCheckService(db)
    try:
        return service.run_checks()
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
