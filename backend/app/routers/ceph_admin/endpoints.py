# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.db import StorageEndpoint as DbStorageEndpoint, StorageProvider, User
from app.models.ceph_admin import CephAdminEndpoint
from app.routers.ceph_admin.dependencies import (
    build_ceph_admin_endpoint_payload,
    validate_ceph_admin_service_identity,
)
from app.routers.dependencies import get_current_ceph_admin

router = APIRouter(prefix="/ceph-admin/endpoints", tags=["ceph-admin-endpoints"])


@router.get("", response_model=list[CephAdminEndpoint])
def list_ceph_admin_endpoints(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_ceph_admin),
) -> list[CephAdminEndpoint]:
    endpoints = (
        db.query(DbStorageEndpoint)
        .order_by(DbStorageEndpoint.is_default.desc(), DbStorageEndpoint.name.asc())
        .all()
    )
    results: list[CephAdminEndpoint] = []
    validation_errors: list[str] = []
    for endpoint in endpoints:
        if str(endpoint.provider) != StorageProvider.CEPH.value:
            continue
        payload = build_ceph_admin_endpoint_payload(endpoint)
        if not payload["capabilities"].get("admin"):
            continue
        validation_error = validate_ceph_admin_service_identity(endpoint)
        if validation_error:
            validation_errors.append(validation_error)
            continue
        results.append(CephAdminEndpoint(**payload))
    if not results and validation_errors:
        detail = validation_errors[0]
        if len(validation_errors) > 1:
            detail = f"{detail} ({len(validation_errors) - 1} additional Ceph endpoint(s) failed the same validation.)"
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=detail)
    return results
