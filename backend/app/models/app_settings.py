# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import re
from typing import Optional
from urllib.parse import urlparse

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.core.config import get_settings
from app.models.storage_endpoint import StorageEndpointPublic


def _default_portal_cors_origins() -> list[str]:
    return list(get_settings().cors_origins or [])


def _default_bucket_migration_parallelism_max() -> int:
    return get_settings().bucket_migration_parallelism_max


def _default_bucket_migration_max_active_per_endpoint() -> int:
    return get_settings().bucket_migration_max_active_per_endpoint


class PortalBucketDefaultsOverride(BaseModel):
    model_config = ConfigDict(extra="forbid")

    versioning: Optional[bool] = None
    enable_cors: Optional[bool] = None
    enable_lifecycle: Optional[bool] = None
    noncurrent_version_expiration_days: Optional[int] = Field(default=None, ge=1)
    cors_allowed_origins: Optional[list[str]] = None


class PortalSettingsOverride(BaseModel):
    model_config = ConfigDict(extra="forbid")

    browser_access_enabled: Optional[bool] = None
    allow_private_storage_space_create: Optional[bool] = None
    allow_portal_named_bucket_create: Optional[bool] = None
    allow_portal_user_access_key_create: Optional[bool] = None
    server_access_logging_enabled: Optional[bool] = None
    storage_space_version_cleanup_enabled: Optional[bool] = None
    bucket_defaults: Optional[PortalBucketDefaultsOverride] = None


class PortalSettingsAdminUpdate(PortalSettingsOverride):
    delegated_to_portal_managers: Optional[bool] = None


class PortalBucketDefaults(BaseModel):
    versioning: bool = True
    enable_cors: bool = True
    enable_lifecycle: bool = True
    noncurrent_version_expiration_days: int = Field(default=90, ge=1)
    cors_allowed_origins: list[str] = Field(default_factory=_default_portal_cors_origins)


class GeneralSettings(BaseModel):
    manager_enabled: bool = True
    ceph_admin_enabled: bool = False
    storage_ops_enabled: bool = False
    browser_enabled: bool = True
    browser_root_enabled: bool = True
    browser_manager_enabled: bool = False
    browser_portal_enabled: bool = True
    browser_ceph_admin_enabled: bool = False
    portal_enabled: bool = False
    billing_enabled: bool = False
    endpoint_status_enabled: bool = True
    quota_alerts_enabled: bool = False
    usage_history_enabled: bool = True
    bucket_migration_enabled: bool = False
    bucket_compare_enabled: bool = True
    bucket_integrity_check_enabled: bool = True
    bucket_usage_stats_enabled: bool = True
    bucket_purge_enabled: bool = False
    bucket_quota_management_enabled: bool = True
    manager_ceph_s3_user_keys_enabled: bool = True
    allow_login_access_keys: bool = False
    allow_login_endpoint_list: bool = False
    allow_login_custom_endpoint: bool = False


class GeneralFeatureLock(BaseModel):
    forced: bool = False
    value: Optional[bool] = None
    source: Optional[str] = None


class GeneralFeatureLocks(BaseModel):
    manager_enabled: GeneralFeatureLock = Field(default_factory=GeneralFeatureLock)
    ceph_admin_enabled: GeneralFeatureLock = Field(default_factory=GeneralFeatureLock)
    storage_ops_enabled: GeneralFeatureLock = Field(default_factory=GeneralFeatureLock)
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
    model_config = ConfigDict(extra="forbid")

    browser_access_enabled: bool = False
    allow_private_storage_space_create: bool = True
    allow_portal_named_bucket_create: bool = False
    allow_portal_user_access_key_create: bool = True
    server_access_logging_enabled: bool = True
    server_access_log_retention_days: int = Field(default=30, ge=1)
    storage_space_version_cleanup_enabled: bool = True
    max_portal_user_access_keys: int = Field(default=2, ge=1)
    bucket_defaults: PortalBucketDefaults = Field(default_factory=PortalBucketDefaults)


class ManagerSettings(BaseModel):
    manager_rgw_usage_metrics_enabled: bool = True
    bucket_migration_parallelism_default: int = Field(
        default_factory=_default_bucket_migration_parallelism_max,
        ge=1,
        le=128,
    )
    bucket_migration_parallelism_max: int = Field(
        default_factory=_default_bucket_migration_parallelism_max,
        ge=1,
        le=128,
    )
    bucket_migration_max_active_per_endpoint: int = Field(
        default_factory=_default_bucket_migration_max_active_per_endpoint,
        ge=1,
        le=64,
    )

    @model_validator(mode="after")
    def validate_bucket_migration_limits(self):
        if self.bucket_migration_parallelism_default > self.bucket_migration_parallelism_max:
            raise ValueError("bucket_migration_parallelism_default must be <= bucket_migration_parallelism_max")
        return self


class QuotaNotificationSettings(BaseModel):
    threshold_percent: int = Field(default=85, ge=1, le=100)
    include_subject_contact_email: bool = False
    smtp_host: Optional[str] = None
    smtp_port: int = Field(default=587, ge=1, le=65535)
    smtp_username: Optional[str] = None
    smtp_from_email: Optional[str] = None
    smtp_from_name: Optional[str] = None
    smtp_starttls: bool = True
    smtp_timeout_seconds: int = Field(default=15, ge=1, le=300)

    @field_validator("smtp_host", "smtp_username", "smtp_from_email", "smtp_from_name", mode="before")
    @classmethod
    def normalize_optional_strings(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        if not isinstance(value, str):
            raise ValueError("SMTP settings must be strings")
        normalized = value.strip()
        return normalized or None


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
    general: GeneralSettings = Field(default_factory=GeneralSettings)
    portal: PortalSettings = Field(default_factory=PortalSettings)
    manager: ManagerSettings = Field(default_factory=ManagerSettings)
    quota_notifications: QuotaNotificationSettings = Field(default_factory=QuotaNotificationSettings)
    browser: BrowserSettings = Field(default_factory=BrowserSettings)
    onboarding: OnboardingSettings = Field(default_factory=OnboardingSettings)
    branding: BrandingSettings = Field(default_factory=BrandingSettings)
