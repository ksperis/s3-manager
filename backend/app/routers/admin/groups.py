# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.db import User, is_superadmin_ui_role
from app.models.ui_group import (
    PaginatedUiGroupsResponse,
    UiGroupCreate,
    UiGroupOut,
    UiGroupSummary,
    UiGroupUpdate,
)
from app.routers.dependencies import get_audit_logger, get_current_super_admin
from app.services.audit_service import AuditService
from app.services.ui_groups_service import UiGroupsService, get_ui_groups_service

router = APIRouter(prefix="/admin/groups", tags=["admin-groups"])


def _require_superadmin_for_ceph_admin_grant(current_user: User, can_access_ceph_admin: Optional[bool]) -> None:
    if can_access_ceph_admin is True and not is_superadmin_ui_role(current_user.role):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only superadmin users can grant ceph_admin access",
        )


@router.get("", response_model=PaginatedUiGroupsResponse)
def list_groups(
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=200),
    search: Optional[str] = Query(None),
    sort_by: str = Query("name"),
    sort_dir: str = Query("asc"),
    groups_service: UiGroupsService = Depends(lambda db=Depends(get_db): get_ui_groups_service(db)),
    _: User = Depends(get_current_super_admin),
) -> PaginatedUiGroupsResponse:
    items, total = groups_service.paginate_groups(
        page=page,
        page_size=page_size,
        search=search,
        sort_field=sort_by,
        sort_direction=sort_dir,
    )
    has_next = page * page_size < total
    return PaginatedUiGroupsResponse(items=items, total=total, page=page, page_size=page_size, has_next=has_next)


@router.get("/minimal", response_model=list[UiGroupSummary])
def list_groups_minimal(
    groups_service: UiGroupsService = Depends(lambda db=Depends(get_db): get_ui_groups_service(db)),
    _: User = Depends(get_current_super_admin),
) -> list[UiGroupSummary]:
    return groups_service.list_groups_minimal()


@router.post("", response_model=UiGroupOut, status_code=status.HTTP_201_CREATED)
def create_group(
    payload: UiGroupCreate,
    groups_service: UiGroupsService = Depends(lambda db=Depends(get_db): get_ui_groups_service(db)),
    current_user: User = Depends(get_current_super_admin),
    audit_service: AuditService = Depends(get_audit_logger),
) -> UiGroupOut:
    _require_superadmin_for_ceph_admin_grant(current_user, payload.can_access_ceph_admin)
    try:
        group = groups_service.create_group(payload)
        audit_service.record_action(
            user=current_user,
            scope="admin",
            action="create_ui_group",
            entity_type="ui_group",
            entity_id=str(group.id),
            metadata={
                "name": group.name,
                "user_ids": payload.user_ids,
                "account_ids": [link.account_id for link in payload.account_links],
                "s3_user_ids": payload.s3_user_ids,
                "s3_connection_ids": payload.s3_connection_ids,
                "can_access_ceph_admin": bool(group.can_access_ceph_admin),
                "can_access_storage_ops": bool(group.can_access_storage_ops),
            },
        )
        return groups_service.group_to_out(group)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.put("/{group_id}", response_model=UiGroupOut)
def update_group(
    group_id: int,
    payload: UiGroupUpdate,
    groups_service: UiGroupsService = Depends(lambda db=Depends(get_db): get_ui_groups_service(db)),
    current_user: User = Depends(get_current_super_admin),
    audit_service: AuditService = Depends(get_audit_logger),
) -> UiGroupOut:
    _require_superadmin_for_ceph_admin_grant(current_user, payload.can_access_ceph_admin)
    try:
        group = groups_service.update_group(group_id, payload)
        audit_service.record_action(
            user=current_user,
            scope="admin",
            action="update_ui_group",
            entity_type="ui_group",
            entity_id=str(group_id),
            metadata=payload.model_dump(exclude_unset=True, exclude_none=True),
        )
        return groups_service.group_to_out(group)
    except ValueError as exc:
        detail = str(exc)
        status_code = status.HTTP_404_NOT_FOUND if detail.lower() == "ui group not found" else status.HTTP_400_BAD_REQUEST
        raise HTTPException(status_code=status_code, detail=detail) from exc


@router.delete("/{group_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_group(
    group_id: int,
    groups_service: UiGroupsService = Depends(lambda db=Depends(get_db): get_ui_groups_service(db)),
    current_user: User = Depends(get_current_super_admin),
    audit_service: AuditService = Depends(get_audit_logger),
) -> None:
    try:
        group = groups_service.get_group(group_id)
        group_name = group.name if group else None
        groups_service.delete_group(group_id)
        audit_service.record_action(
            user=current_user,
            scope="admin",
            action="delete_ui_group",
            entity_type="ui_group",
            entity_id=str(group_id),
            metadata={"name": group_name} if group_name else None,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
