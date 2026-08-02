# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Optional

from fastapi import Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.db import StorageEndpoint, StorageProvider, User, is_admin_ui_role
from app.models.account_capabilities import AccountCapabilities
from app.services import app_settings_service, effective_access_service
from app.services.rgw_admin import RGWAdminClient, get_rgw_admin_client
from app.services.s3_execution_context import S3ExecutionContext
from app.services.storage_endpoints_service import get_storage_endpoints_service
from app.utils.s3_endpoint import normalize_s3_endpoint
from app.utils.storage_endpoint_features import resolve_admin_endpoint, resolve_feature_flags

from .auth_session import get_current_super_admin


def _build_ceph_admin_browser_context(endpoint: StorageEndpoint) -> S3ExecutionContext:
    return S3ExecutionContext.from_ceph_admin_endpoint(
        endpoint,
        access_key=endpoint.ceph_admin_access_key,
        secret_key=endpoint.ceph_admin_secret_key,
        manager_capabilities=AccountCapabilities(
            can_manage_buckets=True,
            can_manage_iam=False,
            can_view_root_key=False,
            using_root_key=False,
        ),
    )


def _resolve_ceph_admin_browser_context(
    db: Session,
    actor: User,
    endpoint_id: int,
    *,
    surface: str,
) -> S3ExecutionContext:
    if surface != "browser":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Ceph Admin context is only allowed in browser workspace")
    app_settings = app_settings_service.load_app_settings()
    if not app_settings.general.ceph_admin_enabled:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Ceph Admin feature is disabled")
    if not app_settings.general.browser_ceph_admin_enabled:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Browser is disabled for Ceph Admin workspace")
    effective = effective_access_service.EffectiveAccessService(db).resolve_user(actor)
    if not is_admin_ui_role(actor.role) or not effective.can_access_ceph_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized for Ceph Admin browser workspace")

    endpoint = db.query(StorageEndpoint).filter(StorageEndpoint.id == endpoint_id).first()
    if not endpoint:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Storage endpoint not found")
    provider = StorageProvider(str(endpoint.provider))
    if provider != StorageProvider.CEPH:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Storage endpoint is not a Ceph provider")

    access_key = endpoint.ceph_admin_access_key
    secret_key = endpoint.ceph_admin_secret_key
    if not access_key or not secret_key:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Ceph Admin credentials are not configured for this storage endpoint",
        )
    if not normalize_s3_endpoint(getattr(endpoint, "endpoint_url", None)):
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="S3 endpoint URL is not configured for this storage endpoint",
        )
    from app.routers.ceph_admin.dependencies import validate_ceph_admin_service_identity

    identity_validation_error = validate_ceph_admin_service_identity(endpoint)
    if identity_validation_error:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=identity_validation_error)
    return _build_ceph_admin_browser_context(endpoint)

def _resolve_default_endpoint(db: Session) -> StorageEndpoint:
    service = get_storage_endpoints_service(db)
    service.ensure_default_endpoint()
    endpoint = (
        db.query(StorageEndpoint)
        .filter(StorageEndpoint.is_default.is_(True))
        .order_by(StorageEndpoint.id.asc())
        .first()
    )
    if not endpoint:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Default storage endpoint is not configured",
        )
    return endpoint


def _resolve_admin_rgw_context(db: Session, _user: User) -> tuple[str, str, str, Optional[str], bool]:
    endpoint = _resolve_default_endpoint(db)
    if StorageProvider(str(endpoint.provider)) != StorageProvider.CEPH:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Default endpoint does not support RGW admin operations",
        )
    flags = resolve_feature_flags(endpoint)
    if not flags.admin_enabled:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Admin operations are disabled for the default endpoint",
        )
    admin_endpoint = resolve_admin_endpoint(endpoint)
    if not admin_endpoint:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Admin endpoint is not configured for the default endpoint",
        )
    access_key = endpoint.admin_access_key
    secret_key = endpoint.admin_secret_key
    if not access_key or not secret_key:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="RGW admin credentials are not configured",
        )
    return access_key, secret_key, admin_endpoint, endpoint.region, bool(getattr(endpoint, "verify_tls", True))


def get_super_admin_rgw_client(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_super_admin),
) -> RGWAdminClient:
    access_key, secret_key, admin_endpoint, region, verify_tls = _resolve_admin_rgw_context(db, user)
    return get_rgw_admin_client(
        access_key=access_key,
        secret_key=secret_key,
        endpoint=admin_endpoint,
        region=region,
        verify_tls=verify_tls,
    )
