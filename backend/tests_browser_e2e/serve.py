#!/usr/bin/env python3
# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import json
import os
import secrets
import signal
import subprocess
import sys
import time
from pathlib import Path
from urllib.error import URLError
from urllib.request import urlopen


BACKEND_HOST = "127.0.0.1"
BACKEND_PORT = int(os.getenv("E2E_BACKEND_PORT", "8000"))
if not 1 <= BACKEND_PORT <= 65535:
    raise ValueError("E2E_BACKEND_PORT must be between 1 and 65535")
FRONTEND_ORIGINS = ["http://localhost:4173", "http://127.0.0.1:4173"]
BOOTSTRAP_URL_FILENAME = "first-admin-bootstrap-url"


def _env_str(name: str, default: str | None = None) -> str | None:
    value = os.getenv(name)
    if value is None:
        return default
    cleaned = value.strip()
    return cleaned or default


def _generate_secret() -> str:
    return secrets.token_urlsafe(48)


def _build_app_settings_payload() -> str:
    payload = {
        "general": {
            "manager_enabled": False,
            "ceph_admin_enabled": False,
            "storage_ops_enabled": False,
            "browser_enabled": True,
            "browser_root_enabled": True,
            "browser_manager_enabled": False,
            "browser_ceph_admin_enabled": False,
            "billing_enabled": False,
            "endpoint_status_enabled": False,
            "quota_alerts_enabled": False,
            "usage_history_enabled": False,
            "bucket_migration_enabled": False,
            "bucket_compare_enabled": True,
            "bucket_integrity_check_enabled": True,
            "manager_ceph_s3_user_keys_enabled": True,
            "allow_login_access_keys": False,
            "allow_login_endpoint_list": False,
            "allow_login_custom_endpoint": False,
        },
        "browser": {
            "allow_proxy_transfers": True,
        },
    }
    return json.dumps(payload)


def _prepare_environment(backend_root: Path) -> dict[str, str]:
    env = os.environ.copy()
    for key in list(env):
        if key.startswith("OIDC_PROVIDERS__") or key.startswith("LDAP_PROVIDERS__"):
            env.pop(key, None)

    runtime_dir = backend_root / ".browser-e2e-runtime"
    runtime_dir.mkdir(exist_ok=True)
    database_path = runtime_dir / "browser-e2e.db"
    app_settings_path = runtime_dir / "app_settings.json"
    bootstrap_url_path = runtime_dir / BOOTSTRAP_URL_FILENAME
    for suffix in ("", "-shm", "-wal"):
        candidate = Path(f"{database_path}{suffix}")
        if candidate.exists():
            candidate.unlink()
    if app_settings_path.exists():
        app_settings_path.unlink()
    if bootstrap_url_path.exists():
        bootstrap_url_path.unlink()

    e2e_s3_endpoint = _env_str("E2E_S3_ENDPOINT", "http://localhost:5000") or "http://localhost:5000"
    e2e_s3_access_key = _env_str("E2E_S3_ACCESS_KEY", "minio") or "minio"
    e2e_s3_secret_key = _env_str("E2E_S3_SECRET_KEY", "minio123") or "minio123"
    e2e_s3_region = _env_str("E2E_S3_REGION", "us-east-1") or "us-east-1"

    env["DATABASE_URL"] = f"sqlite:///{database_path.resolve().as_posix()}"
    env["APP_SETTINGS_PATH"] = app_settings_path.resolve().as_posix()
    env["JWT_KEYS"] = _env_str("JWT_KEYS", json.dumps([_generate_secret()])) or json.dumps([_generate_secret()])
    env["UI_JWT_KEYS"] = json.dumps([_generate_secret()])
    env["API_JWT_KEYS"] = json.dumps([_generate_secret()])
    env["CREDENTIAL_KEYS"] = _env_str(
        "CREDENTIAL_KEYS",
        json.dumps([_generate_secret()]),
    ) or json.dumps([_generate_secret()])

    env["E2E_ADMIN_EMAIL"] = _env_str(
        "E2E_ADMIN_EMAIL",
        "browser-e2e-admin@example.com",
    ) or "browser-e2e-admin@example.com"
    env["E2E_ADMIN_PASSWORD"] = _env_str(
        "E2E_ADMIN_PASSWORD",
        "browser-e2e-admin-password",
    ) or "browser-e2e-admin-password"
    env["E2E_ADMIN_FULL_NAME"] = _env_str(
        "E2E_ADMIN_FULL_NAME",
        "Browser E2E Admin",
    ) or "Browser E2E Admin"

    env["SEED_S3_ENDPOINT"] = e2e_s3_endpoint
    env["SEED_S3_ACCESS_KEY"] = e2e_s3_access_key
    env["SEED_S3_SECRET_KEY"] = e2e_s3_secret_key
    env["SEED_S3_REGION"] = e2e_s3_region
    env["OIDC_PROVIDERS"] = "{}"
    env["LDAP_PROVIDERS"] = "{}"
    env["CORS_ORIGINS"] = json.dumps(FRONTEND_ORIGINS)
    env["PUBLIC_ORIGIN"] = FRONTEND_ORIGINS[0]
    env["WEBAUTHN_RP_ID"] = "localhost"
    env["WEBAUTHN_ORIGIN"] = FRONTEND_ORIGINS[0]
    env["REFRESH_TOKEN_COOKIE_SECURE"] = "false"
    env["BUCKET_MIGRATION_WORKER_ENABLED"] = "false"
    env["PYTHONUNBUFFERED"] = "1"

    app_settings_path.write_text(_build_app_settings_payload(), encoding="utf-8")

    pythonpath = env.get("PYTHONPATH", "")
    backend_root_str = str(backend_root)
    env["PYTHONPATH"] = f"{backend_root_str}:{pythonpath}" if pythonpath else backend_root_str
    return env


def _wait_for_backend(process: subprocess.Popen[bytes], *, timeout_seconds: float = 120.0) -> None:
    deadline = time.monotonic() + timeout_seconds
    health_url = f"http://{BACKEND_HOST}:{BACKEND_PORT}/health"
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f"Browser E2E backend exited with status {process.returncode}")
        try:
            with urlopen(health_url, timeout=2) as response:  # noqa: S310 - loopback-only test server
                if response.status == 200:
                    return
        except (OSError, URLError):
            pass
        time.sleep(0.25)
    raise RuntimeError("Timed out waiting for the Browser E2E backend health endpoint")


def _issue_bootstrap_url(backend_root: Path, env: dict[str, str]) -> str:
    result = subprocess.run(
        [sys.executable, "-m", "app.scripts.issue_first_admin_bootstrap"],
        cwd=backend_root,
        env=env,
        check=True,
        capture_output=True,
        text=True,
    )
    prefix = "Bootstrap URL: "
    for line in result.stdout.splitlines():
        if line.startswith(prefix):
            return line.removeprefix(prefix).strip()
    raise RuntimeError("Bootstrap issuer did not print a bootstrap URL")


def main() -> int:
    backend_root = Path(__file__).resolve().parents[1]
    env = _prepare_environment(backend_root)
    process = subprocess.Popen(
        [
            sys.executable,
            "-m",
            "uvicorn",
            "app.main:app",
            "--host",
            BACKEND_HOST,
            "--port",
            str(BACKEND_PORT),
        ],
        cwd=backend_root,
        env=env,
    )
    for signum in (signal.SIGINT, signal.SIGTERM):
        signal.signal(signum, lambda received, _frame: process.send_signal(received))
    try:
        _wait_for_backend(process)
        bootstrap_url = _issue_bootstrap_url(backend_root, env)
        bootstrap_url_path = backend_root / ".browser-e2e-runtime" / BOOTSTRAP_URL_FILENAME
        bootstrap_url_path.write_text(f"{bootstrap_url}\n", encoding="utf-8")
        bootstrap_url_path.chmod(0o600)
        return process.wait()
    finally:
        if process.poll() is None:
            process.terminate()
            process.wait(timeout=10)


if __name__ == "__main__":
    raise SystemExit(main())
