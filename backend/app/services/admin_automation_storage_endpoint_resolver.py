# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Optional

from sqlalchemy.orm import Session

from app.db import StorageEndpoint, StorageProvider
from app.utils.normalize import normalize_storage_provider
from app.utils.s3_endpoint import normalize_s3_endpoint


def find_storage_endpoint(
    db: Session,
    *,
    endpoint_id: Optional[int] = None,
    endpoint_name: Optional[str] = None,
    endpoint_url: Optional[str] = None,
) -> Optional[StorageEndpoint]:
    if endpoint_id is not None:
        return db.query(StorageEndpoint).filter(StorageEndpoint.id == endpoint_id).first()
    if endpoint_name:
        return db.query(StorageEndpoint).filter(StorageEndpoint.name == endpoint_name).first()
    if endpoint_url:
        normalized_url = normalize_s3_endpoint(endpoint_url)
        return (
            db.query(StorageEndpoint)
            .filter(StorageEndpoint.endpoint_url == normalized_url)
            .first()
        )
    return None


def resolve_storage_endpoint(
    db: Session,
    *,
    endpoint_id: Optional[int] = None,
    endpoint_name: Optional[str] = None,
    endpoint_url: Optional[str] = None,
) -> Optional[StorageEndpoint]:
    endpoint = find_storage_endpoint(
        db,
        endpoint_id=endpoint_id,
        endpoint_name=endpoint_name,
        endpoint_url=endpoint_url,
    )
    if endpoint is None and any(
        value is not None and value != ""
        for value in (endpoint_id, endpoint_name, endpoint_url)
    ):
        raise ValueError("Storage endpoint not found")
    return endpoint


def require_ceph_endpoint(endpoint: StorageEndpoint) -> None:
    if normalize_storage_provider(endpoint.provider) != StorageProvider.CEPH:
        raise ValueError("This endpoint is not a Ceph endpoint")
