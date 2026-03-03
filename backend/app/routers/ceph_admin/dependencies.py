# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from fastapi import Depends, HTTPException, Path, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.db import StorageEndpoint, StorageProvider, User
from app.routers.dependencies import get_current_ceph_admin
from app.services.rgw_admin import RGWAdminClient, RGWAdminError, get_rgw_admin_client
from app.utils.s3_endpoint import normalize_s3_endpoint
from app.utils.storage_endpoint_features import resolve_admin_endpoint, features_to_capabilities, normalize_features_config


@dataclass(frozen=True)
class CephAdminContext:
    endpoint: StorageEndpoint
    rgw_admin: RGWAdminClient
    s3_endpoint: str
    region: Optional[str]
    access_key: str
    secret_key: str


def _to_bool(value: object) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0
    if isinstance(value, str):
        normalized = value.strip().lower()
        return normalized in {"1", "true", "yes", "y", "on"}
    return False


def _extract_ceph_admin_flags(user_payload: dict) -> tuple[bool, bool]:
    candidates: list[dict] = [user_payload]
    nested_user = user_payload.get("user")
    if isinstance(nested_user, dict):
        candidates.append(nested_user)
    admin = any(_to_bool(candidate.get("admin")) for candidate in candidates)
    system = any(_to_bool(candidate.get("system")) for candidate in candidates)
    return admin, system


def validate_ceph_admin_service_identity(endpoint: StorageEndpoint) -> Optional[str]:
    endpoint_label = endpoint.name or f"#{endpoint.id}"
    admin_endpoint = resolve_admin_endpoint(endpoint)
    if not admin_endpoint:
        return f"Ceph Admin workspace is unavailable for endpoint '{endpoint_label}': admin endpoint is not configured."
    access_key = endpoint.ceph_admin_access_key
    secret_key = endpoint.ceph_admin_secret_key
    if not access_key or not secret_key:
        return (
            f"Ceph Admin workspace is unavailable for endpoint '{endpoint_label}': dedicated Ceph Admin credentials "
            "are not configured."
        )
    try:
        rgw_admin = get_rgw_admin_client(
            access_key=access_key,
            secret_key=secret_key,
            endpoint=admin_endpoint,
            region=getattr(endpoint, "region", None),
            verify_tls=bool(getattr(endpoint, "verify_tls", True)),
        )
        user_payload = rgw_admin.get_user_by_access_key(access_key, allow_not_found=True)
    except RGWAdminError as exc:
        return f"Ceph Admin workspace is unavailable for endpoint '{endpoint_label}': unable to validate credentials ({exc})."
    if not isinstance(user_payload, dict) or not user_payload:
        return (
            f"Ceph Admin workspace is unavailable for endpoint '{endpoint_label}': access key does not map to an RGW user."
        )
    is_admin, is_system = _extract_ceph_admin_flags(user_payload)
    if not is_admin and not is_system:
        return (
            f"Ceph Admin workspace is unavailable for endpoint '{endpoint_label}': the dedicated access key must belong "
            "to an RGW user created with --admin or --system."
        )
    return None


def _resolve_storage_endpoint(db: Session, endpoint_id: int) -> StorageEndpoint:
    endpoint = db.query(StorageEndpoint).filter(StorageEndpoint.id == endpoint_id).first()
    if not endpoint:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Storage endpoint not found")
    provider = StorageProvider(str(endpoint.provider))
    if provider != StorageProvider.CEPH:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Storage endpoint is not a Ceph provider")
    admin_endpoint = resolve_admin_endpoint(endpoint)
    if not admin_endpoint:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Admin endpoint is not configured for this storage endpoint",
        )
    access_key = endpoint.ceph_admin_access_key
    secret_key = endpoint.ceph_admin_secret_key
    if not access_key or not secret_key:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Ceph Admin credentials are not configured for this storage endpoint",
        )
    identity_validation_error = validate_ceph_admin_service_identity(endpoint)
    if identity_validation_error:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=identity_validation_error,
        )
    s3_endpoint = normalize_s3_endpoint(getattr(endpoint, "endpoint_url", None))
    if not s3_endpoint:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="S3 endpoint URL is not configured for this storage endpoint",
        )
    return endpoint


def _resolve_ceph_admin_workspace_endpoint(db: Session, endpoint_id: int) -> StorageEndpoint:
    endpoint = db.query(StorageEndpoint).filter(StorageEndpoint.id == endpoint_id).first()
    if not endpoint:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Storage endpoint not found")
    provider = StorageProvider(str(endpoint.provider))
    if provider != StorageProvider.CEPH:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Storage endpoint is not a Ceph provider")
    return endpoint


def get_ceph_admin_context(
    endpoint_id: int = Path(..., ge=1),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_ceph_admin),
) -> CephAdminContext:
    endpoint = _resolve_storage_endpoint(db, endpoint_id)
    admin_endpoint = resolve_admin_endpoint(endpoint)
    access_key = endpoint.ceph_admin_access_key
    secret_key = endpoint.ceph_admin_secret_key
    region = getattr(endpoint, "region", None)
    rgw_admin = get_rgw_admin_client(
        access_key=access_key,
        secret_key=secret_key,
        endpoint=admin_endpoint,
        region=region,
        verify_tls=bool(getattr(endpoint, "verify_tls", True)),
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


def get_ceph_admin_workspace_endpoint(
    endpoint_id: int = Path(..., ge=1),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_ceph_admin),
) -> StorageEndpoint:
    return _resolve_ceph_admin_workspace_endpoint(db, endpoint_id)


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
