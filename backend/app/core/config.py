# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import json
from functools import lru_cache
from pathlib import Path
from typing import Optional
from urllib.parse import urlparse

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from pydantic_settings import BaseSettings


class OIDCProviderSettings(BaseModel):
    model_config = ConfigDict(extra="ignore")

    display_name: str
    discovery_url: str
    client_id: str
    client_secret: Optional[str] = None
    redirect_uri: str
    scopes: list[str] = Field(default_factory=lambda: ["openid", "email", "profile"])
    prompt: Optional[str] = None
    enabled: bool = True
    icon_url: Optional[str] = None
    use_pkce: bool = True
    use_nonce: bool = True

    @field_validator("scopes", mode="before")
    @classmethod
    def parse_scopes(cls, value):
        if isinstance(value, str):
            text = value.strip()
            if not text:
                return []
            if text.startswith("["):
                try:
                    return json.loads(text)
                except json.JSONDecodeError as exc:
                    raise ValueError("Unable to parse scopes JSON") from exc
            return [item.strip() for item in text.split(",") if item.strip()]
        return value

ENV_FILE_PATH = Path(__file__).resolve().parents[2] / ".env"
MIN_SECRET_LENGTH = 32
DEFAULT_INSECURE_SECRET_VALUES = {
    "",
    "change-me",
    "changeme",
    "default",
    "password",
    "secret",
}

class Settings(BaseSettings):
    model_config = ConfigDict(
        env_file=ENV_FILE_PATH,
        env_nested_delimiter="__",
        extra="ignore",
    )

    app_name: str = Field("s3-manager", description="Application name")
    api_v1_prefix: str = "/api"
    fernet_key: str = Field("change-me", description="JWT secret key (FERNET_KEY)")
    jwt_keys: list[str] = Field(
        default_factory=list,
        description="JWT key ring (JSON list or comma-separated)",
    )
    credential_key: str = Field(
        "change-me",
        description="Key used to encrypt credentials at rest (CREDENTIAL_KEY)",
    )
    credential_keys: list[str] = Field(
        default_factory=list,
        description="Credential key ring (JSON list or comma-separated)",
    )
    access_token_expire_minutes: int = 60
    refresh_token_expire_minutes: int = Field(60 * 24 * 14, description="Refresh token expiry (minutes)")
    log_level: str = Field("INFO", description="Root log level")
    login_rate_limit_window_seconds: int = Field(
        300,
        ge=1,
        description="Sliding window for login failure rate limiting (seconds)",
    )
    login_rate_limit_max_attempts: int = Field(
        10,
        ge=1,
        description="Maximum failed login attempts allowed in rate-limit window",
    )
    api_token_default_expire_days: int = Field(
        90,
        description="Default API token expiry (days)",
    )
    api_token_max_expire_days: int = Field(
        365,
        description="Maximum API token expiry (days)",
    )
    refresh_token_cookie_name: str = Field("refresh_token", description="Cookie name for refresh token")
    refresh_token_cookie_path: str = Field("/api/auth", description="Cookie path for refresh token")
    refresh_token_cookie_domain: Optional[str] = Field(None, description="Cookie domain for refresh token")
    refresh_token_cookie_secure: bool = Field(False, description="Secure flag for refresh cookie")
    refresh_token_cookie_samesite: str = Field("lax", description="SameSite policy for refresh cookie")

    database_url: str = Field(
        "sqlite:///./app.db",
        description="Database connection string (default sqlite)",
    )
    app_settings_path: Optional[str] = Field(
        None,
        description="Path to app_settings.json (defaults to backend/app/data/app_settings.json)",
    )

    seed_s3_endpoint: str = Field(
        "http://localhost:9000",
        description="Seed RGW/S3 endpoint",
    )
    seed_s3_endpoint_features: Optional[str] = Field(
        None,
        description="Seed default endpoint features (YAML or JSON)",
    )
    env_storage_endpoints: Optional[str] = Field(
        None,
        description="JSON array of storage endpoints managed by environment",
    )
    seed_s3_access_key: str = Field(
        "minio",
        description="Seed access key for RGW/S3",
    )
    seed_s3_secret_key: str = Field(
        "minio123",
        description="Seed secret key for RGW/S3",
    )
    seed_s3_region: str = Field(
        "us-east-1",
        description="Seed default S3 region",
    )

    seed_rgw_admin_access_key: Optional[str] = Field(
        None,
        description="Seed admin ops access key (defaults to seed_s3_access_key)",
    )
    seed_rgw_admin_secret_key: Optional[str] = Field(
        None,
        description="Seed admin ops secret key (defaults to seed_s3_secret_key)",
    )
    rgw_admin_timeout_seconds: float = Field(
        10.0,
        gt=0,
        description="HTTP timeout for RGW Admin Ops requests in seconds (RGW_ADMIN_TIMEOUT_SECONDS)",
    )
    rgw_admin_bucket_list_stats_timeout_seconds: float = Field(
        60.0,
        gt=0,
        description=(
            "HTTP timeout for RGW Admin Ops bucket listing with stats in seconds "
            "(RGW_ADMIN_BUCKET_LIST_STATS_TIMEOUT_SECONDS)"
        ),
    )
    seed_supervision_access_key: Optional[str] = Field(
        None,
        description="Seed access key dedicated to supervision usage stats",
    )
    seed_supervision_secret_key: Optional[str] = Field(
        None,
        description="Seed secret key dedicated to supervision usage stats",
    )
    seed_ceph_admin_access_key: Optional[str] = Field(
        None,
        description="Seed access key dedicated to Ceph Admin advanced operations",
    )
    seed_ceph_admin_secret_key: Optional[str] = Field(
        None,
        description="Seed secret key dedicated to Ceph Admin advanced operations",
    )

    # Default super-admin seed
    seed_super_admin_email: str = Field(
        "admin@example.com",
        description="Seed default super-admin login",
    )
    seed_super_admin_password: str = Field(
        "changeme",
        description="Seed default super-admin password",
    )
    seed_super_admin_full_name: Optional[str] = Field(
        "Admin",
        description="Seed default super-admin name",
    )

    cors_origins: list[str] = Field(default_factory=lambda: ["http://localhost:5173"])
    oidc_providers: dict[str, OIDCProviderSettings] = Field(default_factory=dict)
    oidc_state_ttl_seconds: int = Field(600, description="Validity of OIDC login state (seconds)")

    billing_enabled: bool = Field(True, description="Enable billing endpoints and collection")
    feature_manager_enabled: Optional[bool] = Field(
        None,
        description="Force Manager feature on/off (FEATURE_MANAGER_ENABLED)",
    )
    feature_browser_enabled: Optional[bool] = Field(
        None,
        description="Force Browser feature on/off (FEATURE_BROWSER_ENABLED)",
    )
    feature_portal_enabled: Optional[bool] = Field(
        None,
        description="Force Portal feature on/off (FEATURE_PORTAL_ENABLED)",
    )
    feature_ceph_admin_enabled: Optional[bool] = Field(
        None,
        description="Force Ceph Admin feature on/off (FEATURE_CEPH_ADMIN_ENABLED)",
    )
    feature_billing_enabled: Optional[bool] = Field(
        None,
        description="Force Billing feature on/off (FEATURE_BILLING_ENABLED)",
    )
    feature_endpoint_status_enabled: Optional[bool] = Field(
        None,
        description="Force Endpoint Status feature on/off (FEATURE_ENDPOINT_STATUS_ENABLED)",
    )
    billing_store_by_bucket: bool = Field(
        False,
        description="Store per-bucket breakdown in billing snapshots",
    )
    internal_cron_token: Optional[str] = Field(
        None,
        description="Shared secret for internal cron endpoints (INTERNAL_CRON_TOKEN)",
    )
    billing_default_rate_card_name: Optional[str] = Field(
        None,
        description="Default billing rate card name when no explicit assignment exists",
    )
    billing_daily_retention_days: int = Field(
        365,
        ge=0,
        description="Retention in days for billing daily tables; 0 disables purge (BILLING_DAILY_RETENTION_DAYS)",
    )
    quota_history_hourly_retention_days: int = Field(
        30,
        ge=0,
        description="Retention in days for quota_usage_hourly; 0 disables purge (QUOTA_HISTORY_HOURLY_RETENTION_DAYS)",
    )
    quota_history_daily_retention_days: int = Field(
        365,
        ge=0,
        description="Retention in days for quota_usage_daily; 0 disables purge (QUOTA_HISTORY_DAILY_RETENTION_DAYS)",
    )
    smtp_password: Optional[str] = Field(
        None,
        description="SMTP password used for quota notifications (SMTP_PASSWORD)",
    )

    healthcheck_enabled: bool = Field(
        True,
        description="Enable endpoint healthchecks (HEALTHCHECK_ENABLED)",
    )
    healthcheck_timeout_seconds: int = Field(
        5,
        description="HTTP timeout for endpoint healthchecks in seconds (HEALTHCHECK_TIMEOUT_SECONDS)",
    )
    healthcheck_interval_seconds: int = Field(
        300,
        description="Expected healthcheck interval in seconds (HEALTHCHECK_INTERVAL_SECONDS)",
    )
    healthcheck_retention_days: int = Field(
        30,
        description="Retention for raw healthcheck rows in days (HEALTHCHECK_RETENTION_DAYS)",
    )
    healthcheck_degraded_latency_ms: int = Field(
        2000,
        description="Latency threshold (ms) for degraded status, 0 disables (HEALTHCHECK_DEGRADED_LATENCY_MS)",
    )
    healthcheck_verify_ssl: bool = Field(
        True,
        description="Verify TLS certificates for healthchecks (HEALTHCHECK_VERIFY_SSL)",
    )
    healthcheck_latency_baseline_window_days: int = Field(
        7,
        description="Window (days) used to compute latency baseline per endpoint/mode (HEALTHCHECK_LATENCY_BASELINE_WINDOW_DAYS)",
    )
    healthcheck_baseline_sample_size: int = Field(
        80,
        description="Maximum number of recent UP checks used for latency baseline (HEALTHCHECK_BASELINE_SAMPLE_SIZE)",
    )
    healthcheck_relative_degraded_ratio: float = Field(
        1.8,
        description="Relative ratio over baseline latency that marks a check degraded (HEALTHCHECK_RELATIVE_DEGRADED_RATIO)",
    )
    healthcheck_relative_degraded_min_delta_ms: int = Field(
        200,
        description="Minimum absolute latency delta over baseline to mark degraded (HEALTHCHECK_RELATIVE_DEGRADED_MIN_DELTA_MS)",
    )
    healthcheck_incident_recent_minutes: int = Field(
        720,
        description="Minutes window to highlight recently ended incidents (HEALTHCHECK_INCIDENT_RECENT_MINUTES)",
    )
    bucket_migration_worker_enabled: bool = Field(
        True,
        description="Enable background bucket migration worker (BUCKET_MIGRATION_WORKER_ENABLED)",
    )
    bucket_migration_poll_interval_seconds: float = Field(
        2.0,
        description="Polling interval for bucket migration worker (BUCKET_MIGRATION_POLL_INTERVAL_SECONDS)",
    )
    bucket_migration_parallelism_max: int = Field(
        16,
        description="Global maximum parallel copy/delete workers for bucket migration (BUCKET_MIGRATION_PARALLELISM_MAX)",
    )
    bucket_migration_max_active_per_endpoint: int = Field(
        2,
        description=(
            "Maximum number of concurrently claimed bucket migrations that can use the same source or target endpoint "
            "(BUCKET_MIGRATION_MAX_ACTIVE_PER_ENDPOINT)"
        ),
    )
    bucket_migration_worker_lease_seconds: int = Field(
        120,
        description="Duration of worker lease on a migration before takeover is allowed (BUCKET_MIGRATION_WORKER_LEASE_SECONDS)",
    )
    bucket_migration_webhook_timeout_seconds: float = Field(
        2.0,
        gt=0,
        description="HTTP timeout for bucket migration webhooks (BUCKET_MIGRATION_WEBHOOK_TIMEOUT_SECONDS)",
    )
    bucket_migration_webhook_allow_private_targets: bool = Field(
        False,
        description=(
            "Allow bucket migration webhooks to target private/local network addresses "
            "(BUCKET_MIGRATION_WEBHOOK_ALLOW_PRIVATE_TARGETS)"
        ),
    )
    bucket_migration_webhook_allowed_hosts: list[str] = Field(
        default_factory=list,
        description=(
            "Optional allow-list for bucket migration webhook hosts (JSON list or comma-separated, "
            "BUCKET_MIGRATION_WEBHOOK_ALLOWED_HOSTS)"
        ),
    )
    bucket_migration_webhook_queue_size: int = Field(
        500,
        ge=1,
        le=10000,
        description="Maximum in-memory queue size for bucket migration webhooks (BUCKET_MIGRATION_WEBHOOK_QUEUE_SIZE)",
    )
    bucket_migration_webhook_workers: int = Field(
        1,
        ge=1,
        le=8,
        description="Number of background webhook workers for bucket migration events (BUCKET_MIGRATION_WEBHOOK_WORKERS)",
    )

    @field_validator("jwt_keys", "credential_keys", mode="before")
    @classmethod
    def parse_key_list(cls, value):
        if value is None:
            return []
        if isinstance(value, str):
            text = value.strip()
            if not text:
                return []
            if text.startswith("["):
                try:
                    return json.loads(text)
                except json.JSONDecodeError as exc:
                    raise ValueError("Unable to parse keys JSON") from exc
            return [item.strip() for item in text.split(",") if item.strip()]
        return value

    @field_validator("bucket_migration_webhook_allowed_hosts", mode="before")
    @classmethod
    def parse_webhook_host_list(cls, value):
        if value is None:
            return []
        if isinstance(value, str):
            text = value.strip()
            if not text:
                return []
            if text.startswith("["):
                try:
                    parsed = json.loads(text)
                except json.JSONDecodeError as exc:
                    raise ValueError("Unable to parse webhook hosts JSON") from exc
                if not isinstance(parsed, list):
                    raise ValueError("bucket_migration_webhook_allowed_hosts must be a list")
                return [str(item).strip().lower() for item in parsed if str(item).strip()]
            return [item.strip().lower() for item in text.split(",") if item.strip()]
        if isinstance(value, list):
            return [str(item).strip().lower() for item in value if str(item).strip()]
        return value

    @field_validator("log_level", mode="before")
    @classmethod
    def normalize_log_level(cls, value):
        text = str(value or "INFO").strip().upper()
        allowed = {"CRITICAL", "ERROR", "WARNING", "INFO", "DEBUG"}
        if text not in allowed:
            raise ValueError(f"log_level must be one of: {', '.join(sorted(allowed))}")
        return text

    @model_validator(mode="after")
    def ensure_key_defaults(self):
        if not self.jwt_keys:
            self.jwt_keys = [self.fernet_key]
        if not self.credential_keys:
            self.credential_keys = [self.credential_key]
        if self.api_token_default_expire_days < 1:
            raise ValueError("api_token_default_expire_days must be >= 1")
        if self.api_token_max_expire_days < 1:
            raise ValueError("api_token_max_expire_days must be >= 1")
        if self.api_token_default_expire_days > self.api_token_max_expire_days:
            raise ValueError("api_token_default_expire_days must be <= api_token_max_expire_days")
        return self


def is_weak_secret_value(value: Optional[str]) -> bool:
    if value is None:
        return True
    normalized = str(value).strip()
    if normalized.lower() in DEFAULT_INSECURE_SECRET_VALUES:
        return True
    return len(normalized) < MIN_SECRET_LENGTH


def collect_secret_warnings(settings: Settings) -> list[str]:
    warnings: list[str] = []
    weak_jwt = [key for key in settings.jwt_keys if is_weak_secret_value(key)]
    if weak_jwt:
        warnings.append(
            "Weak/default JWT key detected (FERNET_KEY/JWT_KEYS). "
            "Use high-entropy values with at least 32 characters."
        )
    weak_credential = [key for key in settings.credential_keys if is_weak_secret_value(key)]
    if weak_credential:
        warnings.append(
            "Weak/default credential encryption key detected (CREDENTIAL_KEY/CREDENTIAL_KEYS). "
            "Use high-entropy values with at least 32 characters."
        )
    if (settings.seed_super_admin_password or "").strip().lower() in {"changeme", "change-me", "admin", "password"}:
        warnings.append(
            "Default SEED_SUPER_ADMIN_PASSWORD detected. "
            "Change it immediately before exposing this environment."
        )
    return warnings


def is_local_origin(origin: str) -> bool:
    text = str(origin or "").strip()
    if not text:
        return True
    if text == "*":
        return False
    parsed = urlparse(text)
    host = (parsed.hostname or "").lower()
    if not host:
        return False
    return host in {"localhost", "127.0.0.1", "::1"}


def has_non_local_cors_origins(origins: list[str]) -> bool:
    return any(not is_local_origin(origin) for origin in (origins or []))


@lru_cache
def get_settings() -> Settings:
    return Settings()
