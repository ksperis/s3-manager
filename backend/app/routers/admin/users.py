# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.db import User as DbUser
from app.db import UserRole, is_superadmin_ui_role
from app.models.user import (
    PaginatedUsersResponse,
    UserCreate,
    UserOut,
    UserSummary,
    UserUpdate,
)
from app.routers.dependencies import (
    get_audit_service,
    get_current_super_admin,
    get_users_service_dependency,
)
from app.services.audit_service import AuditService
from app.services.user_associations_service import (
    UserAssociationsService,
    get_user_associations_service,
)
from app.services.users_service import UsersService
from app.core.sensitive_data import sanitize_error_detail

router = APIRouter(prefix="/admin/users", tags=["admin-users"])


def _require_superadmin_for_privileged_change(
    current_user: DbUser,
    *,
    role: Optional[str],
    can_access_ceph_admin: Optional[bool],
) -> None:
    wants_superadmin = role == UserRole.UI_SUPERADMIN.value
    wants_ceph_admin_grant = can_access_ceph_admin is True
    if (wants_superadmin or wants_ceph_admin_grant) and not is_superadmin_ui_role(current_user.role):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only superadmin users can promote superadmins or grant privileged Ceph access",
        )


def _require_superadmin_for_group_privileges(
    current_user: DbUser,
    associations_service: UserAssociationsService,
    *,
    group_ids: Optional[list[int]],
) -> None:
    if group_ids is None:
        return
    grants_ceph_admin = associations_service.groups_grant_ceph_admin(
        group_ids
    )
    if grants_ceph_admin and not is_superadmin_ui_role(current_user.role):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only superadmin users can assign groups that grant privileged Ceph access",
        )


@router.get("", response_model=PaginatedUsersResponse)
def list_users(
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=200),
    search: Optional[str] = Query(None),
    sort_by: str = Query("email"),
    sort_dir: str = Query("asc"),
    users_service: UsersService = Depends(get_users_service_dependency),
    _: DbUser = Depends(get_current_super_admin),
) -> PaginatedUsersResponse:
    items, total = users_service.paginate_users(
        page=page,
        page_size=page_size,
        search=search,
        sort_field=sort_by,
        sort_direction=sort_dir,
    )
    has_next = page * page_size < total
    return PaginatedUsersResponse(items=items, total=total, page=page, page_size=page_size, has_next=has_next)


@router.get("/minimal", response_model=list[UserSummary])
def list_users_minimal(
    users_service: UsersService = Depends(get_users_service_dependency),
    _: DbUser = Depends(get_current_super_admin),
) -> list[UserSummary]:
    return users_service.list_users_minimal()


@router.post("", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def create_user(
    payload: UserCreate,
    users_service: UsersService = Depends(get_users_service_dependency),
    associations_service: UserAssociationsService = Depends(
        lambda db=Depends(get_db): get_user_associations_service(db)
    ),
    current_user: DbUser = Depends(get_current_super_admin),
    audit_service: AuditService = Depends(get_audit_service),
) -> UserOut:
    _require_superadmin_for_privileged_change(
        current_user,
        role=payload.role,
        can_access_ceph_admin=payload.can_access_ceph_admin,
    )
    _require_superadmin_for_group_privileges(
        current_user,
        associations_service,
        group_ids=payload.group_ids,
    )
    try:
        user = users_service.create_user(payload)
        audit_service.record_action(
            user=current_user,
            scope="admin",
            action="create_ui_user",
            entity_type="ui_user",
            entity_id=str(user.id),
            metadata={
                "email": user.email,
                "role": user.role,
                "group_ids": payload.group_ids,
            },
        )
        return users_service.user_to_out(user)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=sanitize_error_detail(str(exc))) from exc


@router.put("/{user_id}", response_model=UserOut)
def update_user(
    user_id: int,
    payload: UserUpdate,
    users_service: UsersService = Depends(get_users_service_dependency),
    associations_service: UserAssociationsService = Depends(
        lambda db=Depends(get_db): get_user_associations_service(db)
    ),
    current_user: DbUser = Depends(get_current_super_admin),
    audit_service: AuditService = Depends(get_audit_service),
) -> UserOut:
    _require_superadmin_for_privileged_change(
        current_user,
        role=payload.role,
        can_access_ceph_admin=payload.can_access_ceph_admin,
    )
    _require_superadmin_for_group_privileges(
        current_user,
        associations_service,
        group_ids=payload.group_ids,
    )
    try:
        user = users_service.update_user(user_id, payload)
        audit_service.record_action(
            user=current_user,
            scope="admin",
            action="update_ui_user",
            entity_type="ui_user",
            entity_id=str(user_id),
            metadata=payload.model_dump(exclude_unset=True, exclude_none=True),
        )
        return users_service.user_to_out(user)
    except ValueError as exc:
        detail = sanitize_error_detail(str(exc))
        status_code = status.HTTP_404_NOT_FOUND if detail.lower() == "user not found" else status.HTTP_400_BAD_REQUEST
        raise HTTPException(status_code=status_code, detail=detail) from exc


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(
    user_id: int,
    users_service: UsersService = Depends(get_users_service_dependency),
    current_user: DbUser = Depends(get_current_super_admin),
    audit_service: AuditService = Depends(get_audit_service),
) -> None:
    if current_user.id == user_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="You cannot delete your own user")
    try:
        users_service.delete_user(user_id)
        audit_service.record_action(
            user=current_user,
            scope="admin",
            action="delete_ui_user",
            entity_type="ui_user",
            entity_id=str(user_id),
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=sanitize_error_detail(str(exc))) from exc
