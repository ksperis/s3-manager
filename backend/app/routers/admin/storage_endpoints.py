# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import logging

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.storage_endpoint import (
    StorageEndpoint,
    StorageEndpointCreate,
    StorageEndpointMeta,
    StorageEndpointUpdate,
)
from app.routers.dependencies import get_audit_logger, get_current_super_admin
from app.services.audit_service import AuditService
from app.services.storage_endpoints_service import (
    StorageEndpointsService,
    get_storage_endpoints_service,
)

router = APIRouter(prefix="/admin/storage-endpoints", tags=["admin-storage-endpoints"])
logger = logging.getLogger(__name__)


def get_service(db: Session = Depends(get_db)) -> StorageEndpointsService:
    return get_storage_endpoints_service(db)


@router.get("", response_model=list[StorageEndpoint])
def list_storage_endpoints(
    include_admin_ops_permissions: bool = Query(False),
    service: StorageEndpointsService = Depends(get_service),
    _: dict = Depends(get_current_super_admin),
) -> list[StorageEndpoint]:
    return service.list_endpoints(include_admin_ops_permissions=include_admin_ops_permissions)


@router.get("/meta", response_model=StorageEndpointMeta)
def get_storage_endpoints_meta(
    service: StorageEndpointsService = Depends(get_service),
    _: dict = Depends(get_current_super_admin),
) -> StorageEndpointMeta:
    return StorageEndpointMeta(managed_by_env=service.env_endpoints_locked())


@router.get("/{endpoint_id}", response_model=StorageEndpoint)
def get_storage_endpoint(
    endpoint_id: int,
    include_admin_ops_permissions: bool = Query(True),
    service: StorageEndpointsService = Depends(get_service),
    _: dict = Depends(get_current_super_admin),
) -> StorageEndpoint:
    try:
        return service.get_endpoint(endpoint_id, include_admin_ops_permissions=include_admin_ops_permissions)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.post("", response_model=StorageEndpoint, status_code=status.HTTP_201_CREATED)
def create_storage_endpoint(
    payload: StorageEndpointCreate,
    service: StorageEndpointsService = Depends(get_service),
    audit_service: AuditService = Depends(get_audit_logger),
    current_user=Depends(get_current_super_admin),
) -> StorageEndpoint:
    try:
        created = service.create_endpoint(payload)
        audit_service.record_action(
            user=current_user,
            scope="admin",
            action="create_storage_endpoint",
            entity_type="storage_endpoint",
            entity_id=str(created.id),
            metadata={
                "endpoint_url": created.endpoint_url,
                "provider": created.provider.value,
                "admin_endpoint": created.admin_endpoint,
            },
        )
        return created
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.put("/{endpoint_id}", response_model=StorageEndpoint)
def update_storage_endpoint(
    endpoint_id: int,
    payload: StorageEndpointUpdate,
    service: StorageEndpointsService = Depends(get_service),
    audit_service: AuditService = Depends(get_audit_logger),
    current_user=Depends(get_current_super_admin),
) -> StorageEndpoint:
    try:
        updated = service.update_endpoint(endpoint_id, payload)
        audit_service.record_action(
            user=current_user,
            scope="admin",
            action="update_storage_endpoint",
            entity_type="storage_endpoint",
            entity_id=str(endpoint_id),
            metadata={
                "endpoint_url": updated.endpoint_url,
                "provider": updated.provider.value,
                "admin_endpoint": updated.admin_endpoint,
            },
        )
        return updated
    except ValueError as exc:
        detail = str(exc)
        lowered = detail.lower()
        status_code = (
            status.HTTP_404_NOT_FOUND
            if "not found" in lowered or "introuvable" in lowered
            else status.HTTP_400_BAD_REQUEST
        )
        raise HTTPException(status_code=status_code, detail=detail) from exc


@router.put("/{endpoint_id}/default", response_model=StorageEndpoint)
def set_default_storage_endpoint(
    endpoint_id: int,
    service: StorageEndpointsService = Depends(get_service),
    audit_service: AuditService = Depends(get_audit_logger),
    current_user=Depends(get_current_super_admin),
) -> StorageEndpoint:
    try:
        updated = service.set_default_endpoint(endpoint_id)
        audit_service.record_action(
            user=current_user,
            scope="admin",
            action="set_default_storage_endpoint",
            entity_type="storage_endpoint",
            entity_id=str(endpoint_id),
            metadata={
                "endpoint_url": updated.endpoint_url,
                "provider": updated.provider.value,
            },
        )
        return updated
    except ValueError as exc:
        detail = str(exc)
        lowered = detail.lower()
        status_code = (
            status.HTTP_404_NOT_FOUND
            if "not found" in lowered or "introuvable" in lowered
            else status.HTTP_400_BAD_REQUEST
        )
        raise HTTPException(status_code=status_code, detail=detail) from exc


@router.delete("/{endpoint_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_storage_endpoint(
    endpoint_id: int,
    service: StorageEndpointsService = Depends(get_service),
    audit_service: AuditService = Depends(get_audit_logger),
    current_user=Depends(get_current_super_admin),
) -> None:
    try:
        service.delete_endpoint(endpoint_id)
        audit_service.record_action(
            user=current_user,
            scope="admin",
            action="delete_storage_endpoint",
            entity_type="storage_endpoint",
            entity_id=str(endpoint_id),
        )
    except ValueError as exc:
        detail = str(exc)
        lowered = detail.lower()
        status_code = (
            status.HTTP_404_NOT_FOUND
            if "not found" in lowered or "introuvable" in lowered
            else status.HTTP_400_BAD_REQUEST
        )
        raise HTTPException(status_code=status_code, detail=detail) from exc
