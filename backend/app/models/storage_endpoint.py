# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.db_models import StorageProvider


class StorageEndpointBase(BaseModel):
    name: str
    endpoint_url: str
    admin_endpoint: Optional[str] = None
    region: Optional[str] = None
    provider: StorageProvider = Field(default=StorageProvider.CEPH)
    admin_access_key: Optional[str] = None
    admin_secret_key: Optional[str] = None
    supervision_access_key: Optional[str] = None
    supervision_secret_key: Optional[str] = None
    capabilities: Optional[dict[str, bool]] = None

    @field_validator("name", "endpoint_url", "admin_endpoint", "region", mode="before")
    @classmethod
    def trim_str_fields(cls, value: Optional[str]) -> Optional[str]:
        if isinstance(value, str):
            value = value.strip()
        return value or None


class StorageEndpointCreate(StorageEndpointBase):
    pass


class StorageEndpointUpdate(BaseModel):
    name: Optional[str] = None
    endpoint_url: Optional[str] = None
    admin_endpoint: Optional[str] = None
    region: Optional[str] = None
    provider: Optional[StorageProvider] = None
    admin_access_key: Optional[str] = None
    admin_secret_key: Optional[str] = None
    supervision_access_key: Optional[str] = None
    supervision_secret_key: Optional[str] = None
    capabilities: Optional[dict[str, bool]] = None

    @field_validator("name", "endpoint_url", "admin_endpoint", "region", mode="before")
    @classmethod
    def trim_optional_str_fields(cls, value: Optional[str]) -> Optional[str]:
        if isinstance(value, str):
            value = value.strip()
        return value or None


class StorageEndpoint(StorageEndpointBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    provider: StorageProvider
    is_default: bool = False
    is_editable: bool = True
    created_at: datetime
    updated_at: datetime
    has_admin_secret: bool = False
    has_supervision_secret: bool = False
    capabilities: dict[str, bool] = Field(default_factory=dict)

    admin_secret_key: Optional[str] = Field(default=None, exclude=True)
    supervision_secret_key: Optional[str] = Field(default=None, exclude=True)


class StorageEndpointPublic(BaseModel):
    id: int
    name: str
    endpoint_url: str
    is_default: bool = False
