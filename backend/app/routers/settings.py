# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from fastapi import APIRouter, Depends

from app.models.app_settings import GeneralSettings
from app.routers.dependencies import get_current_actor
from app.services.app_settings_service import load_app_settings

router = APIRouter(prefix="/settings", tags=["settings"])


@router.get("/general", response_model=GeneralSettings)
def get_general_settings(_: object = Depends(get_current_actor)) -> GeneralSettings:
    return load_app_settings().general
