# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from fastapi import APIRouter, Depends

from app.models.app_settings import AppSettings, GeneralFeatureLocks
from app.routers.dependencies import get_current_ui_superadmin
from app.services.app_settings_service import (
    get_general_feature_locks,
    load_app_settings,
    load_default_app_settings,
    save_app_settings,
)

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
