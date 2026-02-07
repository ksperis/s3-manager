# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from fastapi import Depends, HTTPException, Path, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.db import StorageEndpoint, StorageProvider, User
from app.routers.dependencies import get_current_super_admin
from app.services.rgw_admin import RGWAdminClient, get_rgw_admin_client
from app.utils.s3_endpoint import normalize_s3_endpoint
from app.utils.storage_endpoint_features import resolve_admin_endpoint, resolve_feature_flags, features_to_capabilities, normalize_features_config


@dataclass(frozen=True)
class CephAdminContext:
    endpoint: StorageEndpoint
    rgw_admin: RGWAdminClient
    s3_endpoint: str
    region: Optional[str]
    access_key: str
    secret_key: str


def _resolve_storage_endpoint(db: Session, endpoint_id: int) -> StorageEndpoint:
    endpoint = db.query(StorageEndpoint).filter(StorageEndpoint.id == endpoint_id).first()
    if not endpoint:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Storage endpoint not found")
    provider = StorageProvider(str(endpoint.provider))
    if provider != StorageProvider.CEPH:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Storage endpoint is not a Ceph provider")
    flags = resolve_feature_flags(endpoint)
    if not flags.admin_enabled:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Admin operations are disabled for this endpoint",
        )
    admin_endpoint = resolve_admin_endpoint(endpoint)
    if not admin_endpoint:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Admin endpoint is not configured for this storage endpoint",
        )
    access_key = endpoint.admin_access_key
    secret_key = endpoint.admin_secret_key
    if not access_key or not secret_key:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="RGW admin credentials are not configured for this storage endpoint",
        )
    s3_endpoint = normalize_s3_endpoint(getattr(endpoint, "endpoint_url", None))
    if not s3_endpoint:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="S3 endpoint URL is not configured for this storage endpoint",
        )
    return endpoint


def get_ceph_admin_context(
    endpoint_id: int = Path(..., ge=1),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_super_admin),
) -> CephAdminContext:
    endpoint = _resolve_storage_endpoint(db, endpoint_id)
    admin_endpoint = resolve_admin_endpoint(endpoint)
    access_key = endpoint.admin_access_key
    secret_key = endpoint.admin_secret_key
    region = getattr(endpoint, "region", None)
    rgw_admin = get_rgw_admin_client(
        access_key=access_key,
        secret_key=secret_key,
        endpoint=admin_endpoint,
        region=region,
    )
    s3_endpoint = normalize_s3_endpoint(getattr(endpoint, "endpoint_url", None)) or ""
    return CephAdminContext(
        endpoint=endpoint,
        rgw_admin=rgw_admin,
        s3_endpoint=s3_endpoint,
        region=region,
        access_key=access_key,
        secret_key=secret_key,
    )


def build_ceph_admin_endpoint_payload(endpoint: StorageEndpoint) -> dict:
    features = normalize_features_config(endpoint.provider, endpoint.features_config)
    return {
        "id": endpoint.id,
        "name": endpoint.name,
        "endpoint_url": endpoint.endpoint_url,
        "admin_endpoint": resolve_admin_endpoint(endpoint),
        "region": endpoint.region,
        "is_default": bool(endpoint.is_default),
        "capabilities": features_to_capabilities(features),
    }
