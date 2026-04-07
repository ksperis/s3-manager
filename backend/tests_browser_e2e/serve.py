#!/usr/bin/env python3
# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import json
import os
import secrets
import sys
from pathlib import Path


BACKEND_HOST = "127.0.0.1"
BACKEND_PORT = 8000
FRONTEND_ORIGINS = ["http://127.0.0.1:4173", "http://localhost:4173"]


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
            "bucket_compare_enabled": False,
            "manager_ceph_s3_user_keys_enabled": False,
            "allow_ui_user_bucket_migration": False,
            "allow_login_access_keys": False,
            "allow_login_endpoint_list": False,
            "allow_login_custom_endpoint": False,
            "allow_user_private_connections": False,
        },
        "browser": {
            "allow_proxy_transfers": True,
        },
    }
    return json.dumps(payload)


def _prepare_environment(backend_root: Path) -> dict[str, str]:
    env = os.environ.copy()
    for key in list(env):
        if key.startswith("OIDC_PROVIDERS__"):
            env.pop(key, None)

    runtime_dir = backend_root / ".browser-e2e-runtime"
    runtime_dir.mkdir(exist_ok=True)
    database_path = runtime_dir / "browser-e2e.db"
    app_settings_path = runtime_dir / "app_settings.json"
    for suffix in ("", "-shm", "-wal"):
        candidate = Path(f"{database_path}{suffix}")
        if candidate.exists():
            candidate.unlink()
    if app_settings_path.exists():
        app_settings_path.unlink()

    e2e_s3_endpoint = _env_str("E2E_S3_ENDPOINT", "http://localhost:5000") or "http://localhost:5000"
    e2e_s3_access_key = _env_str("E2E_S3_ACCESS_KEY", "minio") or "minio"
    e2e_s3_secret_key = _env_str("E2E_S3_SECRET_KEY", "minio123") or "minio123"
    e2e_s3_region = _env_str("E2E_S3_REGION", "us-east-1") or "us-east-1"

    env["DATABASE_URL"] = f"sqlite:///{database_path.resolve().as_posix()}"
    env["APP_SETTINGS_PATH"] = app_settings_path.resolve().as_posix()
    env["FERNET_KEY"] = _env_str("FERNET_KEY", _generate_secret()) or _generate_secret()
    env["JWT_KEYS"] = _env_str("JWT_KEYS", json.dumps([_generate_secret()])) or json.dumps([_generate_secret()])
    env["CREDENTIAL_KEY"] = _env_str("CREDENTIAL_KEY", _generate_secret()) or _generate_secret()

    env["SEED_SUPER_ADMIN_EMAIL"] = _env_str(
        "SEED_SUPER_ADMIN_EMAIL",
        "browser-e2e-admin@example.com",
    ) or "browser-e2e-admin@example.com"
    env["SEED_SUPER_ADMIN_PASSWORD"] = _env_str(
        "SEED_SUPER_ADMIN_PASSWORD",
        "browser-e2e-admin-password",
    ) or "browser-e2e-admin-password"
    env["SEED_SUPER_ADMIN_FULL_NAME"] = _env_str(
        "SEED_SUPER_ADMIN_FULL_NAME",
        "Browser E2E Admin",
    ) or "Browser E2E Admin"
    env["SEED_SUPER_ADMIN_MODE"] = "if_empty"

    env["SEED_S3_ENDPOINT"] = e2e_s3_endpoint
    env["SEED_S3_ACCESS_KEY"] = e2e_s3_access_key
    env["SEED_S3_SECRET_KEY"] = e2e_s3_secret_key
    env["SEED_S3_REGION"] = e2e_s3_region
    env["OIDC_PROVIDERS"] = "{}"
    env["CORS_ORIGINS"] = json.dumps(FRONTEND_ORIGINS)
    env["BUCKET_MIGRATION_WORKER_ENABLED"] = "false"
    env["PYTHONUNBUFFERED"] = "1"

    app_settings_path.write_text(_build_app_settings_payload(), encoding="utf-8")

    pythonpath = env.get("PYTHONPATH", "")
    backend_root_str = str(backend_root)
    env["PYTHONPATH"] = f"{backend_root_str}:{pythonpath}" if pythonpath else backend_root_str
    return env


def main() -> int:
    backend_root = Path(__file__).resolve().parents[1]
    env = _prepare_environment(backend_root)
    os.execvpe(
        sys.executable,
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
        env,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
