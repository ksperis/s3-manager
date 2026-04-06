#!/usr/bin/env python3
# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import json
import os
import secrets
import subprocess
import sys
import time
from pathlib import Path

import requests


BACKEND_HOST = "127.0.0.1"
BACKEND_PORT = 8000
BACKEND_BASE_URL = f"http://{BACKEND_HOST}:{BACKEND_PORT}/api"
HEALTH_URL = f"http://{BACKEND_HOST}:{BACKEND_PORT}/health"
BACKEND_BOOT_TIMEOUT_SECONDS = 90.0


def _env_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "t", "yes", "y", "on"}


def _env_str(name: str, default: str | None = None) -> str | None:
    value = os.getenv(name)
    if value is None:
        return default
    cleaned = value.strip()
    return cleaned or default


def _require_env(name: str) -> str:
    value = _env_str(name)
    if value is None:
        raise RuntimeError(
            f"Missing required environment variable {name}. "
            "This CI runner starts a backend against the lab RGW endpoint and needs explicit lab credentials."
        )
    return value


def _generate_secret() -> str:
    return secrets.token_urlsafe(48)


def _build_endpoint_payload() -> str:
    s3_endpoint = _require_env("CEPH_TEST_LAB_S3_ENDPOINT")
    admin_endpoint = _require_env("CEPH_TEST_RGW_ADMIN_ENDPOINT")
    region = _env_str("CEPH_TEST_RGW_REGION", "us-east-1") or "us-east-1"
    verify_tls = _env_bool("CEPH_TEST_LAB_VERIFY_TLS", True)

    payload = [
        {
            "name": "Lab Ceph",
            "endpoint_url": s3_endpoint,
            "region": region,
            "verify_tls": verify_tls,
            "provider": "ceph",
            "admin_access_key": _require_env("CEPH_TEST_RGW_ADMIN_ACCESS_KEY"),
            "admin_secret_key": _require_env("CEPH_TEST_RGW_ADMIN_SECRET_KEY"),
            "supervision_access_key": _require_env("CEPH_TEST_SUPERVISION_ACCESS_KEY"),
            "supervision_secret_key": _require_env("CEPH_TEST_SUPERVISION_SECRET_KEY"),
            "ceph_admin_access_key": _require_env("CEPH_TEST_CEPH_ADMIN_ACCESS_KEY"),
            "ceph_admin_secret_key": _require_env("CEPH_TEST_CEPH_ADMIN_SECRET_KEY"),
            "features": {
                "admin": {"enabled": True, "endpoint": admin_endpoint},
                "account": {"enabled": True, "endpoint": admin_endpoint},
                "sts": {"enabled": True, "endpoint": s3_endpoint},
                "usage": {"enabled": True},
                "metrics": {"enabled": True},
                "static_website": {"enabled": True},
                "iam": {"enabled": True},
                "sns": {"enabled": True},
                "sse": {"enabled": True},
                "healthcheck": {"enabled": True, "mode": "s3"},
            },
            "is_default": True,
        }
    ]
    return json.dumps(payload)


def _prepare_environment(backend_root: Path) -> dict[str, str]:
    env = os.environ.copy()

    # CI should not rely on a repo-local .env file or partially injected nested OIDC variables.
    if env.get("CI"):
        env_file = backend_root / ".env"
        if env_file.exists():
            env_file.unlink()

    for key in list(env):
        if key.startswith("OIDC_PROVIDERS__"):
            env.pop(key, None)
    env["OIDC_PROVIDERS"] = "{}"

    for key in (
        "CEPH_TEST_BACKEND_CA_BUNDLE",
        "SEED_S3_ENDPOINT",
        "SEED_S3_ENDPOINT_FEATURES",
        "SEED_S3_ACCESS_KEY",
        "SEED_S3_SECRET_KEY",
        "SEED_S3_REGION",
        "SEED_RGW_ADMIN_ENDPOINT",
        "SEED_RGW_ADMIN_ACCESS_KEY",
        "SEED_RGW_ADMIN_SECRET_KEY",
        "SEED_SUPERVISION_ACCESS_KEY",
        "SEED_SUPERVISION_SECRET_KEY",
        "SEED_CEPH_ADMIN_ACCESS_KEY",
        "SEED_CEPH_ADMIN_SECRET_KEY",
        "ENV_STORAGE_ENDPOINTS",
    ):
        env.pop(key, None)

    runtime_dir = backend_root / ".ci-runtime"
    runtime_dir.mkdir(exist_ok=True)
    database_path = runtime_dir / "ceph-functional-ci.db"
    for suffix in ("", "-shm", "-wal"):
        candidate = Path(f"{database_path}{suffix}")
        if candidate.exists():
            candidate.unlink()

    super_admin_email = _env_str("SEED_SUPER_ADMIN_EMAIL", "ci-ceph-functional-admin@example.com")
    super_admin_password = _env_str("SEED_SUPER_ADMIN_PASSWORD", _generate_secret())
    rgw_region = _env_str("CEPH_TEST_RGW_REGION", "us-east-1") or "us-east-1"
    rgw_verify_tls = _env_bool("CEPH_TEST_RGW_VERIFY_TLS", _env_bool("CEPH_TEST_LAB_VERIFY_TLS", True))

    env["DATABASE_URL"] = f"sqlite:///{database_path.resolve().as_posix()}"
    env["FERNET_KEY"] = _env_str("FERNET_KEY", _generate_secret()) or _generate_secret()
    env["JWT_KEYS"] = _env_str("JWT_KEYS", json.dumps([_generate_secret()])) or json.dumps([_generate_secret()])
    env["CREDENTIAL_KEY"] = _env_str("CREDENTIAL_KEY", _generate_secret()) or _generate_secret()
    env["SEED_SUPER_ADMIN_EMAIL"] = super_admin_email or "ci-ceph-functional-admin@example.com"
    env["SEED_SUPER_ADMIN_PASSWORD"] = super_admin_password or _generate_secret()
    env["SEED_SUPER_ADMIN_FULL_NAME"] = _env_str("SEED_SUPER_ADMIN_FULL_NAME", "Ceph Functional CI Admin") or (
        "Ceph Functional CI Admin"
    )
    env["SEED_SUPER_ADMIN_MODE"] = "if_empty"
    env["ENV_STORAGE_ENDPOINTS"] = _build_endpoint_payload()

    env["FEATURE_MANAGER_ENABLED"] = "true"
    env["FEATURE_BROWSER_ENABLED"] = "true"
    env["FEATURE_CEPH_ADMIN_ENABLED"] = "true"
    env["FEATURE_STORAGE_OPS_ENABLED"] = "true"
    env["BUCKET_MIGRATION_WORKER_ENABLED"] = "true"

    env["CEPH_TEST_BACKEND_BASE_URL"] = BACKEND_BASE_URL
    env["CEPH_TEST_SUPERADMIN_EMAIL"] = env["SEED_SUPER_ADMIN_EMAIL"]
    env["CEPH_TEST_SUPERADMIN_PASSWORD"] = env["SEED_SUPER_ADMIN_PASSWORD"]
    env["CEPH_TEST_VERIFY_TLS"] = "false"
    env["CEPH_TEST_RGW_ADMIN_ENDPOINT"] = _require_env("CEPH_TEST_RGW_ADMIN_ENDPOINT")
    env["CEPH_TEST_RGW_ADMIN_ACCESS_KEY"] = _require_env("CEPH_TEST_RGW_ADMIN_ACCESS_KEY")
    env["CEPH_TEST_RGW_ADMIN_SECRET_KEY"] = _require_env("CEPH_TEST_RGW_ADMIN_SECRET_KEY")
    env["CEPH_TEST_RGW_REGION"] = rgw_region
    env["CEPH_TEST_RGW_VERIFY_TLS"] = "true" if rgw_verify_tls else "false"
    env["PYTHONUNBUFFERED"] = "1"

    pythonpath = env.get("PYTHONPATH", "")
    backend_root_str = str(backend_root)
    if pythonpath:
        env["PYTHONPATH"] = f"{backend_root_str}:{pythonpath}"
    else:
        env["PYTHONPATH"] = backend_root_str

    return env


def _tail_log(path: Path, limit: int = 40) -> str:
    if not path.exists():
        return "(backend log file missing)"
    lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    tail = lines[-limit:]
    return "\n".join(tail) if tail else "(backend log file empty)"


def _wait_for_backend(backend: subprocess.Popen[str], health_url: str, timeout_seconds: float, log_path: Path) -> None:
    deadline = time.monotonic() + timeout_seconds
    last_error: str | None = None
    while time.monotonic() < deadline:
        exit_code = backend.poll()
        if exit_code is not None:
            raise RuntimeError(
                "Backend exited before becoming healthy.\n"
                f"Exit code: {exit_code}\n"
                f"Backend log tail:\n{_tail_log(log_path)}"
            )
        try:
            response = requests.get(health_url, timeout=5.0)
            if response.status_code < 400:
                return
            last_error = f"{response.status_code}: {response.text[:200]}"
        except requests.RequestException as exc:
            last_error = str(exc)
        time.sleep(1.0)

    raise RuntimeError(
        "Backend did not become healthy before timeout.\n"
        f"Health URL: {health_url}\n"
        f"Last error: {last_error or 'unknown'}\n"
        f"Backend log tail:\n{_tail_log(log_path)}"
    )


def _run_tests(backend_root: Path, env: dict[str, str], argv: list[str]) -> int:
    cmd = [sys.executable, str(backend_root / "tests_ceph_functional" / "run.py")]
    if len(argv) > 1:
        cmd.extend(argv[1:])
    process = subprocess.run(cmd, cwd=backend_root, env=env, check=False)
    return process.returncode


def main(argv: list[str]) -> int:
    backend_root = Path(__file__).resolve().parents[1]
    reports_dir = backend_root.parent / "gl-test-reports"
    reports_dir.mkdir(exist_ok=True)
    backend_log_path = reports_dir / "ceph-functional-backend.log"

    env = _prepare_environment(backend_root)

    with backend_log_path.open("w", encoding="utf-8") as log_file:
        backend = subprocess.Popen(
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
            stdout=log_file,
            stderr=subprocess.STDOUT,
            text=True,
        )
        try:
            _wait_for_backend(backend, HEALTH_URL, BACKEND_BOOT_TIMEOUT_SECONDS, backend_log_path)
            return _run_tests(backend_root, env, argv)
        finally:
            if backend.poll() is None:
                backend.terminate()
                try:
                    backend.wait(timeout=15)
                except subprocess.TimeoutExpired:
                    backend.kill()
                    backend.wait(timeout=10)


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv))
    except Exception as exc:  # noqa: BLE001
        print(str(exc), file=sys.stderr)
        sys.exit(1)
