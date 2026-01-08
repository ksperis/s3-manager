# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from typing import Optional

from pydantic import BaseModel, Field

from app.models.storage_endpoint import StorageEndpointPublic


class GeneralSettings(BaseModel):
    manager_enabled: bool = True
    browser_enabled: bool = True
    portal_enabled: bool = False
    allow_login_access_keys: bool = True
    allow_login_endpoint_list: bool = False
    allow_login_custom_endpoint: bool = False


class LoginSettings(BaseModel):
    allow_login_access_keys: bool = True
    allow_login_endpoint_list: bool = False
    allow_login_custom_endpoint: bool = False
    default_endpoint_url: Optional[str] = None
    endpoints: list[StorageEndpointPublic] = Field(default_factory=list)


class ManagerSettings(BaseModel):
    allow_manager_user_usage_stats: bool = True


class BrowserSettings(BaseModel):
    allow_proxy_transfers: bool = False
    direct_upload_parallelism: int = Field(default=5, ge=1, le=20)
    proxy_upload_parallelism: int = Field(default=2, ge=1, le=20)
    direct_download_parallelism: int = Field(default=5, ge=1, le=20)
    proxy_download_parallelism: int = Field(default=2, ge=1, le=20)
    other_operations_parallelism: int = Field(default=3, ge=1, le=20)


class AppSettings(BaseModel):
    general: GeneralSettings = GeneralSettings()
    manager: ManagerSettings = ManagerSettings()
    browser: BrowserSettings = BrowserSettings()
