# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.sensitive_data import sanitize_error_detail
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
from app.services.identity_security_policy import (
    ensure_actor_can_assign_role,
    ensure_actor_can_manage_user,
)

router = APIRouter(prefix="/admin/users", tags=["admin-users"])


def get_user_associations_service_dependency(
    db: Session = Depends(get_db),
) -> UserAssociationsService:
    return get_user_associations_service(db)


def _require_superadmin_for_privileged_change(
    current_user: DbUser,
    *,
    role: Optional[str],
    can_access_ceph_admin: Optional[bool],
) -> None:
    wants_privileged_role = role in {
        UserRole.UI_ADMIN.value,
        UserRole.UI_SUPERADMIN.value,
    }
    wants_ceph_admin_grant = can_access_ceph_admin is True
    if (wants_privileged_role or wants_ceph_admin_grant) and not is_superadmin_ui_role(current_user.role):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only superadmin users can assign administrator roles or grant privileged Ceph access",
        )


def _active_superadmin_count(users_service: UsersService, current_user: DbUser) -> int:
    count = users_service.db.query(DbUser).filter(
        DbUser.role == UserRole.UI_SUPERADMIN.value,
        DbUser.is_active.is_(True),
    ).count()
    actor_is_persisted = users_service.db.query(DbUser.id).filter(DbUser.id == current_user.id).first()
    if (
        actor_is_persisted is None
        and current_user.role == UserRole.UI_SUPERADMIN.value
        and current_user.is_active
    ):
        count += 1
    return count


def _protect_superadmin_update(
    current_user: DbUser,
    target: DbUser,
    payload: UserUpdate,
    users_service: UsersService,
) -> None:
    next_role = payload.role or target.role
    next_active = target.is_active if payload.is_active is None else payload.is_active
    removes_active_superadmin = (
        target.role == UserRole.UI_SUPERADMIN.value
        and target.is_active
        and (next_role != UserRole.UI_SUPERADMIN.value or not next_active)
    )
    if current_user.id == target.id and removes_active_superadmin:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A superadmin cannot deactivate or demote their own account",
        )
    if removes_active_superadmin and _active_superadmin_count(users_service, current_user) <= 1:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The last active superadmin cannot be deactivated or demoted",
        )


def _safe_update_audit_metadata(payload: UserUpdate) -> dict:
    metadata = payload.model_dump(exclude_unset=True, exclude_none=True)
    if "password" in metadata:
        metadata["password"] = "<redacted>"
    return metadata


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
    associations_service: UserAssociationsService = Depends(get_user_associations_service_dependency),
    current_user: DbUser = Depends(get_current_super_admin),
    audit_service: AuditService = Depends(get_audit_service),
) -> UserOut:
    ensure_actor_can_assign_role(
        current_user,
        payload.role or UserRole.UI_USER.value,
    )
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
    associations_service: UserAssociationsService = Depends(get_user_associations_service_dependency),
    current_user: DbUser = Depends(get_current_super_admin),
    audit_service: AuditService = Depends(get_audit_service),
) -> UserOut:
    target = users_service.get_by_id(user_id)
    if target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    ensure_actor_can_manage_user(current_user, target, allow_self=is_superadmin_ui_role(current_user.role))
    if payload.role is not None:
        ensure_actor_can_assign_role(current_user, payload.role)
    _protect_superadmin_update(current_user, target, payload, users_service)
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
            metadata=_safe_update_audit_metadata(payload),
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
    target = users_service.get_by_id(user_id)
    if target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    ensure_actor_can_manage_user(current_user, target)
    if (
        target.role == UserRole.UI_SUPERADMIN.value
        and target.is_active
        and _active_superadmin_count(users_service, current_user) <= 1
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The last active superadmin cannot be deleted",
        )
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
