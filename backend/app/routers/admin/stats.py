# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.db_models import StorageEndpoint, StorageProvider
from app.routers.dependencies import get_current_super_admin
from app.services.admin_metrics_service import AdminMetricsService
from app.services.rgw_admin import RGWAdminClient
from app.services.traffic_service import TrafficWindow
from app.utils.rgw import get_supervision_rgw_client
from app.utils.storage_endpoint_features import normalize_features_config

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
