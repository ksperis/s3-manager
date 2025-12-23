# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import get_db
from app.db_models import StorageEndpoint, StorageProvider
from app.routers.dependencies import get_current_super_admin
from app.services.admin_metrics_service import AdminMetricsService
from app.services.rgw_admin import RGWAdminClient, get_rgw_admin_client
from app.services.traffic_service import TrafficWindow

router = APIRouter(prefix="/admin/stats", tags=["admin-stats"])
settings = get_settings()


def _resolve_endpoint(db: Session, endpoint_id: Optional[int]) -> StorageEndpoint:
    if endpoint_id is not None:
        endpoint = db.query(StorageEndpoint).filter(StorageEndpoint.id == endpoint_id).first()
        if not endpoint:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Endpoint introuvable")
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
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Aucun endpoint Ceph disponible")
    try:
        provider = StorageProvider(endpoint.provider)
    except Exception:
        provider = StorageProvider.OTHER
    if provider != StorageProvider.CEPH:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cet endpoint n'est pas de type Ceph")
    if not endpoint.endpoint_url:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="L'URL de l'endpoint est manquante.")
    if not endpoint.admin_access_key or not endpoint.admin_secret_key:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Les identifiants admin de l'endpoint ne sont pas configurés.",
        )
    return endpoint


def _build_rgw_client(endpoint: StorageEndpoint) -> RGWAdminClient:
    admin_endpoint = endpoint.admin_endpoint or endpoint.endpoint_url
    region = endpoint.region or settings.s3_region
    return get_rgw_admin_client(
        access_key=endpoint.admin_access_key,
        secret_key=endpoint.admin_secret_key,
        endpoint=admin_endpoint,
        region=region,
    )


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
    endpoint = _resolve_endpoint(db, endpoint_id)
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
    endpoint = _resolve_endpoint(db, endpoint_id)
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
    endpoint = _resolve_endpoint(db, endpoint_id)
    rgw_admin = _build_rgw_client(endpoint)
    service = AdminMetricsService(
        db=db,
        rgw_admin=rgw_admin,
        endpoint_id=endpoint.id,
    )
    return service.traffic(window=window)
