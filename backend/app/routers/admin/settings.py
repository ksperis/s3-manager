# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from fastapi import APIRouter, Depends

from app.models.app_settings import AppSettings
from app.routers.dependencies import get_current_super_admin
from app.services.app_settings_service import load_app_settings, save_app_settings

router = APIRouter(prefix="/admin/settings", tags=["admin-settings"])


@router.get("", response_model=AppSettings)
def get_settings(_: None = Depends(get_current_super_admin)) -> AppSettings:
    return load_app_settings()


@router.get("/defaults", response_model=AppSettings)
def get_default_settings(_: None = Depends(get_current_super_admin)) -> AppSettings:
    return AppSettings()


@router.put("", response_model=AppSettings)
def update_settings(payload: AppSettings, _: None = Depends(get_current_super_admin)) -> AppSettings:
    return save_app_settings(payload)
