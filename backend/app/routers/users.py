# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from app.db import User
from app.models.user_notification import (
    MarkUserNotificationsReadRequest,
    MarkUserNotificationsReadResponse,
    UserNotificationsResponse,
)
from app.models.user import UserOut, UserSelfUpdate
from app.routers.dependencies import get_audit_logger, get_current_account_user, get_current_user
from app.services.audit_service import AuditService
from app.services.user_notifications_service import UserNotificationsService
from app.services.users_service import UsersService, get_users_service
from app.core.database import get_db

router = APIRouter(prefix="/users", tags=["users"])


@router.get("/me", response_model=UserOut)
def read_users_me(
    current_user=Depends(get_current_user),
    users_service: UsersService = Depends(lambda db=Depends(get_db): get_users_service(db)),
) -> UserOut:
    return users_service.user_to_out(current_user)


@router.get("/me/notifications", response_model=UserNotificationsResponse)
def list_my_notifications(
    limit: int = Query(20, ge=1, le=100),
    current_user: User = Depends(get_current_account_user),
    db: Session = Depends(get_db),
) -> UserNotificationsResponse:
    return UserNotificationsService(db).list_for_user(current_user, limit=limit)


@router.post("/me/notifications/read", response_model=MarkUserNotificationsReadResponse)
def mark_my_notifications_read(
    payload: MarkUserNotificationsReadRequest,
    current_user: User = Depends(get_current_account_user),
    db: Session = Depends(get_db),
) -> MarkUserNotificationsReadResponse:
    service = UserNotificationsService(db)
    updated = service.mark_read(
        current_user,
        notification_ids=payload.notification_ids,
        mark_all=payload.all,
    )
    db.commit()
    return MarkUserNotificationsReadResponse(
        updated_count=updated,
        unread_count=service.unread_count_for_user(current_user),
    )


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
            quota_alerts_enabled=payload.quota_alerts_enabled,
            update_quota_alerts_enabled="quota_alerts_enabled" in update_fields,
            quota_alerts_global_watch=payload.quota_alerts_global_watch,
            update_quota_alerts_global_watch="quota_alerts_global_watch" in update_fields,
            ui_preferences=payload.ui_preferences,
            update_ui_preferences="ui_preferences" in update_fields,
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
