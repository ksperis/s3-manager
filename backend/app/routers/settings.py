# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.app_settings import GeneralSettings, LoginSettings
from app.models.storage_endpoint import StorageEndpointPublic
from app.routers.dependencies import get_current_actor
from app.services.app_settings_service import load_app_settings
from app.services.storage_endpoints_service import get_storage_endpoints_service

router = APIRouter(prefix="/settings", tags=["settings"])


@router.get("/general", response_model=GeneralSettings)
def get_general_settings(_: object = Depends(get_current_actor)) -> GeneralSettings:
    return load_app_settings().general


@router.get("/login", response_model=LoginSettings)
def get_login_settings(db: Session = Depends(get_db)) -> LoginSettings:
    general = load_app_settings().general
    allow_access_keys = bool(general.allow_login_access_keys)
    allow_list = bool(general.allow_login_endpoint_list)
    allow_custom = bool(general.allow_login_custom_endpoint)
    endpoints: list[StorageEndpointPublic] = []
    default_endpoint_url = None
    if allow_list:
        service = get_storage_endpoints_service(db)
        endpoints = [
            StorageEndpointPublic(
                id=endpoint.id,
                name=endpoint.name,
                endpoint_url=endpoint.endpoint_url,
                is_default=endpoint.is_default,
            )
            for endpoint in service.list_endpoints()
        ]
        if allow_access_keys:
            default_endpoint_url = service.get_default_endpoint_url()
    elif allow_access_keys:
        service = get_storage_endpoints_service(db)
        default_endpoint_url = service.get_default_endpoint_url()
    return LoginSettings(
        allow_login_access_keys=allow_access_keys,
        allow_login_endpoint_list=allow_list,
        allow_login_custom_endpoint=allow_custom,
        default_endpoint_url=default_endpoint_url,
        endpoints=endpoints,
    )
