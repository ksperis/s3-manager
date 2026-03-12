# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.db import S3Account, User
from app.models.s3_user import S3UserAccessKey, S3UserAccessKeyStatusChange, S3UserGeneratedKey
from app.routers.dependencies import (
    get_audit_logger,
    get_current_account_user,
    require_manager_ceph_s3_user_keys,
)
from app.services.audit_service import AuditService
from app.services.s3_users_service import S3UsersService, get_s3_users_service

router = APIRouter(prefix="/manager/ceph/keys", tags=["manager-ceph-keys"])


def get_manager_ceph_s3_users_service(
    db: Session = Depends(get_db),
) -> S3UsersService:
    return get_s3_users_service(db)


def _resolve_s3_user_id(account: S3Account) -> int:
    s3_user_id = getattr(account, "s3_user_id", None)
    if not isinstance(s3_user_id, int) or s3_user_id <= 0:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Ceph key management is not available for this context",
        )
    return s3_user_id


def _translate_s3_user_error(exc: ValueError) -> HTTPException:
    detail = str(exc)
    code = status.HTTP_404_NOT_FOUND if "not found" in detail.lower() else status.HTTP_400_BAD_REQUEST
    return HTTPException(status_code=code, detail=detail)


@router.get("", response_model=list[S3UserAccessKey])
def list_ceph_access_keys(
    account: S3Account = Depends(require_manager_ceph_s3_user_keys),
    service: S3UsersService = Depends(get_manager_ceph_s3_users_service),
    _: User = Depends(get_current_account_user),
) -> list[S3UserAccessKey]:
    try:
        return service.list_keys(_resolve_s3_user_id(account))
    except ValueError as exc:
        raise _translate_s3_user_error(exc) from exc


@router.post("", response_model=S3UserGeneratedKey, status_code=status.HTTP_201_CREATED)
def create_ceph_access_key(
    account: S3Account = Depends(require_manager_ceph_s3_user_keys),
    service: S3UsersService = Depends(get_manager_ceph_s3_users_service),
    current_user: User = Depends(get_current_account_user),
    audit_service: AuditService = Depends(get_audit_logger),
) -> S3UserGeneratedKey:
    s3_user_id = _resolve_s3_user_id(account)
    try:
        key = service.create_access_key_entry(s3_user_id)
        audit_service.record_action(
            user=current_user,
            scope="manager",
            action="create_s3_user_access_key",
            entity_type="s3_user",
            entity_id=str(s3_user_id),
            account=account,
            metadata={"access_key_id": key.access_key_id},
        )
        return key
    except ValueError as exc:
        raise _translate_s3_user_error(exc) from exc


@router.put("/{access_key}/status", response_model=S3UserAccessKey)
def update_ceph_access_key_status(
    access_key: str,
    payload: S3UserAccessKeyStatusChange,
    account: S3Account = Depends(require_manager_ceph_s3_user_keys),
    service: S3UsersService = Depends(get_manager_ceph_s3_users_service),
    current_user: User = Depends(get_current_account_user),
    audit_service: AuditService = Depends(get_audit_logger),
) -> S3UserAccessKey:
    s3_user_id = _resolve_s3_user_id(account)
    try:
        updated = service.set_key_status(s3_user_id, access_key, payload.active)
        audit_service.record_action(
            user=current_user,
            scope="manager",
            action="update_s3_user_access_key_status",
            entity_type="s3_user",
            entity_id=str(s3_user_id),
            account=account,
            metadata={"access_key_id": access_key, "active": payload.active},
        )
        return updated
    except ValueError as exc:
        raise _translate_s3_user_error(exc) from exc


@router.delete(
    "/{access_key}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    response_model=None,
)
def delete_ceph_access_key(
    access_key: str,
    account: S3Account = Depends(require_manager_ceph_s3_user_keys),
    service: S3UsersService = Depends(get_manager_ceph_s3_users_service),
    current_user: User = Depends(get_current_account_user),
    audit_service: AuditService = Depends(get_audit_logger),
) -> Response:
    s3_user_id = _resolve_s3_user_id(account)
    try:
        service.delete_key(s3_user_id, access_key)
        audit_service.record_action(
            user=current_user,
            scope="manager",
            action="delete_s3_user_access_key",
            entity_type="s3_user",
            entity_id=str(s3_user_id),
            account=account,
            metadata={"access_key_id": access_key},
        )
    except ValueError as exc:
        raise _translate_s3_user_error(exc) from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)
