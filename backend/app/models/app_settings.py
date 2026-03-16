# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import re
from typing import Optional
from urllib.parse import urlparse

from pydantic import BaseModel, Field, field_validator, model_validator

from app.core.config import get_settings
from app.models.storage_endpoint import StorageEndpointPublic

_settings = get_settings()

class GeneralSettings(BaseModel):
    manager_enabled: bool = True
    ceph_admin_enabled: bool = False
    storage_ops_enabled: bool = False
    browser_enabled: bool = True
    browser_root_enabled: bool = True
    browser_manager_enabled: bool = False
    browser_ceph_admin_enabled: bool = False
    billing_enabled: bool = False
    endpoint_status_enabled: bool = False
    quota_alerts_enabled: bool = False
    usage_history_enabled: bool = False
    bucket_migration_enabled: bool = False
    bucket_compare_enabled: bool = False
    manager_ceph_s3_user_keys_enabled: bool = True
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
    storage_ops_enabled: GeneralFeatureLock = Field(default_factory=GeneralFeatureLock)
    browser_enabled: GeneralFeatureLock = Field(default_factory=GeneralFeatureLock)
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
    general: GeneralSettings = GeneralSettings()
    manager: ManagerSettings = ManagerSettings()
    quota_notifications: QuotaNotificationSettings = QuotaNotificationSettings()
    browser: BrowserSettings = BrowserSettings()
    onboarding: OnboardingSettings = OnboardingSettings()
    branding: BrandingSettings = BrandingSettings()
