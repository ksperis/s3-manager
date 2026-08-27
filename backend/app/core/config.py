# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import json
import ipaddress
from functools import lru_cache
from pathlib import Path
from typing import Literal, Optional
from urllib.parse import ParseResult, urlparse

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from pydantic_settings import BaseSettings

from app.utils.ldap_validation import (
    LDAP_PROVIDER_DEFAULT_USER_FILTER,
    LDAP_PROVIDER_ID_PATTERN,
    normalize_optional_ldap_string,
    normalize_required_ldap_string,
    validate_ldap_url,
    validate_ldap_user_filter,
)


class OIDCProviderSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")

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
    allowed_algorithms: list[str] = Field(default_factory=lambda: ["RS256"])
    allowed_hosts: list[str] = Field(default_factory=list)

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

    @field_validator("allowed_algorithms", "allowed_hosts", mode="before")
    @classmethod
    def parse_security_lists(cls, value):
        if isinstance(value, str):
            text = value.strip()
            if not text:
                return []
            if text.startswith("["):
                try:
                    return json.loads(text)
                except json.JSONDecodeError as exc:
                    raise ValueError("Unable to parse OIDC security list JSON") from exc
            return [item.strip() for item in text.split(",") if item.strip()]
        return value

    @field_validator("allowed_algorithms")
    @classmethod
    def validate_allowed_algorithms(cls, value: list[str]) -> list[str]:
        allowed = {"RS256", "RS384", "RS512", "ES256", "ES384", "ES512", "PS256", "PS384", "PS512"}
        normalized = [str(item).strip().upper() for item in value]
        if not normalized or any(item not in allowed for item in normalized):
            raise ValueError("OIDC allowed_algorithms must contain supported asymmetric signature algorithms")
        return normalized


class LDAPProviderSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")

    display_name: str
    url: str
    bind_dn: Optional[str] = None
    bind_password: Optional[str] = None
    user_base_dn: str
    user_filter: str = LDAP_PROVIDER_DEFAULT_USER_FILTER
    email_attribute: str = "mail"
    name_attribute: Optional[str] = "displayName"
    subject_attribute: Optional[str] = None
    start_tls: bool = False
    tls_verify: bool = True
    tls_ca_file: Optional[str] = None
    allow_legacy_tls: bool = False
    timeout_seconds: float = Field(5.0, gt=0, le=60)
    enabled: bool = True
    allow_insecure: bool = False

    normalize_required_strings = field_validator(
        "display_name",
        "url",
        "user_base_dn",
        "user_filter",
        "email_attribute",
        mode="before",
    )(normalize_required_ldap_string)

    normalize_optional_strings = field_validator(
        "bind_dn",
        "bind_password",
        "name_attribute",
        "subject_attribute",
        "tls_ca_file",
        mode="before",
    )(normalize_optional_ldap_string)

    validate_url = field_validator("url")(validate_ldap_url)

    validate_user_filter = field_validator("user_filter")(validate_ldap_user_filter)

    @model_validator(mode="after")
    def validate_transport(self):
        if bool(self.bind_dn) != bool(self.bind_password):
            raise ValueError("LDAP provider bind_dn and bind_password must be configured together")
        parsed = urlparse(self.url)
        if parsed.scheme == "ldaps" and self.start_tls:
            raise ValueError("LDAP provider start_tls cannot be used with ldaps:// URLs")
        if parsed.scheme == "ldap" and not self.start_tls and not self.allow_insecure:
            raise ValueError("LDAP provider requires LDAPS or START_TLS unless allow_insecure=true")
        return self


AppEnvironment = Literal["development", "test", "production"]

ENV_FILE_PATH = Path(__file__).resolve().parents[2] / ".env"
DEFAULT_SQLITE_DB_PATH = ENV_FILE_PATH.parent / "app.db"
MIN_SECRET_LENGTH = 32
DEFAULT_INSECURE_SECRET_VALUES = {
    "",
    "change-me",
    "changeme",
    "default",
    "password",
    "secret",
}
def _default_sqlite_database_url() -> str:
    return f"sqlite:///{DEFAULT_SQLITE_DB_PATH.resolve().as_posix()}"


def _normalize_sqlite_database_url(value: str) -> str:
    text = str(value or "").strip()
    if not text:
        return text
    for prefix in ("sqlite:///", "sqlite+pysqlite:///"):
        if not text.startswith(prefix):
            continue
        remainder = text[len(prefix) :]
        if not remainder or remainder.startswith(":memory:") or remainder.startswith("/") or remainder.startswith("file:"):
            return text
        path_part, separator, suffix = remainder.partition("?")
        resolved = (ENV_FILE_PATH.parent / Path(path_part)).resolve()
        normalized = f"{prefix}{resolved.as_posix()}"
        return f"{normalized}?{suffix}" if separator else normalized
    return text

class Settings(BaseSettings):
    model_config = ConfigDict(
        env_file=ENV_FILE_PATH,
        env_nested_delimiter="__",
        extra="ignore",
    )

    app_name: str = Field("BucketReef", description="Application name")
    app_env: AppEnvironment = Field("development", description="Runtime security profile")
    api_v1_prefix: str = "/api"
    jwt_keys: list[str] = Field(
        default_factory=lambda: ["change-me"],
        description="JWT key ring (JSON list)",
    )
    credential_keys: list[str] = Field(
        default_factory=lambda: ["change-me"],
        description="Credential key ring (JSON list)",
    )
    ui_jwt_keys: list[str] = Field(default_factory=list, description="Dedicated UI JWT key ring")
    api_jwt_keys: list[str] = Field(default_factory=list, description="Dedicated API JWT key ring")
    jwt_algorithm: Literal["HS256", "HS384", "HS512"] = "HS256"
    jwt_issuer: str = "bucketreef"
    ui_jwt_audience: str = "bucketreef-ui"
    api_jwt_audience: str = "bucketreef-api"
    pre_auth_jwt_audience: str = "bucketreef-pre-auth"
    access_token_expire_minutes: int = Field(5, ge=1, le=15)
    refresh_token_expire_minutes: int = Field(60 * 24 * 7, description="Absolute refresh lifetime (minutes)")
    ui_session_idle_minutes: int = Field(60 * 12, ge=5)
    ui_session_absolute_minutes: int = Field(60 * 24 * 7, ge=5)
    s3_session_idle_minutes: int = Field(30, ge=5)
    s3_session_absolute_minutes: int = Field(60 * 8, ge=5)
    pre_auth_expire_minutes: int = Field(5, ge=1, le=10)
    mfa_recent_minutes: int = Field(15, ge=1, le=60)
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
        30,
        description="Default API token expiry (days)",
    )
    api_token_max_expire_days: int = Field(
        90,
        description="Maximum API token expiry (days)",
    )
    refresh_token_cookie_name: str = Field("refresh_token", description="Cookie name for refresh token")
    access_token_cookie_name: str = Field("ui_access", description="Cookie name for UI access token")
    csrf_cookie_name: str = Field("csrf_token", description="Readable CSRF cookie name")
    pre_auth_cookie_name: str = Field("pre_auth", description="Cookie name for pre-authentication")
    refresh_token_cookie_path: str = Field("/api/auth", description="Cookie path for refresh token")
    refresh_token_cookie_domain: Optional[str] = Field(None, description="Cookie domain for refresh token")
    refresh_token_cookie_secure: bool = Field(False, description="Secure flag for refresh cookie")
    refresh_token_cookie_samesite: str = Field("lax", description="SameSite policy for refresh cookie")
    public_origin: str = Field("http://localhost:5173", description="Canonical browser origin")
    allowed_hosts: list[str] = Field(default_factory=lambda: ["localhost", "127.0.0.1", "testserver"])
    trusted_proxy_cidrs: list[str] = Field(default_factory=list)
    require_registered_s3_login_endpoints: bool = False
    webauthn_rp_id: str = "localhost"
    webauthn_rp_name: str = "BucketReef"
    webauthn_origin: str = "http://localhost:5173"
    content_security_policy: str = (
        "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; "
        "img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self'; "
        "connect-src 'self'"
    )

    database_url: str = Field(
        _default_sqlite_database_url(),
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
    storage_interactive_connect_timeout_seconds: float = Field(
        2.0,
        gt=0,
        description="Connection timeout for interactive S3-compatible API calls",
    )
    storage_interactive_read_timeout_seconds: float = Field(
        5.0,
        gt=0,
        description="Socket read timeout for interactive S3-compatible API calls",
    )
    storage_interactive_max_attempts: int = Field(
        2,
        ge=1,
        le=5,
        description="Maximum attempts for interactive S3-compatible API calls",
    )
    storage_long_running_read_timeout_seconds: float = Field(
        60.0,
        gt=0,
        description="Socket read timeout for long-running S3-compatible API calls",
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
    rgw_admin_probe_timeout_seconds: float = Field(
        3.0,
        gt=0,
        description="HTTP timeout for explicit RGW Admin availability probes",
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

    cors_origins: list[str] = Field(default_factory=lambda: ["http://localhost:5173"])
    oidc_providers: dict[str, OIDCProviderSettings] = Field(default_factory=dict)
    oidc_state_ttl_seconds: int = Field(600, description="Validity of OIDC login state (seconds)")
    ldap_providers: dict[str, LDAPProviderSettings] = Field(default_factory=dict)

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
    feature_storage_ops_enabled: Optional[bool] = Field(
        None,
        description="Force Storage Ops feature on/off (FEATURE_STORAGE_OPS_ENABLED)",
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
    backend_replicas: int = Field(
        1,
        ge=1,
        description="Expected number of backend replicas for startup safety warnings (BACKEND_REPLICAS)",
    )
    operation_lease_ttl_seconds: int = Field(
        1800,
        ge=15,
        description="Default backend operation lease TTL in seconds (OPERATION_LEASE_TTL_SECONDS)",
    )
    billing_operation_lease_ttl_seconds: int = Field(
        7200,
        ge=60,
        description="Billing collection operation lease TTL in seconds (BILLING_OPERATION_LEASE_TTL_SECONDS)",
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

    @field_validator("database_url", mode="before")
    @classmethod
    def normalize_database_url(cls, value):
        return _normalize_sqlite_database_url(value)

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

    @field_validator("ldap_providers")
    @classmethod
    def normalize_ldap_provider_ids(cls, value):
        normalized = {}
        for key, provider in (value or {}).items():
            provider_id = str(key or "").strip().lower()
            if not provider_id or not LDAP_PROVIDER_ID_PATTERN.fullmatch(provider_id):
                raise ValueError("LDAP provider keys must match [a-z0-9_-]+")
            if provider_id in normalized:
                raise ValueError(f"Duplicate LDAP provider key after normalization: {provider_id}")
            normalized[provider_id] = provider
        return normalized

    @field_validator("log_level", mode="before")
    @classmethod
    def normalize_log_level(cls, value):
        text = str(value or "INFO").strip().upper()
        allowed = {"CRITICAL", "ERROR", "WARNING", "INFO", "DEBUG"}
        if text not in allowed:
            raise ValueError(f"log_level must be one of: {', '.join(sorted(allowed))}")
        return text

    @model_validator(mode="after")
    def validate_settings(self):
        if not self.jwt_keys:
            raise ValueError("jwt_keys must contain at least one key")
        if not self.credential_keys:
            raise ValueError("credential_keys must contain at least one key")
        if self.api_token_default_expire_days < 1:
            raise ValueError("api_token_default_expire_days must be >= 1")
        if self.api_token_max_expire_days < 1:
            raise ValueError("api_token_max_expire_days must be >= 1")
        if self.api_token_default_expire_days > self.api_token_max_expire_days:
            raise ValueError("api_token_default_expire_days must be <= api_token_max_expire_days")
        if self.ui_session_idle_minutes > self.ui_session_absolute_minutes:
            raise ValueError("ui_session_idle_minutes must be <= ui_session_absolute_minutes")
        if self.s3_session_idle_minutes > self.s3_session_absolute_minutes:
            raise ValueError("s3_session_idle_minutes must be <= s3_session_absolute_minutes")
        for value in self.trusted_proxy_cidrs:
            try:
                ipaddress.ip_network(value, strict=False)
            except ValueError as exc:
                raise ValueError(f"Invalid trusted proxy CIDR: {value}") from exc
        if self.app_env == "production":
            self._validate_production_security()
        return self

    def effective_ui_jwt_keys(self) -> list[str]:
        return list(self.ui_jwt_keys or self.jwt_keys)

    def effective_api_jwt_keys(self) -> list[str]:
        return list(self.api_jwt_keys or self.jwt_keys)

    def _validate_production_origins(self) -> ParseResult:
        public = urlparse(self.public_origin)
        if public.scheme != "https" or not public.hostname or public.path not in {"", "/"}:
            raise ValueError("PUBLIC_ORIGIN must be an HTTPS origin without a path in production")
        webauthn = urlparse(self.webauthn_origin)
        if self.webauthn_origin.rstrip("/") != self.public_origin.rstrip("/"):
            raise ValueError("WEBAUTHN_ORIGIN must exactly match PUBLIC_ORIGIN in production")
        if webauthn.hostname != self.webauthn_rp_id:
            raise ValueError("WEBAUTHN_RP_ID must match the WebAuthn origin host in production")
        return public

    def _validate_production_authentication_boundary(self) -> None:
        if not self.refresh_token_cookie_secure:
            raise ValueError("Secure authentication cookies are mandatory in production")
        if self.refresh_token_cookie_domain is not None:
            raise ValueError("Authentication cookies must remain host-only in production")
        if self.refresh_token_cookie_samesite.lower() != "lax":
            raise ValueError("Authentication cookies must use SameSite=Lax in production")
        if not self.require_registered_s3_login_endpoints:
            raise ValueError("Production requires administratively registered S3 login endpoints")

    def _validate_production_network_boundary(self, public: ParseResult) -> None:
        if not self.allowed_hosts or any(host.strip() == "*" for host in self.allowed_hosts):
            raise ValueError("Explicit ALLOWED_HOSTS are mandatory in production")
        if public.hostname not in {host.strip().lower() for host in self.allowed_hosts}:
            raise ValueError("ALLOWED_HOSTS must include the PUBLIC_ORIGIN host in production")
        if self.cors_origins != [self.public_origin]:
            raise ValueError("CORS_ORIGINS must contain only PUBLIC_ORIGIN in production")
        for cidr in self.trusted_proxy_cidrs:
            network = ipaddress.ip_network(cidr, strict=False)
            if network.prefixlen == 0:
                raise ValueError("TRUSTED_PROXY_CIDRS cannot trust the entire address space in production")

    def _validate_production_keyrings(self) -> None:
        key_sets = {
            "UI_JWT_KEYS": self.ui_jwt_keys,
            "API_JWT_KEYS": self.api_jwt_keys,
            "CREDENTIAL_KEYS": self.credential_keys,
        }
        for name, values in key_sets.items():
            if not values or any(is_weak_secret_value(value) for value in values):
                raise ValueError(f"{name} must contain strong non-default keys in production")
        if set(self.ui_jwt_keys) & set(self.api_jwt_keys):
            raise ValueError("UI and API JWT key rings must be distinct in production")

    def _validate_production_seed_configuration(self) -> None:
        seed_endpoint_configured = "seed_s3_endpoint" in self.model_fields_set
        seed_endpoint = urlparse(self.seed_s3_endpoint)
        if seed_endpoint_configured and (seed_endpoint.scheme != "https" or not seed_endpoint.hostname):
            raise ValueError("SEED_S3_ENDPOINT must use HTTPS in production")
        production_secrets = {
            "SEED_S3_SECRET_KEY": self.seed_s3_secret_key if seed_endpoint_configured else None,
            "SEED_RGW_ADMIN_SECRET_KEY": self.seed_rgw_admin_secret_key,
            "SEED_SUPERVISION_SECRET_KEY": self.seed_supervision_secret_key,
            "SEED_CEPH_ADMIN_SECRET_KEY": self.seed_ceph_admin_secret_key,
            "INTERNAL_CRON_TOKEN": self.internal_cron_token,
        }
        for name, value in production_secrets.items():
            if value is not None and is_weak_secret_value(value):
                raise ValueError(f"{name} must be a strong non-default secret in production")

    def _validate_production_oidc(self, public: ParseResult) -> None:
        for provider_id, provider in self.oidc_providers.items():
            if not provider.enabled:
                continue
            if not provider.use_pkce or not provider.use_nonce:
                raise ValueError(f"OIDC provider {provider_id} must require PKCE and nonce")
            if urlparse(provider.discovery_url).scheme != "https":
                raise ValueError(f"OIDC provider {provider_id} discovery URL must use HTTPS")
            redirect = urlparse(provider.redirect_uri)
            if redirect.scheme != "https" or redirect.netloc != public.netloc:
                raise ValueError(f"OIDC provider {provider_id} redirect must use PUBLIC_ORIGIN")

    def _validate_production_ldap(self) -> None:
        for provider_id, provider in self.ldap_providers.items():
            if not provider.enabled:
                continue
            ldap_scheme = urlparse(provider.url).scheme
            encrypted_transport = ldap_scheme == "ldaps" or (ldap_scheme == "ldap" and provider.start_tls)
            if (
                not encrypted_transport
                or provider.allow_insecure
                or not provider.tls_verify
                or provider.allow_legacy_tls
            ):
                raise ValueError(f"LDAP provider {provider_id} violates the production TLS policy")

    def _validate_production_security(self) -> None:
        public = self._validate_production_origins()
        self._validate_production_authentication_boundary()
        self._validate_production_network_boundary(public)
        self._validate_production_keyrings()
        self._validate_production_seed_configuration()
        self._validate_production_oidc(public)
        self._validate_production_ldap()


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
            "Weak/default JWT key detected (JWT_KEYS). "
            "Use high-entropy values with at least 32 characters."
        )
    weak_credential = [key for key in settings.credential_keys if is_weak_secret_value(key)]
    if weak_credential:
        warnings.append(
            "Weak/default credential encryption key detected (CREDENTIAL_KEYS). "
            "Use high-entropy values with at least 32 characters."
        )
    ldap_providers = getattr(settings, "ldap_providers", {}) or {}
    insecure_ldap = [
        key
        for key, provider in ldap_providers.items()
        if getattr(provider, "enabled", False) and getattr(provider, "allow_insecure", False)
    ]
    if insecure_ldap:
        warnings.append(
            "LDAP provider(s) allow insecure ldap:// bind without START_TLS: "
            f"{', '.join(sorted(insecure_ldap))}. Use LDAPS or START_TLS in production."
        )
    tls_unverified_ldap = [
        key
        for key, provider in ldap_providers.items()
        if getattr(provider, "enabled", False) and not getattr(provider, "tls_verify", True)
    ]
    if tls_unverified_ldap:
        warnings.append(
            "LDAP provider(s) disable TLS certificate verification: "
            f"{', '.join(sorted(tls_unverified_ldap))}. This should be limited to isolated labs."
        )
    legacy_tls_ldap = [
        key
        for key, provider in ldap_providers.items()
        if getattr(provider, "enabled", False) and getattr(provider, "allow_legacy_tls", False)
    ]
    if legacy_tls_ldap:
        warnings.append(
            "LDAP provider(s) allow legacy TLS cipher compatibility: "
            f"{', '.join(sorted(legacy_tls_ldap))}. Prefer modern ECDHE cipher suites on the LDAP server."
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


def has_wildcard_cors_origin(origins: list[str]) -> bool:
    return any(str(origin or "").strip() == "*" for origin in (origins or []))


@lru_cache
def get_settings() -> Settings:
    return Settings()
