# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from datetime import datetime, date

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import get_db
from app.db import StorageEndpoint, StorageProvider
from app.models.billing import BillingSubjectDetail, BillingSubjectsResponse, BillingSummary
from app.routers.dependencies import get_current_super_admin
from app.services.billing_service import BillingService, BillingCollector
from app.services.app_settings_service import load_app_settings

settings = get_settings()
router = APIRouter(prefix="/admin/billing", tags=["admin-billing"])


def _ensure_billing_enabled() -> None:
    app_settings = load_app_settings()
    if not settings.billing_enabled or not app_settings.general.billing_enabled:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Billing is disabled")


def _parse_day(value: str) -> date:
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid day format, expected YYYY-MM-DD") from exc


def _resolve_endpoint(db: Session, endpoint_id: int) -> StorageEndpoint:
    endpoint = db.query(StorageEndpoint).filter(StorageEndpoint.id == endpoint_id).first()
    if not endpoint:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Endpoint not found")
    try:
        provider = StorageProvider(endpoint.provider)
    except Exception:
        provider = StorageProvider.OTHER
    if provider != StorageProvider.CEPH:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This endpoint is not a Ceph endpoint")
    return endpoint


@router.get("/summary", response_model=BillingSummary)
def billing_summary(
    month: str = Query(..., description="YYYY-MM"),
    endpoint_id: int | None = Query(None),
    _: dict = Depends(get_current_super_admin),
    db: Session = Depends(get_db),
) -> BillingSummary:
    _ensure_billing_enabled()
    if endpoint_id is not None:
        _resolve_endpoint(db, endpoint_id)
    service = BillingService(db)
    try:
        return service.summary(month, endpoint_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post("/collect/daily")
def billing_collect_daily(
    day: str = Query(..., description="UTC day YYYY-MM-DD"),
    _: dict = Depends(get_current_super_admin),
    db: Session = Depends(get_db),
) -> dict:
    _ensure_billing_enabled()
    parsed = _parse_day(day)
    collector = BillingCollector(db)
    try:
        return collector.collect_daily(parsed)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.get("/subjects", response_model=BillingSubjectsResponse)
def billing_subjects(
    month: str = Query(..., description="YYYY-MM"),
    endpoint_id: int = Query(...),
    subject_type: str = Query("account", alias="type"),
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=200),
    sort_by: str = Query("name"),
    sort_dir: str = Query("asc"),
    _: dict = Depends(get_current_super_admin),
    db: Session = Depends(get_db),
) -> BillingSubjectsResponse:
    _ensure_billing_enabled()
    _resolve_endpoint(db, endpoint_id)
    service = BillingService(db)
    try:
        return service.list_subjects(month, endpoint_id, subject_type, page, page_size, sort_by, sort_dir)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.get("/subject/{subject_type}/{subject_id}", response_model=BillingSubjectDetail)
def billing_subject_detail(
    subject_type: str,
    subject_id: int,
    month: str = Query(..., description="YYYY-MM"),
    endpoint_id: int = Query(...),
    _: dict = Depends(get_current_super_admin),
    db: Session = Depends(get_db),
) -> BillingSubjectDetail:
    _ensure_billing_enabled()
    _resolve_endpoint(db, endpoint_id)
    service = BillingService(db)
    try:
        return service.subject_detail(month, endpoint_id, subject_type, subject_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.get("/export.csv")
def billing_export_csv(
    month: str = Query(..., description="YYYY-MM"),
    endpoint_id: int = Query(...),
    _: dict = Depends(get_current_super_admin),
    db: Session = Depends(get_db),
) -> Response:
    _ensure_billing_enabled()
    _resolve_endpoint(db, endpoint_id)
    service = BillingService(db)
    try:
        filename, payload = service.export_csv(month, endpoint_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    headers = {"Content-Disposition": f"attachment; filename=\"{filename}\""}
    return Response(content=payload, media_type="text/csv", headers=headers)
