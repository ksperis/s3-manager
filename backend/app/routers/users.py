# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from fastapi import APIRouter, Depends, HTTPException, status
from app.db import User
from app.models.user import UserOut, UserSelfUpdate
from app.routers.dependencies import get_audit_logger, get_current_account_user, get_current_user
from app.services.audit_service import AuditService
from app.services.users_service import UsersService, get_users_service
from app.core.database import get_db

router = APIRouter(prefix="/users", tags=["users"])


@router.get("/me", response_model=UserOut)
def read_users_me(
    current_user=Depends(get_current_user),
    users_service: UsersService = Depends(lambda db=Depends(get_db): get_users_service(db)),
) -> UserOut:
    return users_service.user_to_out(current_user)


@router.put("/me", response_model=UserOut)
def update_users_me(
    payload: UserSelfUpdate,
    current_user: User = Depends(get_current_account_user),
    users_service: UsersService = Depends(lambda db=Depends(get_db): get_users_service(db)),
    audit_service: AuditService = Depends(get_audit_logger),
) -> UserOut:
    update_fields = payload.model_fields_set
    try:
        user = users_service.update_current_user(
            current_user,
            full_name=payload.full_name if "full_name" in update_fields else None,
            ui_language=payload.ui_language,
            update_ui_language="ui_language" in update_fields,
            current_password=payload.current_password,
            new_password=payload.new_password,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    audit_metadata = payload.model_dump(exclude_none=True)
    if "current_password" in audit_metadata:
        audit_metadata["current_password"] = "<redacted>"
    if "new_password" in audit_metadata:
        audit_metadata["new_password"] = "<redacted>"
    audit_service.record_action(
        user=user,
        scope="users",
        action="update_profile",
        entity_type="ui_user",
        entity_id=str(user.id),
        metadata=audit_metadata or None,
    )
    return users_service.user_to_out(user)
