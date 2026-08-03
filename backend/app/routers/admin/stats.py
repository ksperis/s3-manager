# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.db import S3Account, S3User, StorageEndpoint, StorageProvider, User
from app.routers.dependencies import get_current_super_admin
from app.core.sensitive_data import sanitized_error_log_detail
from app.services.admin_metrics_service import AdminMetricsService
from app.services.rgw_admin import RGWAdminClient, RGWAdminError
from app.services.traffic_service import TrafficWindow
from app.services.rgw_supervision import get_supervision_rgw_client
from app.utils.rgw_identifiers import resolve_admin_uid
from app.utils.rgw_payloads import extract_bucket_list
from app.utils.storage_endpoint_features import normalize_features_config
from app.utils.usage_stats import build_bucket_overview, summarize_bucket_usage

router = APIRouter(prefix="/admin/stats", tags=["admin-stats"])


def _resolve_endpoint(
    db: Session,
    endpoint_id: Optional[int],
    *,
    require_storage_metrics: bool = False,
    require_usage_logs: bool = False,
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
    if require_storage_metrics and not features["metrics"]["enabled"]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Storage metrics are disabled for this endpoint")
    if require_usage_logs and not features["usage"]["enabled"]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Usage logs are disabled for this endpoint")
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
    return _resolve_endpoint(db, account.storage_endpoint_id, require_storage_metrics=True)


def _resolve_s3_user_endpoint(db: Session, s3_user: S3User) -> StorageEndpoint:
    if s3_user.storage_endpoint_id is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Storage endpoint is not configured for this user.",
        )
    return _resolve_endpoint(db, s3_user.storage_endpoint_id, require_storage_metrics=True)


def _load_principal_bucket_stats(rgw_admin: RGWAdminClient, uid: str) -> dict:
    try:
        payload = rgw_admin.get_all_buckets(uid=uid, with_stats=True)
    except RGWAdminError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Unable to fetch buckets: {sanitized_error_log_detail(exc)}",
        ) from exc

    bucket_usage, total_bytes, total_objects, total_buckets = summarize_bucket_usage(extract_bucket_list(payload))
    return {
        "total_buckets": total_buckets,
        "total_iam_users": 0,
        "total_iam_groups": 0,
        "total_iam_roles": 0,
        "total_iam_policies": 0,
        "total_bytes": total_bytes or 0,
        "total_objects": total_objects or 0,
        "bucket_usage": bucket_usage,
        "bucket_overview": build_bucket_overview(bucket_usage),
    }


@router.get("/summary")
def summary_stats(
    _: User = Depends(get_current_super_admin),
    db: Session = Depends(get_db),
) -> dict:
    """
    Lightweight counts-only endpoint used by the admin dashboard.
    Avoids RGW calls to keep the page responsive.
    """
    return AdminMetricsService.build_summary_payload(db)


@router.get("/account")
def account_stats(
    _: User = Depends(get_current_super_admin),
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
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Storage metrics not available for this account")
    return _load_principal_bucket_stats(rgw_admin, uid)


@router.get("/s3-user")
def s3_user_stats(
    _: User = Depends(get_current_super_admin),
    db: Session = Depends(get_db),
    user_id: int = Query(..., alias="user_id"),
) -> dict:
    s3_user = db.query(S3User).filter(S3User.id == user_id).first()
    if not s3_user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="S3 user not found")

    endpoint = _resolve_s3_user_endpoint(db, s3_user)
    rgw_admin = _build_rgw_client(endpoint)
    if not s3_user.rgw_user_uid:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Storage metrics not available for this user")
    return _load_principal_bucket_stats(rgw_admin, s3_user.rgw_user_uid)


@router.get("/overview")
def global_stats(
    _: User = Depends(get_current_super_admin),
    db: Session = Depends(get_db),
    window: TrafficWindow = Query(TrafficWindow.WEEK),
    endpoint_id: Optional[int] = Query(default=None, alias="endpoint_id"),
) -> dict:
    endpoint = _resolve_endpoint(db, endpoint_id, require_storage_metrics=True, require_usage_logs=True)
    rgw_admin = _build_rgw_client(endpoint)
    service = AdminMetricsService(
        db=db,
        rgw_admin=rgw_admin,
        endpoint_id=endpoint.id,
    )
    return service.metrics(window=window)


@router.get("/storage")
def storage_stats(
    _: User = Depends(get_current_super_admin),
    db: Session = Depends(get_db),
    endpoint_id: Optional[int] = Query(default=None, alias="endpoint_id"),
) -> dict:
    endpoint = _resolve_endpoint(db, endpoint_id, require_storage_metrics=True)
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
    _: User = Depends(get_current_super_admin),
    db: Session = Depends(get_db),
    endpoint_id: Optional[int] = Query(default=None, alias="endpoint_id"),
) -> dict:
    endpoint = _resolve_endpoint(db, endpoint_id, require_usage_logs=True)
    rgw_admin = _build_rgw_client(endpoint)
    service = AdminMetricsService(
        db=db,
        rgw_admin=rgw_admin,
        endpoint_id=endpoint.id,
    )
    return service.traffic(window=window)
