# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from typing import Optional

from pydantic import BaseModel, Field, field_validator

from app.core.config import get_settings
from app.models.storage_endpoint import StorageEndpointPublic

_settings = get_settings()


def _default_portal_cors_origins() -> list[str]:
    return list(_settings.cors_origins or [])


def _default_portal_manager_actions() -> list[str]:
    return ["iam:*", "s3:*", "sts:*"]


def _default_portal_user_actions() -> list[str]:
    return ["s3:ListAllMyBuckets", "sts:GetSessionToken"]


def _default_portal_bucket_access_actions() -> list[str]:
    return [
        "s3:GetBucketLocation",
        "s3:ListBucket",
        "s3:ListBucketVersions",
        "s3:ListBucketMultipartUploads",
        "s3:GetObject",
        "s3:GetObjectVersion",
        "s3:GetObjectTagging",
        "s3:GetObjectVersionTagging",
        "s3:PutObject",
        "s3:DeleteObject",
        "s3:AbortMultipartUpload",
        "s3:ListMultipartUploadParts",
        "s3:GetBucketVersioning",
        "s3:GetBucketCORS",
        "s3:GetBucketAcl",
        "s3:GetBucketPolicy",
        "s3:GetLifecycleConfiguration",
    ]


class PortalIAMPolicySettings(BaseModel):
    actions: list[str] = Field(default_factory=list)
    advanced_policy: Optional[dict] = None

    @field_validator("actions", mode="before")
    @classmethod
    def normalize_actions(cls, value: Optional[list[str]]) -> list[str]:
        if not value:
            return []
        if isinstance(value, str):
            return [entry.strip() for entry in value.split(",") if entry.strip()]
        return [entry for entry in value if isinstance(entry, str) and entry.strip()]


class PortalIAMPolicyOverridePolicy(BaseModel):
    actions: bool = False
    advanced_policy: bool = False


class PortalBucketDefaultsOverridePolicy(BaseModel):
    versioning: bool = False
    enable_cors: bool = False
    enable_lifecycle: bool = False
    cors_allowed_origins: bool = False


class PortalSettingsOverridePolicy(BaseModel):
    allow_portal_key: bool = False
    allow_portal_user_bucket_create: bool = False
    iam_group_manager_policy: PortalIAMPolicyOverridePolicy = Field(default_factory=PortalIAMPolicyOverridePolicy)
    iam_group_user_policy: PortalIAMPolicyOverridePolicy = Field(default_factory=PortalIAMPolicyOverridePolicy)
    bucket_access_policy: PortalIAMPolicyOverridePolicy = Field(default_factory=PortalIAMPolicyOverridePolicy)
    bucket_defaults: PortalBucketDefaultsOverridePolicy = Field(default_factory=PortalBucketDefaultsOverridePolicy)


class PortalIAMPolicyOverride(BaseModel):
    actions: Optional[list[str]] = None
    advanced_policy: Optional[dict] = None

    @field_validator("actions", mode="before")
    @classmethod
    def normalize_actions(cls, value: Optional[list[str]]) -> Optional[list[str]]:
        if value is None:
            return None
        if isinstance(value, str):
            normalized = [entry.strip() for entry in value.split(",") if entry.strip()]
            return normalized
        return [entry for entry in value if isinstance(entry, str) and entry.strip()]


class PortalBucketDefaultsOverride(BaseModel):
    versioning: Optional[bool] = None
    enable_cors: Optional[bool] = None
    enable_lifecycle: Optional[bool] = None
    cors_allowed_origins: Optional[list[str]] = None


class PortalSettingsOverride(BaseModel):
    allow_portal_key: Optional[bool] = None
    allow_portal_user_bucket_create: Optional[bool] = None
    iam_group_manager_policy: Optional[PortalIAMPolicyOverride] = None
    iam_group_user_policy: Optional[PortalIAMPolicyOverride] = None
    bucket_access_policy: Optional[PortalIAMPolicyOverride] = None
    bucket_defaults: Optional[PortalBucketDefaultsOverride] = None


class PortalBucketDefaults(BaseModel):
    versioning: bool = True
    enable_cors: bool = True
    enable_lifecycle: bool = True
    cors_allowed_origins: list[str] = Field(default_factory=_default_portal_cors_origins)


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


class PortalSettings(BaseModel):
    allow_portal_key: bool = False
    allow_portal_user_bucket_create: bool = True
    iam_group_manager_policy: PortalIAMPolicySettings = Field(
        default_factory=lambda: PortalIAMPolicySettings(actions=_default_portal_manager_actions())
    )
    iam_group_user_policy: PortalIAMPolicySettings = Field(
        default_factory=lambda: PortalIAMPolicySettings(actions=_default_portal_user_actions())
    )
    bucket_access_policy: PortalIAMPolicySettings = Field(
        default_factory=lambda: PortalIAMPolicySettings(actions=_default_portal_bucket_access_actions())
    )
    bucket_defaults: PortalBucketDefaults = Field(default_factory=PortalBucketDefaults)
    override_policy: PortalSettingsOverridePolicy = Field(default_factory=PortalSettingsOverridePolicy)


class ManagerSettings(BaseModel):
    allow_manager_user_usage_stats: bool = True


class BrowserSettings(BaseModel):
    allow_proxy_transfers: bool = True
    direct_upload_parallelism: int = Field(default=5, ge=1, le=20)
    proxy_upload_parallelism: int = Field(default=2, ge=1, le=20)
    direct_download_parallelism: int = Field(default=5, ge=1, le=20)
    proxy_download_parallelism: int = Field(default=2, ge=1, le=20)
    other_operations_parallelism: int = Field(default=3, ge=1, le=20)


class AppSettings(BaseModel):
    general: GeneralSettings = GeneralSettings()
    portal: PortalSettings = PortalSettings()
    manager: ManagerSettings = ManagerSettings()
    browser: BrowserSettings = BrowserSettings()
