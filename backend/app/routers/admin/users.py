# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.db import User as DbUser
from app.models.user import PaginatedUsersResponse, UserAssignS3Account, UserCreate, UserOut, UserSummary, UserUpdate
from app.routers.dependencies import get_audit_logger, get_current_super_admin
from app.services.audit_service import AuditService
from app.services.users_service import UsersService, get_users_service

router = APIRouter(prefix="/admin/users", tags=["admin-users"])


@router.get("", response_model=PaginatedUsersResponse)
def list_users(
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=200),
    search: Optional[str] = Query(None),
    sort_by: str = Query("email"),
    sort_dir: str = Query("asc"),
    users_service: UsersService = Depends(lambda db=Depends(get_db): get_users_service(db)),
    _: dict = Depends(get_current_super_admin),
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
    users_service: UsersService = Depends(lambda db=Depends(get_db): get_users_service(db)),
    _: dict = Depends(get_current_super_admin),
) -> list[UserSummary]:
    return users_service.list_users_minimal()


@router.post("", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def create_user(
    payload: UserCreate,
    users_service: UsersService = Depends(lambda db=Depends(get_db): get_users_service(db)),
    current_user: DbUser = Depends(get_current_super_admin),
    audit_service: AuditService = Depends(get_audit_logger),
) -> UserOut:
    try:
        user = users_service.create_user(payload)
        audit_service.record_action(
            user=current_user,
            scope="admin",
            action="create_ui_user",
            entity_type="ui_user",
            entity_id=str(user.id),
            metadata={"email": user.email, "role": user.role},
        )
        return users_service.user_to_out(user)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.put("/{user_id}", response_model=UserOut)
def update_user(
    user_id: int,
    payload: UserUpdate,
    users_service: UsersService = Depends(lambda db=Depends(get_db): get_users_service(db)),
    current_user: DbUser = Depends(get_current_super_admin),
    audit_service: AuditService = Depends(get_audit_logger),
) -> UserOut:
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
        detail = str(exc)
        status_code = status.HTTP_400_BAD_REQUEST if "already in use" in detail.lower() else status.HTTP_404_NOT_FOUND
        raise HTTPException(status_code=status_code, detail=detail) from exc


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(
    user_id: int,
    users_service: UsersService = Depends(lambda db=Depends(get_db): get_users_service(db)),
    current_user: DbUser = Depends(get_current_super_admin),
    audit_service: AuditService = Depends(get_audit_logger),
) -> None:
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
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.post("/{user_id}/assign-account", response_model=UserOut)
def assign_account(
    user_id: int,
    payload: UserAssignS3Account,
    users_service: UsersService = Depends(lambda db=Depends(get_db): get_users_service(db)),
    current_user: DbUser = Depends(get_current_super_admin),
    audit_service: AuditService = Depends(get_audit_logger),
) -> UserOut:
    try:
        user = users_service.assign_user_to_account(
            user_id,
            payload.account_id,
            account_root=payload.account_root or False,
            account_role=payload.account_role,
            account_admin=payload.account_admin,
        )
        audit_service.record_action(
            user=current_user,
            scope="admin",
            action="assign_user_account",
            entity_type="ui_user",
            entity_id=str(user_id),
            account_id=payload.account_id,
            metadata={
                "account_root": bool(payload.account_root),
                "assigned_user_id": user_id,
            },
        )
        return users_service.user_to_out(user)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
