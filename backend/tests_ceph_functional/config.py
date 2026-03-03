# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urljoin

try:
    from dotenv import load_dotenv
except ModuleNotFoundError:  # pragma: no cover - optional dependency guard
    load_dotenv = None  # type: ignore[assignment]


def _env_bool(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "t", "yes", "y", "on"}


def _env_float(name: str, default: float) -> float:
    value = os.getenv(name)
    if value is None:
        return default
    try:
        return float(value)
    except ValueError as exc:
        raise ValueError(f"Environment variable {name} must be a float, got '{value}'") from exc


def _env_int(name: str, default: int) -> int:
    value = os.getenv(name)
    if value is None:
        return default
    try:
        return int(value)
    except ValueError as exc:
        raise ValueError(f"Environment variable {name} must be an integer, got '{value}'") from exc


def _env_str(*names: str, default: str | None = None) -> str | None:
    for name in names:
        value = os.getenv(name)
        if value is None:
            continue
        cleaned = value.strip()
        if cleaned:
            return cleaned
    return default


def _load_local_env_files() -> None:
    """Load local .env files so one-shot runs work without manual exports."""

    if load_dotenv is None:
        return
    backend_root = Path(__file__).resolve().parents[1]
    for path in (backend_root / ".env", backend_root.parent / ".env"):
        if path.exists():
            load_dotenv(path, override=False)


@dataclass(frozen=True)
class CephTestSettings:
    """Runtime configuration loaded from the environment."""

    backend_base_url: str
    super_admin_email: str
    super_admin_password: str
    verify_tls: bool
    backend_ca_bundle: str | None
    request_timeout: float
    test_prefix: str
    cleanup_delete_rgw: bool
    rgw_admin_endpoint: str | None
    rgw_admin_access_key: str | None
    rgw_admin_secret_key: str | None
    rgw_admin_region: str | None
    rgw_verify_tls: bool
    rgw_ca_bundle: str | None
    login_max_retries: int
    login_retry_delay: float
    ceph_admin_endpoint_name: str | None
    ceph_admin_require_default_endpoint: bool

    @property
    def health_url(self) -> str:
        return urljoin(self.backend_base_url.rstrip("/") + "/", "../health")


def load_settings() -> CephTestSettings:
    _load_local_env_files()

    base_url = _env_str("CEPH_TEST_BACKEND_BASE_URL", default="http://localhost:8000/api").rstrip("/")
    super_admin_email = _env_str("CEPH_TEST_SUPERADMIN_EMAIL", "SEED_SUPER_ADMIN_EMAIL", default="admin@example.com")
    super_admin_password = _env_str("CEPH_TEST_SUPERADMIN_PASSWORD", "SEED_SUPER_ADMIN_PASSWORD", default="changeme")
    if not super_admin_email or not super_admin_password:
        raise RuntimeError(
            "CEPH_TEST_SUPERADMIN_EMAIL and CEPH_TEST_SUPERADMIN_PASSWORD must be set to run the Ceph functional tests."
        )

    test_prefix = (_env_str("CEPH_TEST_RESOURCE_PREFIX", default="ceph-functional") or "ceph-functional").rstrip("/")
    if not test_prefix:
        test_prefix = "ceph-functional"

    return CephTestSettings(
        backend_base_url=base_url,
        super_admin_email=super_admin_email,
        super_admin_password=super_admin_password,
        verify_tls=_env_bool("CEPH_TEST_VERIFY_TLS", False),
        backend_ca_bundle=_env_str("CEPH_TEST_BACKEND_CA_BUNDLE"),
        request_timeout=_env_float("CEPH_TEST_HTTP_TIMEOUT", 30.0),
        test_prefix=test_prefix,
        cleanup_delete_rgw=_env_bool("CEPH_TEST_DELETE_RGW_TENANT", False),
        rgw_admin_endpoint=_env_str("CEPH_TEST_RGW_ADMIN_ENDPOINT", "SEED_RGW_ADMIN_ENDPOINT", "SEED_S3_ENDPOINT"),
        rgw_admin_access_key=_env_str(
            "CEPH_TEST_RGW_ADMIN_ACCESS_KEY",
            "SEED_RGW_ADMIN_ACCESS_KEY",
            "SEED_CEPH_ADMIN_ACCESS_KEY",
            "SEED_S3_ACCESS_KEY",
        ),
        rgw_admin_secret_key=_env_str(
            "CEPH_TEST_RGW_ADMIN_SECRET_KEY",
            "SEED_RGW_ADMIN_SECRET_KEY",
            "SEED_CEPH_ADMIN_SECRET_KEY",
            "SEED_S3_SECRET_KEY",
        ),
        rgw_admin_region=_env_str("CEPH_TEST_RGW_REGION", "SEED_S3_REGION"),
        rgw_verify_tls=_env_bool("CEPH_TEST_RGW_VERIFY_TLS", False),
        rgw_ca_bundle=_env_str("CEPH_TEST_RGW_CA_BUNDLE"),
        login_max_retries=_env_int("CEPH_TEST_LOGIN_RETRIES", 5),
        login_retry_delay=_env_float("CEPH_TEST_LOGIN_RETRY_DELAY", 2.0),
        ceph_admin_endpoint_name=_env_str("CEPH_TEST_CEPH_ADMIN_ENDPOINT_NAME"),
        ceph_admin_require_default_endpoint=_env_bool("CEPH_TEST_CEPH_ADMIN_REQUIRE_DEFAULT_ENDPOINT", True),
    )


__all__ = ["CephTestSettings", "load_settings"]
