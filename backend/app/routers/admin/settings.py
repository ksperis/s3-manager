# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.db import User
from app.models.app_settings import AppSettings, GeneralFeatureLocks, QuotaNotificationSettings
from app.routers.dependencies import get_current_ui_superadmin
from app.services.app_settings_service import (
    get_general_feature_locks,
    load_app_settings,
    load_default_app_settings,
    save_app_settings,
)
from app.services.quota_monitoring_service import QuotaMonitoringService

router = APIRouter(prefix="/admin/settings", tags=["admin-settings"])


@router.get("", response_model=AppSettings)
def get_settings(_: None = Depends(get_current_ui_superadmin)) -> AppSettings:
    return load_app_settings()


@router.get("/defaults", response_model=AppSettings)
def get_default_settings(_: None = Depends(get_current_ui_superadmin)) -> AppSettings:
    return load_default_app_settings()


@router.get("/general-feature-locks", response_model=GeneralFeatureLocks)
def get_general_feature_locks_route(_: None = Depends(get_current_ui_superadmin)) -> GeneralFeatureLocks:
    return get_general_feature_locks()


@router.put("", response_model=AppSettings)
def update_settings(payload: AppSettings, _: None = Depends(get_current_ui_superadmin)) -> AppSettings:
    return save_app_settings(payload)


@router.post("/quota-notifications/test-email")
def send_quota_notifications_test_email(
    payload: QuotaNotificationSettings,
    current_user: User = Depends(get_current_ui_superadmin),
    db: Session = Depends(get_db),
) -> dict:
    service = QuotaMonitoringService(db)
    try:
        return service.send_test_email(
            notification_settings=payload,
            recipient_email=current_user.email,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
