# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.db_models import S3Account, StorageEndpoint, StorageProvider
from app.routers.dependencies import get_current_super_admin
from app.services.admin_metrics_service import AdminMetricsService
from app.services.rgw_admin import RGWAdminClient, RGWAdminError
from app.services.traffic_service import TrafficWindow
from app.utils.rgw import extract_bucket_list, get_supervision_rgw_client, resolve_admin_uid
from app.utils.storage_endpoint_features import normalize_features_config
from app.utils.usage_stats import extract_usage_stats

router = APIRouter(prefix="/admin/stats", tags=["admin-stats"])


def _resolve_endpoint(
    db: Session,
    endpoint_id: Optional[int],
    *,
    require_usage: bool = False,
    require_metrics: bool = False,
) -> StorageEndpoint:
    if endpoint_id is not None:
        endpoint = db.query(StorageEndpoint).filter(StorageEndpoint.id == endpoint_id).first()
        if not endpoint:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Endpoint not found.")
    else:
        endpoint = (
            db.query(StorageEndpoint)
            .filter(StorageEndpoint.is_default.is_(True), StorageEndpoint.provider == StorageProvider.CEPH.value)
            .first()
        )
        if not endpoint:
            endpoint = (
                db.query(StorageEndpoint)
                .filter(StorageEndpoint.provider == StorageProvider.CEPH.value)
                .order_by(StorageEndpoint.is_default.desc(), StorageEndpoint.id.asc())
                .first()
            )
    if not endpoint:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No Ceph endpoint available.")
    try:
        provider = StorageProvider(endpoint.provider)
    except Exception:
        provider = StorageProvider.OTHER
    if provider != StorageProvider.CEPH:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This endpoint is not a Ceph endpoint.")
    features = normalize_features_config(endpoint.provider, endpoint.features_config)
    if require_usage and not features["usage"]["enabled"]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Usage metrics are disabled for this endpoint")
    if require_metrics and not features["metrics"]["enabled"]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Traffic metrics are disabled for this endpoint")
    if not endpoint.endpoint_url:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Endpoint URL is missing.")
    if not endpoint.supervision_access_key or not endpoint.supervision_secret_key:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Supervision credentials are not configured for this endpoint.",
        )
    return endpoint


def _build_rgw_client(endpoint: StorageEndpoint) -> RGWAdminClient:
    return get_supervision_rgw_client(endpoint)


def _resolve_account_endpoint(db: Session, account: S3Account) -> StorageEndpoint:
    if account.storage_endpoint_id is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Storage endpoint is not configured for this account.",
        )
    return _resolve_endpoint(db, account.storage_endpoint_id, require_usage=True)


@router.get("/summary")
def summary_stats(
    _: dict = Depends(get_current_super_admin),
    db: Session = Depends(get_db),
) -> dict:
    """
    Lightweight counts-only endpoint used by the admin dashboard.
    Avoids RGW calls to keep the page responsive.
    """
    return AdminMetricsService.build_summary_payload(db)


@router.get("/account")
def account_stats(
    _: dict = Depends(get_current_super_admin),
    db: Session = Depends(get_db),
    account_id: int = Query(..., alias="account_id"),
) -> dict:
    account = db.query(S3Account).filter(S3Account.id == account_id).first()
    if not account:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="S3Account not found")

    endpoint = _resolve_account_endpoint(db, account)
    rgw_admin = _build_rgw_client(endpoint)
    uid = resolve_admin_uid(account.rgw_account_id, account.rgw_user_uid)
    if not uid:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Usage metrics not available for this account")
    try:
        payload = rgw_admin.get_all_buckets(uid=uid, with_stats=True)
    except RGWAdminError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"Unable to fetch buckets: {exc}") from exc

    buckets = extract_bucket_list(payload)
    bucket_usage: list[dict] = []
    for bucket in buckets:
        if not isinstance(bucket, dict):
            continue
        name = bucket.get("bucket") or bucket.get("name")
        if not name:
            continue
        used_bytes, object_count = extract_usage_stats(bucket.get("usage"))
        bucket_usage.append(
            {
                "name": name,
                "used_bytes": used_bytes,
                "object_count": object_count,
            }
        )

    bucket_usage.sort(key=lambda bucket: bucket.get("used_bytes") or 0, reverse=True)
    total_bytes = sum((entry.get("used_bytes") or 0) for entry in bucket_usage if entry.get("used_bytes") is not None)
    total_objects = sum(
        (entry.get("object_count") or 0) for entry in bucket_usage if entry.get("object_count") is not None
    )
    total_buckets = len(bucket_usage)

    non_empty_buckets = [entry for entry in bucket_usage if (entry.get("used_bytes") or 0) > 0]
    object_sorted = sorted(bucket_usage, key=lambda entry: entry.get("object_count") or 0, reverse=True)
    avg_bucket_size = (
        int(sum((entry.get("used_bytes") or 0) for entry in non_empty_buckets) / len(non_empty_buckets))
        if non_empty_buckets
        else None
    )
    object_samples = [
        entry.get("object_count") or 0
        for entry in bucket_usage
        if entry.get("object_count") not in (None, 0)
    ]
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
        "total_iam_users": 0,
        "total_iam_groups": 0,
        "total_iam_roles": 0,
        "total_iam_policies": 0,
        "total_bytes": total_bytes,
        "total_objects": total_objects,
        "bucket_usage": bucket_usage,
        "bucket_overview": bucket_overview,
    }


@router.get("/overview")
def global_stats(
    _: dict = Depends(get_current_super_admin),
    db: Session = Depends(get_db),
    window: TrafficWindow = Query(TrafficWindow.WEEK),
    endpoint_id: Optional[int] = Query(default=None, alias="endpoint_id"),
) -> dict:
    endpoint = _resolve_endpoint(db, endpoint_id, require_usage=True, require_metrics=True)
    rgw_admin = _build_rgw_client(endpoint)
    service = AdminMetricsService(
        db=db,
        rgw_admin=rgw_admin,
        endpoint_id=endpoint.id,
    )
    return service.metrics(window=window)


@router.get("/storage")
def storage_stats(
    _: dict = Depends(get_current_super_admin),
    db: Session = Depends(get_db),
    endpoint_id: Optional[int] = Query(default=None, alias="endpoint_id"),
) -> dict:
    endpoint = _resolve_endpoint(db, endpoint_id, require_usage=True)
    rgw_admin = _build_rgw_client(endpoint)
    service = AdminMetricsService(
        db=db,
        rgw_admin=rgw_admin,
        endpoint_id=endpoint.id,
    )
    return service.storage()


@router.get("/traffic")
def traffic_stats(
    window: TrafficWindow = Query(TrafficWindow.WEEK),
    _: dict = Depends(get_current_super_admin),
    db: Session = Depends(get_db),
    endpoint_id: Optional[int] = Query(default=None, alias="endpoint_id"),
) -> dict:
    endpoint = _resolve_endpoint(db, endpoint_id, require_metrics=True)
    rgw_admin = _build_rgw_client(endpoint)
    service = AdminMetricsService(
        db=db,
        rgw_admin=rgw_admin,
        endpoint_id=endpoint.id,
    )
    return service.traffic(window=window)
