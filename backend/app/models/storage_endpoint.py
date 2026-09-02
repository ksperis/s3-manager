# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import math
from datetime import datetime
from typing import Literal, Optional

from pydantic import ConfigDict, Field, field_validator

from app.models.base import ApiModel
from app.db import StorageProvider
from app.models.tagging import RequiredTagDefinitionList, TagDefinitionSummary


class StorageEndpointFeature(ApiModel):
    enabled: bool = False
    endpoint: Optional[str] = None


class StorageEndpointHealthcheckFeature(ApiModel):
    enabled: bool = True
    mode: Literal["http", "s3"] = "http"
    url: Optional[str] = None


class StorageEndpointFeatures(ApiModel):
    admin: StorageEndpointFeature = Field(default_factory=StorageEndpointFeature)
    account: StorageEndpointFeature = Field(default_factory=StorageEndpointFeature)
    sts: StorageEndpointFeature = Field(default_factory=StorageEndpointFeature)
    usage: StorageEndpointFeature = Field(default_factory=StorageEndpointFeature)
    metrics: StorageEndpointFeature = Field(default_factory=StorageEndpointFeature)
    static_website: StorageEndpointFeature = Field(default_factory=StorageEndpointFeature)
    iam: StorageEndpointFeature = Field(default_factory=StorageEndpointFeature)
    sns: StorageEndpointFeature = Field(default_factory=StorageEndpointFeature)
    sse: StorageEndpointFeature = Field(default_factory=StorageEndpointFeature)
    replication: StorageEndpointFeature = Field(default_factory=StorageEndpointFeature)
    healthcheck: StorageEndpointHealthcheckFeature = Field(default_factory=StorageEndpointHealthcheckFeature)


class StorageEndpointAdminOpsPermissions(ApiModel):
    users_read: bool = False
    users_write: bool = False
    accounts_read: bool = False
    accounts_write: bool = False


class StorageEndpointBase(ApiModel):
    name: str
    endpoint_url: str
    region: Optional[str] = None
    force_path_style: bool = False
    verify_tls: bool = True
    provider: StorageProvider = Field(default=StorageProvider.CEPH)
    admin_access_key: Optional[str] = None
    admin_secret_key: Optional[str] = None
    supervision_access_key: Optional[str] = None
    supervision_secret_key: Optional[str] = None
    ceph_admin_access_key: Optional[str] = None
    ceph_admin_secret_key: Optional[str] = None
    features_config: Optional[str] = None
    latitude: Optional[float] = Field(default=None)
    longitude: Optional[float] = Field(default=None)

    @field_validator("name", "endpoint_url", "region", mode="before")
    @classmethod
    def trim_str_fields(cls, value: Optional[str]) -> Optional[str]:
        if isinstance(value, str):
            value = value.strip()
        return value or None

    @field_validator("latitude")
    @classmethod
    def validate_latitude(cls, value: Optional[float]) -> Optional[float]:
        if value is None:
            return None
        if not math.isfinite(value) or value < -90 or value > 90:
            raise ValueError("Latitude must be a finite number between -90 and 90.")
        return value

    @field_validator("longitude")
    @classmethod
    def validate_longitude(cls, value: Optional[float]) -> Optional[float]:
        if value is None:
            return None
        if not math.isfinite(value) or value < -180 or value > 180:
            raise ValueError("Longitude must be a finite number between -180 and 180.")
        return value


class StorageEndpointCreate(StorageEndpointBase):
    pass


class StorageEndpointUpdate(ApiModel):
    name: Optional[str] = None
    endpoint_url: Optional[str] = None
    region: Optional[str] = None
    force_path_style: Optional[bool] = None
    verify_tls: Optional[bool] = None
    provider: Optional[StorageProvider] = None
    admin_access_key: Optional[str] = None
    admin_secret_key: Optional[str] = None
    supervision_access_key: Optional[str] = None
    supervision_secret_key: Optional[str] = None
    ceph_admin_access_key: Optional[str] = None
    ceph_admin_secret_key: Optional[str] = None
    features_config: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None

    @field_validator("name", "endpoint_url", "region", mode="before")
    @classmethod
    def trim_optional_str_fields(cls, value: Optional[str]) -> Optional[str]:
        if isinstance(value, str):
            value = value.strip()
        return value or None

    @field_validator("latitude")
    @classmethod
    def validate_optional_latitude(cls, value: Optional[float]) -> Optional[float]:
        return StorageEndpointBase.validate_latitude(value)

    @field_validator("longitude")
    @classmethod
    def validate_optional_longitude(cls, value: Optional[float]) -> Optional[float]:
        return StorageEndpointBase.validate_longitude(value)


class StorageEndpointTagsUpdate(ApiModel):
    tags: RequiredTagDefinitionList = Field(default_factory=list)


class StorageEndpoint(StorageEndpointBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    provider: StorageProvider
    is_default: bool = False
    is_editable: bool = True
    created_at: datetime
    updated_at: datetime
    tags: list[TagDefinitionSummary] = Field(default_factory=list)
    has_admin_secret: bool = False
    has_supervision_secret: bool = False
    has_ceph_admin_secret: bool = False
    capabilities: dict[str, bool] = Field(default_factory=dict)
    admin_ops_permissions: StorageEndpointAdminOpsPermissions = Field(
        default_factory=StorageEndpointAdminOpsPermissions
    )
    features_config: Optional[str] = None
    features: StorageEndpointFeatures = Field(default_factory=StorageEndpointFeatures)

    admin_secret_key: Optional[str] = Field(default=None, exclude=True)
    supervision_secret_key: Optional[str] = Field(default=None, exclude=True)
    ceph_admin_secret_key: Optional[str] = Field(default=None, exclude=True)


class StorageEndpointPublic(ApiModel):
    id: int
    name: str
    endpoint_url: str
    is_default: bool = False


class StorageEndpointMeta(ApiModel):
    managed_by_env: bool = False


class StorageEndpointFeatureDetectionRequest(ApiModel):
    endpoint_id: Optional[int] = None
    endpoint_url: str
    admin_endpoint: Optional[str] = None
    region: Optional[str] = None
    verify_tls: Optional[bool] = None
    admin_access_key: Optional[str] = None
    admin_secret_key: Optional[str] = None
    supervision_access_key: Optional[str] = None
    supervision_secret_key: Optional[str] = None

    @field_validator(
        "endpoint_url",
        "admin_endpoint",
        "region",
        "admin_access_key",
        "admin_secret_key",
        "supervision_access_key",
        "supervision_secret_key",
        mode="before",
    )
    @classmethod
    def trim_detection_str_fields(cls, value: Optional[str]) -> Optional[str]:
        if isinstance(value, str):
            value = value.strip()
        return value or None


class StorageEndpointFeatureDetectionResult(ApiModel):
    admin: bool = False
    account: bool = False
    usage: bool = False
    metrics: bool = False
    admin_error: Optional[str] = None
    account_error: Optional[str] = None
    metrics_error: Optional[str] = None
    usage_error: Optional[str] = None
    warnings: list[str] = Field(default_factory=list)
