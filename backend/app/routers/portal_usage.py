# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Portal usage and storage statistics endpoints."""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.db import QuotaUsageDaily, S3Account, User
from app.models.access_context import AccountAccess
from app.models.bucket_usage_stats import BucketUsageStatsAggregateResponse
from app.models.portal_usage import (
    PortalStorageSpaceUsageStatsResponse,
    PortalStorageSpaceUsageStatsSnapshot,
    PortalUsage,
)
from app.models.usage_trends import UsageTrendsResponse
from app.models.usage_history import UsageHistoryTrendResponse, UsageHistoryTrendWindow
from app.routers.dependencies import get_portal_account_access
from app.routers.portal_common import (
    get_portal_service_dependency,
    raise_portal_storage_runtime,
)
from app.services.app_settings_service import load_app_settings
from app.services.bucket_usage_stats_service import (
    BucketUsageStatsAggregateTarget,
    BucketUsageStatsService,
)
from app.services.portal_service import PortalService
from app.services.usage_history_service import UsageHistoryService
from app.services.usage_trends_service import account_usage_trend_filters, build_account_usage_trends
from app.utils.storage_endpoint_features import resolve_feature_flags
from app.utils.time import utcnow

router = APIRouter()


def _portal_usage_stats_source_scope_id(account: S3Account) -> str:
    connection_id = getattr(account, "s3_connection_id", None)
    if isinstance(connection_id, int) and connection_id > 0:
        return f"conn-{connection_id}"

    s3_user_id = getattr(account, "s3_user_id", None)
    if isinstance(s3_user_id, int) and s3_user_id > 0:
        return f"s3u-{s3_user_id}"

    ceph_admin_endpoint_id = getattr(account, "ceph_admin_endpoint_id", None)
    if isinstance(ceph_admin_endpoint_id, int) and ceph_admin_endpoint_id > 0:
        return f"ceph-admin-{ceph_admin_endpoint_id}"

    account_id = getattr(account, "id", None)
    if isinstance(account_id, int) and account_id > 0:
        return str(account_id)

    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported portal account context")


def _ensure_portal_bucket_usage_stats_enabled() -> None:
    if not bool(load_app_settings().general.bucket_usage_stats_enabled):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Bucket usage stats feature is disabled")


@router.get("/usage", response_model=PortalUsage)
def portal_usage(
    access: AccountAccess = Depends(get_portal_account_access),
    service: PortalService = Depends(get_portal_service_dependency),
) -> PortalUsage:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    endpoint = getattr(access.account, "storage_endpoint", None)
    if endpoint and not resolve_feature_flags(endpoint).metrics_enabled:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Storage metrics are disabled for this endpoint")
    try:
        return service.get_usage(actor, access)
    except RuntimeError as exc:
        raise_bad_gateway_from_runtime(exc)


@router.get("/usage-trends", response_model=UsageTrendsResponse, response_model_exclude_none=True)
def portal_usage_trends(
    access: AccountAccess = Depends(get_portal_account_access),
    db: Session = Depends(get_db),
) -> UsageTrendsResponse:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    endpoint = getattr(access.account, "storage_endpoint", None)
    if endpoint and not resolve_feature_flags(endpoint).metrics_enabled:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Storage metrics are disabled for this endpoint")
    if not load_app_settings().general.usage_history_enabled:
        return UsageTrendsResponse()
    return build_account_usage_trends(db, access.account, reference_date=utcnow().date())


@router.get("/usage-stats/latest", response_model=BucketUsageStatsAggregateResponse)
def portal_usage_stats_latest(
    access: AccountAccess = Depends(get_portal_account_access),
    portal_service: PortalService = Depends(get_portal_service_dependency),
    db: Session = Depends(get_db),
) -> BucketUsageStatsAggregateResponse:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    _ensure_portal_bucket_usage_stats_enabled()
    try:
        spaces = portal_service.list_storage_spaces(actor, access)
    except RuntimeError as exc:
        raise_portal_storage_runtime(exc)
    source_scope_id = _portal_usage_stats_source_scope_id(access.account)
    targets = [
        BucketUsageStatsAggregateTarget(
            scope_kind="manager",
            scope_id=source_scope_id,
            bucket_name=space.internal_bucket_name or space.id,
        )
        for space in spaces
        if space.internal_bucket_name or space.id
    ]
    aggregate = BucketUsageStatsService().get_aggregate_for_targets(
        db,
        scope_kind="portal",
        scope_id=str(access.account.id),
        scope_name=getattr(access.account, "name", None),
        targets=targets,
    )
    return BucketUsageStatsAggregateResponse(aggregate=aggregate)


@router.get("/usage-history-trends", response_model=UsageHistoryTrendResponse)
def portal_usage_history_trends(
    window: UsageHistoryTrendWindow = Query("month"),
    access: AccountAccess = Depends(get_portal_account_access),
    db: Session = Depends(get_db),
) -> UsageHistoryTrendResponse:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    service = UsageHistoryService(db)
    if not load_app_settings().general.usage_history_enabled:
        return service.empty_trends(window=window, unavailable_reason="Usage history is disabled.")
    if account_usage_trend_filters(access.account, QuotaUsageDaily) is None:
        return service.empty_trends(window=window, unavailable_reason="Usage history trends are unavailable for this context.")
    return service.aggregate_trends(
        window=window,
        extra_filter_builder=lambda model: account_usage_trend_filters(access.account, model) or [],
    )


@router.get(
    "/storage-spaces/{space_id}/usage-stats",
    response_model=PortalStorageSpaceUsageStatsResponse,
)
def portal_storage_space_usage_stats(
    space_id: str,
    access: AccountAccess = Depends(get_portal_account_access),
    portal_service: PortalService = Depends(get_portal_service_dependency),
    db: Session = Depends(get_db),
) -> PortalStorageSpaceUsageStatsResponse:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    _ensure_portal_bucket_usage_stats_enabled()
    try:
        spaces = portal_service.list_storage_spaces(actor, access, include_archived=True)
    except RuntimeError as exc:
        raise_portal_storage_runtime(exc)
    storage_space = next((space for space in spaces if space.id == space_id), None)
    if storage_space is None or not storage_space.internal_bucket_name:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Storage space not found")
    if not storage_space.can_browse or storage_space.archived_at is not None or storage_space.status == "Archived":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Storage Space content access is required to view detailed statistics",
        )
    snapshot = BucketUsageStatsService().get_latest(
        db,
        scope_kind="manager",
        scope_id=_portal_usage_stats_source_scope_id(access.account),
        bucket_name=storage_space.internal_bucket_name,
    )
    if snapshot is None:
        return PortalStorageSpaceUsageStatsResponse()
    return PortalStorageSpaceUsageStatsResponse(
        snapshot=PortalStorageSpaceUsageStatsSnapshot.model_validate(
            snapshot.model_dump(
                include={
                    "scan_mode",
                    "version_listing_available",
                    "object_version_count",
                    "current_version_count",
                    "noncurrent_version_count",
                    "delete_marker_count",
                    "total_bytes",
                    "current_bytes",
                    "noncurrent_bytes",
                    "data_type_distribution",
                    "storage_class_distribution",
                    "size_distribution",
                    "age_distribution",
                    "current_vs_noncurrent",
                    "calculated_at",
                }
            )
        )
    )
