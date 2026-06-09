# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from app.utils.time import utcnow
import logging
from datetime import datetime, timedelta
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import get_db
from app.db import QuotaUsageDaily, S3Account
from app.models.healthcheck import WorkspaceEndpointHealthOverviewResponse
from app.models.manager_stats import ManagerUsageTrendBaseline, ManagerUsageTrendsResponse
from app.models.usage_history import UsageHistoryTrendResponse, UsageHistoryTrendWindow
from app.routers.dependencies import (
    get_account_context,
    require_metrics_capable_manager,
    require_usage_capable_manager,
)
from app.services.app_settings_service import load_app_settings
from app.services.buckets_service import BucketsService, get_buckets_service
from app.services.healthcheck_service import HealthCheckService
from app.services.rgw_admin import RGWAdminError
from app.services.rgw_iam import get_iam_service
from app.services.traffic_service import TrafficService, TrafficWindow
from app.services.usage_history_service import UsageHistoryService
from app.utils.s3_endpoint import resolve_iam_client_options

router = APIRouter(prefix="/manager/stats", tags=["manager-stats"])

logger = logging.getLogger(__name__)
settings = get_settings()

UsageTrendWindow = Literal["month", "week", "day"]
_USAGE_TREND_WINDOWS: tuple[tuple[UsageTrendWindow, str, int], ...] = (
    ("month", "last 30 days", 28),
    ("week", "last week", 6),
    ("day", "yesterday", 1),
)


def _safe_list(operation: str, func):
    try:
        return func()
    except Exception as exc:  # pragma: no cover - defensive logging
        logger.warning("Unable to fetch IAM %s stats: %s", operation, exc)
        return []


def _usage_trend_filters(account: S3Account) -> list | None:
    if getattr(account, "s3_connection_id", None) is not None:
        return None
    endpoint_id = getattr(account, "storage_endpoint_id", None)
    if endpoint_id is None:
        return None
    filters = [QuotaUsageDaily.storage_endpoint_id == int(endpoint_id)]
    s3_user_id = getattr(account, "s3_user_id", None)
    if s3_user_id is not None:
        filters.extend(
            [
                QuotaUsageDaily.s3_user_id == int(s3_user_id),
                QuotaUsageDaily.s3_account_id.is_(None),
            ]
        )
    else:
        filters.extend(
            [
                QuotaUsageDaily.s3_account_id == int(account.id),
                QuotaUsageDaily.s3_user_id.is_(None),
            ]
        )
    return filters


def _usage_history_trend_filters(account: S3Account, model) -> list | None:
    if getattr(account, "s3_connection_id", None) is not None:
        return None
    endpoint_id = getattr(account, "storage_endpoint_id", None)
    if endpoint_id is None:
        return None
    filters = [model.storage_endpoint_id == int(endpoint_id)]
    s3_user_id = getattr(account, "s3_user_id", None)
    if s3_user_id is not None:
        filters.extend(
            [
                model.s3_user_id == int(s3_user_id),
                model.s3_account_id.is_(None),
            ]
        )
    else:
        filters.extend(
            [
                model.s3_account_id == int(account.id),
                model.s3_user_id.is_(None),
            ]
        )
    return filters


def _serialize_usage_trend_baseline(
    row: QuotaUsageDaily,
    *,
    window: UsageTrendWindow,
    label: str,
) -> ManagerUsageTrendBaseline:
    return ManagerUsageTrendBaseline(
        window=window,
        label=label,
        period_start=row.day.isoformat(),
        used_bytes=int(row.last_used_bytes or 0),
        used_objects=int(row.last_used_objects or 0),
        bucket_count=int(row.bucket_count) if row.bucket_count is not None else None,
        collected_at=row.updated_at.isoformat() if row.updated_at else None,
    )


def _select_usage_trend_baseline(
    db: Session,
    *,
    filters: list,
    value_column,
) -> ManagerUsageTrendBaseline | None:
    today = utcnow().date()
    for window, label, min_age_days in _USAGE_TREND_WINDOWS:
        cutoff = today - timedelta(days=min_age_days)
        row = (
            db.query(QuotaUsageDaily)
            .filter(*filters, QuotaUsageDaily.day <= cutoff, value_column.isnot(None))
            .order_by(QuotaUsageDaily.day.desc(), QuotaUsageDaily.updated_at.desc(), QuotaUsageDaily.id.desc())
            .first()
        )
        if row is not None:
            return _serialize_usage_trend_baseline(row, window=window, label=label)
    return None


@router.get("/overview")
def account_stats(
    account: S3Account = Depends(get_account_context),
    bucket_service: BucketsService = Depends(get_buckets_service),
    _: dict = Depends(require_usage_capable_manager),
) -> dict:
    if not account.rgw_account_id and not account.rgw_user_uid:
        raise HTTPException(status_code=400, detail="Storage metrics not available for this account")
    try:
        buckets = bucket_service.list_buckets(account)
        total_buckets = len(buckets)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Unable to fetch buckets: {exc}") from exc

    caps = getattr(account, "_manager_capabilities", None)
    users: list = []
    groups: list = []
    roles: list = []
    policies: list = []
    if not caps or caps.can_manage_iam:
        access_key, secret_key = account.effective_rgw_credentials()
        if not access_key or not secret_key:
            raise HTTPException(status_code=400, detail="S3Account root keys missing")
        endpoint, region, verify_tls = resolve_iam_client_options(account)
        iam = get_iam_service(
            access_key,
            secret_key,
            endpoint=endpoint,
            region=region,
            verify_tls=verify_tls,
        )
        users = _safe_list("users", iam.list_users)
        groups = _safe_list("groups", iam.list_groups)
        roles = _safe_list("roles", iam.list_roles)
        policies = _safe_list("policies", iam.list_policies)

    total_bytes = sum((bucket.used_bytes or 0) for bucket in buckets if bucket.used_bytes is not None)
    total_objects = sum((bucket.object_count or 0) for bucket in buckets if bucket.object_count is not None)
    bucket_usage = [
        {
            "name": bucket.name,
            "used_bytes": bucket.used_bytes,
            "object_count": bucket.object_count,
        }
        for bucket in buckets
    ]
    bucket_usage.sort(key=lambda bucket: bucket["used_bytes"] or 0, reverse=True)

    non_empty_buckets = [entry for entry in bucket_usage if (entry["used_bytes"] or 0) > 0]
    object_sorted = sorted(bucket_usage, key=lambda entry: entry["object_count"] or 0, reverse=True)
    avg_bucket_size = (
        int(sum((entry["used_bytes"] or 0) for entry in non_empty_buckets) / len(non_empty_buckets))
        if non_empty_buckets
        else None
    )
    object_samples = [entry["object_count"] or 0 for entry in bucket_usage if entry["object_count"] not in (None, 0)]
    avg_object_count = int(sum(object_samples) / len(object_samples)) if object_samples else None
    bucket_overview = {
        "bucket_count": total_buckets,
        "non_empty_buckets": len(non_empty_buckets),
        "empty_buckets": max(total_buckets - len(non_empty_buckets), 0),
        "avg_bucket_size_bytes": avg_bucket_size,
        "avg_objects_per_bucket": avg_object_count,
        "largest_bucket": bucket_usage[0] if bucket_usage else None,
        "most_objects_bucket": object_sorted[0] if object_sorted else None,
    }

    return {
        "total_buckets": total_buckets,
        "total_iam_users": len(users),
        "total_iam_groups": len(groups),
        "total_iam_roles": len(roles),
        "total_iam_policies": len(policies),
        "total_bytes": total_bytes,
        "total_objects": total_objects,
        "bucket_usage": bucket_usage,
        "bucket_overview": bucket_overview,
    }


@router.get("/usage-trends", response_model=ManagerUsageTrendsResponse, response_model_exclude_none=True)
def account_usage_trends(
    account: S3Account = Depends(get_account_context),
    _: dict = Depends(require_usage_capable_manager),
    db: Session = Depends(get_db),
) -> ManagerUsageTrendsResponse:
    if not load_app_settings().general.usage_history_enabled:
        return ManagerUsageTrendsResponse()
    filters = _usage_trend_filters(account)
    if not filters:
        return ManagerUsageTrendsResponse()
    return ManagerUsageTrendsResponse(
        storage=_select_usage_trend_baseline(db, filters=filters, value_column=QuotaUsageDaily.last_used_bytes),
        objects=_select_usage_trend_baseline(db, filters=filters, value_column=QuotaUsageDaily.last_used_objects),
        buckets=_select_usage_trend_baseline(db, filters=filters, value_column=QuotaUsageDaily.bucket_count),
    )


@router.get("/usage-history-trends", response_model=UsageHistoryTrendResponse)
def account_usage_history_trends(
    window: UsageHistoryTrendWindow = Query("month"),
    account: S3Account = Depends(get_account_context),
    _: dict = Depends(require_usage_capable_manager),
    db: Session = Depends(get_db),
) -> UsageHistoryTrendResponse:
    service = UsageHistoryService(db)
    if not load_app_settings().general.usage_history_enabled:
        return service.empty_trends(window=window, unavailable_reason="Usage history is disabled.")
    if getattr(account, "s3_connection_id", None) is not None:
        return service.empty_trends(
            window=window,
            unavailable_reason=(
                "Usage history trends are unavailable for private connection contexts because snapshots are stored "
                "for RGW accounts and legacy S3 users."
            ),
        )
    if _usage_history_trend_filters(account, QuotaUsageDaily) is None:
        return service.empty_trends(window=window, unavailable_reason="Usage history trends are unavailable for this context.")
    return service.aggregate_trends(
        window=window,
        extra_filter_builder=lambda model: _usage_history_trend_filters(account, model) or [],
    )


@router.get("/traffic")
def account_traffic(
    window: TrafficWindow = Query(TrafficWindow.WEEK),
    bucket: Optional[str] = Query(None),
    account: S3Account = Depends(get_account_context),
    _: dict = Depends(require_metrics_capable_manager),
) -> dict:
    try:
        service = TrafficService(account)
    except ValueError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    try:
        return service.get_traffic(window=window, bucket=bucket)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RGWAdminError as exc:
        raise HTTPException(status_code=502, detail=f"Unable to fetch traffic logs: {exc}") from exc


@router.get("/endpoint-health", response_model=WorkspaceEndpointHealthOverviewResponse)
def endpoint_health_overview(
    account: S3Account = Depends(get_account_context),
    db: Session = Depends(get_db),
) -> WorkspaceEndpointHealthOverviewResponse:
    app_settings = load_app_settings()
    if not app_settings.general.endpoint_status_enabled:
        raise HTTPException(status_code=403, detail="Endpoint Status feature is disabled.")
    endpoint_id = getattr(account, "storage_endpoint_id", None)
    if endpoint_id is None:
        return WorkspaceEndpointHealthOverviewResponse(
            generated_at=utcnow().isoformat(),
            incident_highlight_minutes=max(1, int(settings.healthcheck_incident_recent_minutes or 720)),
            endpoint_count=0,
            up_count=0,
            degraded_count=0,
            down_count=0,
            unknown_count=0,
            endpoints=[],
            incidents=[],
        )
    service = HealthCheckService(db)
    return WorkspaceEndpointHealthOverviewResponse(
        **service.build_workspace_health_overview(endpoint_id=int(endpoint_id))
    )
