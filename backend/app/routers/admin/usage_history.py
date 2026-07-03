# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from datetime import date, datetime, time, timezone
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.db import User
from app.models.usage_history import UsageHistoryResponse, UsageHistoryTrendResponse
from app.routers.dependencies import get_audit_logger, get_current_super_admin
from app.services.app_settings_service import load_app_settings
from app.services.audit_service import AuditService
from app.services.operation_lease_service import (
    OperationLeaseService,
    USAGE_HISTORY_COLLECT_OPERATION,
    default_operation_lease_ttl_seconds,
)
from app.services.quota_monitoring_service import QuotaMonitoringService
from app.services.usage_history_service import UsageHistoryService
from app.routers.http_errors import sanitize_error_detail

router = APIRouter(prefix="/admin/usage-history", tags=["admin-usage-history"])


def _ensure_usage_history_enabled() -> None:
    app_settings = load_app_settings()
    if not app_settings.general.usage_history_enabled:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Usage history is disabled")


def _parse_boundary(
    value: Optional[str],
    *,
    granularity: Literal["daily", "hourly"],
    is_end: bool,
) -> date | datetime | None:
    if not value:
        return None
    try:
        if granularity == "daily":
            return date.fromisoformat(value[:10])
        if "T" not in value:
            parsed_day = date.fromisoformat(value[:10])
            return datetime.combine(parsed_day, time.max if is_end else time.min)
        normalized = value.replace("Z", "+00:00")
        parsed = datetime.fromisoformat(normalized)
        if parsed.tzinfo is not None:
            parsed = parsed.astimezone(timezone.utc).replace(tzinfo=None)
        return parsed
    except ValueError as exc:
        expected = "YYYY-MM-DD" if granularity == "daily" else "YYYY-MM-DD or ISO datetime"
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Invalid date boundary, expected {expected}") from exc


@router.get("", response_model=UsageHistoryResponse)
def list_usage_history(
    granularity: Literal["daily", "hourly"] = Query("daily"),
    endpoint_id: Optional[int] = Query(None),
    subject_type: Literal["all", "account", "s3_user"] = Query("all"),
    start: Optional[str] = Query(None),
    end: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    sort_by: Literal["period", "subject", "used_bytes", "used_objects", "ratio"] = Query("period"),
    sort_dir: Literal["asc", "desc"] = Query("desc"),
    _: User = Depends(get_current_super_admin),
    db: Session = Depends(get_db),
) -> UsageHistoryResponse:
    _ensure_usage_history_enabled()
    service = UsageHistoryService(db)
    return service.list_records(
        granularity=granularity,
        endpoint_id=endpoint_id,
        subject_type=subject_type,
        start=_parse_boundary(start, granularity=granularity, is_end=False),
        end=_parse_boundary(end, granularity=granularity, is_end=True),
        page=page,
        page_size=page_size,
        sort_by=sort_by,
        sort_dir=sort_dir,
    )


@router.get("/trends", response_model=UsageHistoryTrendResponse)
def usage_history_trends(
    window: Literal["day", "week", "month"] = Query("month"),
    endpoint_id: Optional[int] = Query(None),
    subject_type: Literal["all", "account", "s3_user"] = Query("all"),
    _: User = Depends(get_current_super_admin),
    db: Session = Depends(get_db),
) -> UsageHistoryTrendResponse:
    _ensure_usage_history_enabled()
    service = UsageHistoryService(db)
    return service.aggregate_trends(window=window, endpoint_id=endpoint_id, subject_type=subject_type)


@router.post("/collect")
def collect_usage_history(
    current_user: User = Depends(get_current_super_admin),
    audit_service: AuditService = Depends(get_audit_logger),
    db: Session = Depends(get_db),
) -> dict:
    _ensure_usage_history_enabled()
    lease_service = OperationLeaseService(db)
    lease = lease_service.acquire(
        USAGE_HISTORY_COLLECT_OPERATION,
        ttl_seconds=default_operation_lease_ttl_seconds(),
        lease_context={"source": "admin", "user_id": current_user.id},
    )
    if lease is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Usage history collection is already running.",
        )
    service = QuotaMonitoringService(db)
    try:
        result = service.run_monitor(include_quota_alerts=False, include_usage_history=True)
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=sanitize_error_detail(str(exc))) from exc
    finally:
        lease_service.release(lease)

    audit_service.record_action(
        user=current_user,
        scope="admin",
        action="collect_usage_history",
        entity_type="usage_history",
        metadata={
            "subjects_total": result.get("subjects_total"),
            "subjects_processed": result.get("subjects_processed"),
            "history_hourly_upserts": result.get("history_hourly_upserts"),
            "history_daily_upserts": result.get("history_daily_upserts"),
            "errors_count": len(result.get("errors") or []),
            "manual_trigger": True,
        },
    )
    return result
