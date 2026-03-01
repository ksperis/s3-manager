# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.app_settings import BrandingSettings, GeneralSettings, LoginSettings
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
    settings = load_app_settings()
    general = settings.general
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
    # Never expose seed credentials through a public endpoint.
    return LoginSettings(
        allow_login_access_keys=allow_access_keys,
        allow_login_endpoint_list=allow_list,
        allow_login_custom_endpoint=allow_custom,
        default_endpoint_url=default_endpoint_url,
        endpoints=endpoints,
        login_logo_url=settings.branding.login_logo_url,
        seed_login_prefill=False,
        seed_login_email=None,
        seed_login_password=None,
    )


@router.get("/branding", response_model=BrandingSettings)
def get_branding_settings() -> BrandingSettings:
    return load_app_settings().branding
