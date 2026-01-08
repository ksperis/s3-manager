# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.db_models import StorageProvider


class StorageEndpointFeature(BaseModel):
    enabled: bool = False
    endpoint: Optional[str] = None


class StorageEndpointFeatures(BaseModel):
    admin: StorageEndpointFeature = Field(default_factory=StorageEndpointFeature)
    sts: StorageEndpointFeature = Field(default_factory=StorageEndpointFeature)
    usage: StorageEndpointFeature = Field(default_factory=StorageEndpointFeature)
    metrics: StorageEndpointFeature = Field(default_factory=StorageEndpointFeature)
    static_website: StorageEndpointFeature = Field(default_factory=StorageEndpointFeature)


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
    features_config: Optional[str] = None
    presign_enabled: bool = True
    allow_external_access: bool = False
    max_session_duration: int = 3600
    allowed_packages: Optional[list[str]] = None

    @field_validator("name", "endpoint_url", "admin_endpoint", "region", mode="before")
    @classmethod
    def trim_str_fields(cls, value: Optional[str]) -> Optional[str]:
        if isinstance(value, str):
            value = value.strip()
        return value or None

    @field_validator("allowed_packages", mode="before")
    @classmethod
    def normalize_allowed_packages(cls, value: Optional[object]) -> Optional[list[str]]:
        if value is None:
            return None
        if not isinstance(value, list):
            raise ValueError("allowed_packages must be a list of strings")
        cleaned: list[str] = []
        seen: set[str] = set()
        for entry in value:
            if not isinstance(entry, str):
                continue
            normalized = entry.strip()
            if not normalized or normalized in seen:
                continue
            seen.add(normalized)
            cleaned.append(normalized)
        return cleaned or None

    @field_validator("max_session_duration")
    @classmethod
    def validate_session_duration(cls, value: int) -> int:
        if value < 900 or value > 43200:
            raise ValueError("max_session_duration must be between 900 and 43200 seconds")
        return value


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
    features_config: Optional[str] = None
    presign_enabled: Optional[bool] = None
    allow_external_access: Optional[bool] = None
    max_session_duration: Optional[int] = None
    allowed_packages: Optional[list[str]] = None

    @field_validator("name", "endpoint_url", "admin_endpoint", "region", mode="before")
    @classmethod
    def trim_optional_str_fields(cls, value: Optional[str]) -> Optional[str]:
        if isinstance(value, str):
            value = value.strip()
        return value or None

    @field_validator("allowed_packages", mode="before")
    @classmethod
    def normalize_allowed_packages_update(cls, value: Optional[object]) -> Optional[list[str]]:
        if value is None:
            return None
        if not isinstance(value, list):
            raise ValueError("allowed_packages must be a list of strings")
        cleaned: list[str] = []
        seen: set[str] = set()
        for entry in value:
            if not isinstance(entry, str):
                continue
            normalized = entry.strip()
            if not normalized or normalized in seen:
                continue
            seen.add(normalized)
            cleaned.append(normalized)
        return cleaned or []

    @field_validator("max_session_duration")
    @classmethod
    def validate_session_duration_update(cls, value: Optional[int]) -> Optional[int]:
        if value is None:
            return None
        if value < 900 or value > 43200:
            raise ValueError("max_session_duration must be between 900 and 43200 seconds")
        return value


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
    features_config: Optional[str] = None
    features: StorageEndpointFeatures = Field(default_factory=StorageEndpointFeatures)

    admin_secret_key: Optional[str] = Field(default=None, exclude=True)
    supervision_secret_key: Optional[str] = Field(default=None, exclude=True)


class StorageEndpointPublic(BaseModel):
    id: int
    name: str
    endpoint_url: str
    is_default: bool = False
