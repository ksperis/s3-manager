# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import json
from functools import lru_cache
from pathlib import Path
from typing import Optional

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

@lru_cache
def get_settings() -> Settings:
    return Settings()
