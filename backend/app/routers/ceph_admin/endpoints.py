# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.db import StorageProvider, User
from app.models.ceph_admin import CephAdminEndpoint
from app.routers.ceph_admin.dependencies import build_ceph_admin_endpoint_payload
from app.routers.dependencies import get_current_super_admin
from app.services.storage_endpoints_service import StorageEndpointsService, get_storage_endpoints_service

router = APIRouter(prefix="/ceph-admin/endpoints", tags=["ceph-admin-endpoints"])


def get_service(db: Session = Depends(get_db)) -> StorageEndpointsService:
    return get_storage_endpoints_service(db)


@router.get("", response_model=list[CephAdminEndpoint])
def list_ceph_admin_endpoints(
    service: StorageEndpointsService = Depends(get_service),
    _: User = Depends(get_current_super_admin),
) -> list[CephAdminEndpoint]:
    endpoints = service.list_endpoints()
    results: list[CephAdminEndpoint] = []
    for endpoint in endpoints:
        if endpoint.provider != StorageProvider.CEPH:
            continue
        payload = build_ceph_admin_endpoint_payload(endpoint)
        if not payload["capabilities"].get("admin"):
            continue
        results.append(CephAdminEndpoint(**payload))
    results.sort(key=lambda item: (0 if item.is_default else 1, item.name.lower()))
    return results
