# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import re
from typing import Optional
from urllib.parse import urlparse

from pydantic import BaseModel, Field, field_validator, model_validator

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
    allow_portal_user_access_key_create: bool = False
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
    allow_portal_user_access_key_create: Optional[bool] = None
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
    ceph_admin_enabled: bool = False
    browser_enabled: bool = True
    browser_root_enabled: bool = True
    browser_manager_enabled: bool = False
    browser_portal_enabled: bool = True
    browser_ceph_admin_enabled: bool = True
    allow_portal_manager_workspace: bool = False
    portal_enabled: bool = False
    billing_enabled: bool = False
    endpoint_status_enabled: bool = False
    bucket_migration_enabled: bool = True
    allow_ui_user_bucket_migration: bool = False
    allow_login_access_keys: bool = False
    allow_login_endpoint_list: bool = False
    allow_login_custom_endpoint: bool = False
    allow_user_private_connections: bool = False


class GeneralFeatureLock(BaseModel):
    forced: bool = False
    value: Optional[bool] = None
    source: Optional[str] = None


class GeneralFeatureLocks(BaseModel):
    manager_enabled: GeneralFeatureLock = Field(default_factory=GeneralFeatureLock)
    ceph_admin_enabled: GeneralFeatureLock = Field(default_factory=GeneralFeatureLock)
    browser_enabled: GeneralFeatureLock = Field(default_factory=GeneralFeatureLock)
    portal_enabled: GeneralFeatureLock = Field(default_factory=GeneralFeatureLock)
    billing_enabled: GeneralFeatureLock = Field(default_factory=GeneralFeatureLock)
    endpoint_status_enabled: GeneralFeatureLock = Field(default_factory=GeneralFeatureLock)


class BrandingSettings(BaseModel):
    primary_color: str = "#0ea5e9"
    login_logo_url: Optional[str] = None

    @field_validator("primary_color", mode="before")
    @classmethod
    def normalize_primary_color(cls, value: Optional[str]) -> str:
        if value is None:
            return "#0ea5e9"
        if not isinstance(value, str):
            raise ValueError("primary_color must be a string")
        normalized = value.strip().lower()
        if not normalized:
            return "#0ea5e9"
        if not re.fullmatch(r"#[0-9a-f]{6}", normalized):
            raise ValueError("primary_color must be a hex color in #rrggbb format")
        return normalized

    @field_validator("login_logo_url", mode="before")
    @classmethod
    def normalize_login_logo_url(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        if not isinstance(value, str):
            raise ValueError("login_logo_url must be a string")
        normalized = value.strip()
        if not normalized:
            return None
        if normalized.startswith("/"):
            return normalized
        if normalized.startswith("data:image/"):
            return normalized
        parsed = urlparse(normalized)
        if parsed.scheme in {"http", "https"} and bool(parsed.netloc):
            return normalized
        raise ValueError("login_logo_url must be http(s), root-relative (/...), or data:image/... URL")


class LoginSettings(BaseModel):
    allow_login_access_keys: bool = False
    allow_login_endpoint_list: bool = False
    allow_login_custom_endpoint: bool = False
    default_endpoint_url: Optional[str] = None
    endpoints: list[StorageEndpointPublic] = Field(default_factory=list)
    login_logo_url: Optional[str] = None
    seed_login_prefill: bool = False
    seed_login_email: Optional[str] = None
    seed_login_password: Optional[str] = None


class PortalSettings(BaseModel):
    allow_portal_key: bool = False
    allow_portal_user_bucket_create: bool = True
    allow_portal_user_access_key_create: bool = True
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
    bucket_migration_parallelism_default: int = Field(
        default=_settings.bucket_migration_parallelism_max,
        ge=1,
        le=128,
    )
    bucket_migration_parallelism_max: int = Field(
        default=_settings.bucket_migration_parallelism_max,
        ge=1,
        le=128,
    )
    bucket_migration_max_active_per_endpoint: int = Field(
        default=_settings.bucket_migration_max_active_per_endpoint,
        ge=1,
        le=64,
    )

    @model_validator(mode="after")
    def validate_bucket_migration_limits(self):
        if self.bucket_migration_parallelism_default > self.bucket_migration_parallelism_max:
            raise ValueError("bucket_migration_parallelism_default must be <= bucket_migration_parallelism_max")
        return self


class BrowserSettings(BaseModel):
    allow_proxy_transfers: bool = True
    direct_upload_parallelism: int = Field(default=5, ge=1, le=20)
    proxy_upload_parallelism: int = Field(default=2, ge=1, le=20)
    direct_download_parallelism: int = Field(default=5, ge=1, le=20)
    proxy_download_parallelism: int = Field(default=2, ge=1, le=20)
    other_operations_parallelism: int = Field(default=3, ge=1, le=20)
    streaming_zip_threshold_mb: int = Field(default=200, ge=0, le=10240)


class OnboardingSettings(BaseModel):
    dismissed: bool = False


class AppSettings(BaseModel):
    general: GeneralSettings = GeneralSettings()
    portal: PortalSettings = PortalSettings()
    manager: ManagerSettings = ManagerSettings()
    browser: BrowserSettings = BrowserSettings()
    onboarding: OnboardingSettings = OnboardingSettings()
    branding: BrandingSettings = BrandingSettings()
