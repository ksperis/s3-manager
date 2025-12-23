# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import os
from dataclasses import dataclass
from urllib.parse import urljoin


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

    @property
    def health_url(self) -> str:
        return urljoin(self.backend_base_url.rstrip("/") + "/", "../health")


def load_settings() -> CephTestSettings:
    base_url = os.getenv("CEPH_TEST_BACKEND_BASE_URL", "http://localhost:8000/api").rstrip("/")
    super_admin_email = os.getenv("CEPH_TEST_SUPERADMIN_EMAIL")
    super_admin_password = os.getenv("CEPH_TEST_SUPERADMIN_PASSWORD")
    if not super_admin_email or not super_admin_password:
        raise RuntimeError(
            "CEPH_TEST_SUPERADMIN_EMAIL and CEPH_TEST_SUPERADMIN_PASSWORD must be set to run the Ceph functional tests."
        )

    return CephTestSettings(
        backend_base_url=base_url,
        super_admin_email=super_admin_email,
        super_admin_password=super_admin_password,
        verify_tls=_env_bool("CEPH_TEST_VERIFY_TLS", False),
        backend_ca_bundle=os.getenv("CEPH_TEST_BACKEND_CA_BUNDLE"),
        request_timeout=_env_float("CEPH_TEST_HTTP_TIMEOUT", 30.0),
        test_prefix=os.getenv("CEPH_TEST_RESOURCE_PREFIX", "ceph-functional").rstrip("/"),
        cleanup_delete_rgw=_env_bool("CEPH_TEST_DELETE_RGW_TENANT", True),
        rgw_admin_endpoint=os.getenv("CEPH_TEST_RGW_ADMIN_ENDPOINT"),
        rgw_admin_access_key=os.getenv("CEPH_TEST_RGW_ADMIN_ACCESS_KEY"),
        rgw_admin_secret_key=os.getenv("CEPH_TEST_RGW_ADMIN_SECRET_KEY"),
        rgw_admin_region=os.getenv("CEPH_TEST_RGW_REGION"),
        rgw_verify_tls=_env_bool("CEPH_TEST_RGW_VERIFY_TLS", False),
        rgw_ca_bundle=os.getenv("CEPH_TEST_RGW_CA_BUNDLE"),
        login_max_retries=_env_int("CEPH_TEST_LOGIN_RETRIES", 5),
        login_retry_delay=_env_float("CEPH_TEST_LOGIN_RETRY_DELAY", 2.0),
    )


__all__ = ["CephTestSettings", "load_settings"]
