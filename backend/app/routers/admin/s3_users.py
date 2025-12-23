# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.db_models import User
from app.models.s3_user import (
    PaginatedS3UsersResponse,
    S3User,
    S3UserAccessKey,
    S3UserCreate,
    S3UserGeneratedKey,
    S3UserImport,
    S3UserAccessKeyStatusChange,
    S3UserSummary,
    S3UserUpdate,
)
from app.routers.dependencies import get_audit_logger, get_current_super_admin, get_super_admin_rgw_client
from app.services.s3_users_service import S3UsersService, get_s3_users_service
from app.services.audit_service import AuditService

router = APIRouter(prefix="/admin/s3-users", tags=["admin-s3-users"])
logger = logging.getLogger(__name__)


def get_admin_s3_users_service(
    db: Session = Depends(get_db),
    rgw_admin_client=Depends(get_super_admin_rgw_client),
) -> S3UsersService:
    return get_s3_users_service(db, rgw_admin_client=rgw_admin_client)


@router.get("", response_model=PaginatedS3UsersResponse)
def list_s3_users(
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=200),
    search: Optional[str] = Query(None),
    sort_by: str = Query("name"),
    sort_dir: str = Query("asc"),
    service: S3UsersService = Depends(get_admin_s3_users_service),
    _: User = Depends(get_current_super_admin),
) -> PaginatedS3UsersResponse:
    items, total = service.paginate_users(
        page=page,
        page_size=page_size,
        search=search,
        sort_field=sort_by,
        sort_direction=sort_dir,
    )
    has_next = page * page_size < total
    return PaginatedS3UsersResponse(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
        has_next=has_next,
    )


@router.get("/minimal", response_model=list[S3UserSummary])
def list_s3_users_minimal(
    service: S3UsersService = Depends(get_admin_s3_users_service),
    _: User = Depends(get_current_super_admin),
) -> list[S3UserSummary]:
    return service.list_users_minimal()


@router.post("", response_model=S3User, status_code=status.HTTP_201_CREATED)
def create_s3_user(
    payload: S3UserCreate,
    service: S3UsersService = Depends(get_admin_s3_users_service),
    current_user: User = Depends(get_current_super_admin),
    audit_service: AuditService = Depends(get_audit_logger),
) -> S3User:
    try:
        created = service.create_user(payload)
        audit_service.record_action(
            user=current_user,
            scope="admin",
            action="create_s3_user",
            entity_type="s3_user",
            entity_id=str(created.id),
            metadata={"rgw_user_uid": created.rgw_user_uid},
        )
        return created
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.get("/{user_id}", response_model=S3User)
def get_s3_user(
    user_id: int,
    service: S3UsersService = Depends(get_admin_s3_users_service),
    _: User = Depends(get_current_super_admin),
) -> S3User:
    try:
        return service.get_user(user_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.post("/import", response_model=list[S3User])
def import_s3_users(
    payload: list[S3UserImport],
    service: S3UsersService = Depends(get_admin_s3_users_service),
    current_user: User = Depends(get_current_super_admin),
    audit_service: AuditService = Depends(get_audit_logger),
) -> list[S3User]:
    try:
        created = service.import_users(payload)
        audit_service.record_action(
            user=current_user,
            scope="admin",
            action="import_s3_users",
            entity_type="s3_user",
            entity_id=None,
            metadata={"count": len(created)},
        )
        return created
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.put("/{user_id}", response_model=S3User)
def update_s3_user(
    user_id: int,
    payload: S3UserUpdate,
    service: S3UsersService = Depends(get_admin_s3_users_service),
    current_user: User = Depends(get_current_super_admin),
    audit_service: AuditService = Depends(get_audit_logger),
) -> S3User:
    try:
        updated = service.update_user(user_id, payload)
        audit_service.record_action(
            user=current_user,
            scope="admin",
            action="update_s3_user",
            entity_type="s3_user",
            entity_id=str(user_id),
            metadata=payload.model_dump(exclude_none=True),
        )
        return updated
    except ValueError as exc:
        detail = str(exc)
        status_code = status.HTTP_404_NOT_FOUND if "not found" in detail.lower() else status.HTTP_400_BAD_REQUEST
        raise HTTPException(status_code=status_code, detail=detail) from exc


@router.post("/{user_id}/rotate-keys", response_model=S3User)
def rotate_s3_user_keys(
    user_id: int,
    service: S3UsersService = Depends(get_admin_s3_users_service),
    current_user: User = Depends(get_current_super_admin),
    audit_service: AuditService = Depends(get_audit_logger),
) -> S3User:
    try:
        updated = service.rotate_keys(user_id)
        audit_service.record_action(
            user=current_user,
            scope="admin",
            action="rotate_s3_user_keys",
            entity_type="s3_user",
            entity_id=str(user_id),
            metadata={"rgw_user_uid": updated.rgw_user_uid},
        )
        return updated
    except ValueError as exc:
        detail = str(exc)
        status_code = status.HTTP_404_NOT_FOUND if "not found" in detail.lower() else status.HTTP_400_BAD_REQUEST
        raise HTTPException(status_code=status_code, detail=detail) from exc


@router.get("/{user_id}/keys", response_model=list[S3UserAccessKey])
def list_s3_user_keys(
    user_id: int,
    service: S3UsersService = Depends(get_admin_s3_users_service),
    _: User = Depends(get_current_super_admin),
) -> list[S3UserAccessKey]:
    try:
        return service.list_keys(user_id)
    except ValueError as exc:
        detail = str(exc)
        status_code = status.HTTP_404_NOT_FOUND if "not found" in detail.lower() else status.HTTP_400_BAD_REQUEST
        raise HTTPException(status_code=status_code, detail=detail) from exc


@router.post("/{user_id}/keys", response_model=S3UserGeneratedKey, status_code=status.HTTP_201_CREATED)
def create_s3_user_access_key(
    user_id: int,
    service: S3UsersService = Depends(get_admin_s3_users_service),
    current_user: User = Depends(get_current_super_admin),
    audit_service: AuditService = Depends(get_audit_logger),
) -> S3UserGeneratedKey:
    try:
        key = service.create_access_key_entry(user_id)
        audit_service.record_action(
            user=current_user,
            scope="admin",
            action="create_s3_user_access_key",
            entity_type="s3_user",
            entity_id=str(user_id),
            metadata={"access_key_id": key.access_key_id},
        )
        return key
    except ValueError as exc:
        detail = str(exc)
        status_code = status.HTTP_404_NOT_FOUND if "not found" in detail.lower() else status.HTTP_400_BAD_REQUEST
        raise HTTPException(status_code=status_code, detail=detail) from exc


@router.put("/{user_id}/keys/{access_key}/status", response_model=S3UserAccessKey)
def update_s3_user_access_key_status(
    user_id: int,
    access_key: str,
    payload: S3UserAccessKeyStatusChange,
    service: S3UsersService = Depends(get_admin_s3_users_service),
    current_user: User = Depends(get_current_super_admin),
    audit_service: AuditService = Depends(get_audit_logger),
) -> S3UserAccessKey:
    try:
        updated = service.set_key_status(user_id, access_key, payload.active)
        audit_service.record_action(
            user=current_user,
            scope="admin",
            action="update_s3_user_access_key_status",
            entity_type="s3_user",
            entity_id=str(user_id),
            metadata={"access_key_id": access_key, "active": payload.active},
        )
        return updated
    except ValueError as exc:
        detail = str(exc)
        status_code = status.HTTP_404_NOT_FOUND if "not found" in detail.lower() else status.HTTP_400_BAD_REQUEST
        raise HTTPException(status_code=status_code, detail=detail) from exc


@router.delete("/{user_id}/keys/{access_key}", status_code=status.HTTP_204_NO_CONTENT)
def delete_s3_user_access_key(
    user_id: int,
    access_key: str,
    service: S3UsersService = Depends(get_admin_s3_users_service),
    current_user: User = Depends(get_current_super_admin),
    audit_service: AuditService = Depends(get_audit_logger),
) -> None:
    try:
        service.delete_key(user_id, access_key)
        audit_service.record_action(
            user=current_user,
            scope="admin",
            action="delete_s3_user_access_key",
            entity_type="s3_user",
            entity_id=str(user_id),
            metadata={"access_key_id": access_key},
        )
    except ValueError as exc:
        detail = str(exc)
        status_code = status.HTTP_404_NOT_FOUND if "not found" in detail.lower() else status.HTTP_400_BAD_REQUEST
        raise HTTPException(status_code=status_code, detail=detail) from exc


@router.post("/{user_id}/unlink", status_code=status.HTTP_204_NO_CONTENT)
def unlink_s3_user(
    user_id: int,
    service: S3UsersService = Depends(get_admin_s3_users_service),
    current_user: User = Depends(get_current_super_admin),
    audit_service: AuditService = Depends(get_audit_logger),
) -> None:
    try:
        service.unlink_user(user_id)
        audit_service.record_action(
            user=current_user,
            scope="admin",
            action="unlink_s3_user",
            entity_type="s3_user",
            entity_id=str(user_id),
        )
    except ValueError as exc:
        detail = str(exc)
        status_code = status.HTTP_404_NOT_FOUND if "not found" in detail.lower() else status.HTTP_400_BAD_REQUEST
        raise HTTPException(status_code=status_code, detail=detail) from exc


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_s3_user(
    user_id: int,
    delete_rgw: bool = Query(False, description="Also delete the RGW user backing this entry"),
    service: S3UsersService = Depends(get_admin_s3_users_service),
    current_user: User = Depends(get_current_super_admin),
    audit_service: AuditService = Depends(get_audit_logger),
) -> None:
    try:
        service.delete_user(user_id, delete_rgw=delete_rgw)
        audit_service.record_action(
            user=current_user,
            scope="admin",
            action="delete_s3_user",
            entity_type="s3_user",
            entity_id=str(user_id),
            metadata={"delete_rgw": delete_rgw},
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
