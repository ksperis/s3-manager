#!/usr/bin/env python3
# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import json
import os
import secrets
import socket
import subprocess
import sys
import time
from pathlib import Path
from urllib.parse import urlsplit

import requests

try:
    from dotenv import dotenv_values
except ModuleNotFoundError:  # pragma: no cover - optional dependency guard
    dotenv_values = None  # type: ignore[assignment]


BACKEND_HOST = "127.0.0.1"
DEFAULT_BACKEND_PORT = 8000
BACKEND_BOOT_TIMEOUT_SECONDS = 90.0


def _env_bool(name: str, default: bool, source: dict[str, str] | None = None) -> bool:
    value = (source or os.environ).get(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "t", "yes", "y", "on"}


def _env_str(name: str, default: str | None = None, source: dict[str, str] | None = None) -> str | None:
    value = (source or os.environ).get(name)
    if value is None:
        return default
    cleaned = value.strip()
    return cleaned or default


def _require_env(name: str, source: dict[str, str] | None = None) -> str:
    value = _env_str(name, source=source)
    if value is None:
        raise RuntimeError(
            f"Missing required environment variable {name}. "
            "This CI runner starts a backend against the lab RGW endpoint and needs explicit lab credentials."
        )
    return value


def _origin_from_url(url: str) -> str:
    parsed = urlsplit(url)
    if not parsed.scheme or not parsed.netloc:
        raise RuntimeError(f"Unable to derive request origin from '{url}'")
    return f"{parsed.scheme}://{parsed.netloc}"


def _generate_secret() -> str:
    return secrets.token_urlsafe(48)


def _port_available(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        return probe.connect_ex((BACKEND_HOST, port)) != 0


def _find_available_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.bind((BACKEND_HOST, 0))
        return int(probe.getsockname()[1])


def _select_backend_port() -> int:
    configured = _env_str("CEPH_TEST_BACKEND_PORT")
    if configured:
        try:
            port = int(configured)
        except ValueError as exc:
            raise RuntimeError(f"CEPH_TEST_BACKEND_PORT must be an integer, got '{configured}'") from exc
        if port <= 0:
            raise RuntimeError(f"CEPH_TEST_BACKEND_PORT must be positive, got '{configured}'")
        return port
    if _port_available(DEFAULT_BACKEND_PORT):
        return DEFAULT_BACKEND_PORT
    return _find_available_port()


def _load_local_env_defaults(env: dict[str, str], backend_root: Path) -> None:
    if dotenv_values is None:
        return
    for path in (backend_root / ".env", backend_root.parent / ".env"):
        if not path.exists():
            continue
        for key, value in dotenv_values(path).items():
            if value is not None and key not in env:
                env[key] = value


def _storage_endpoint_entries(env: dict[str, str]) -> list[dict[str, object]]:
    raw = _env_str("ENV_STORAGE_ENDPOINTS", source=env)
    if not raw:
        return []
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        return []
    if not isinstance(payload, list):
        return []
    return [entry for entry in payload if isinstance(entry, dict)]


def _storage_feature_enabled(entry: dict[str, object], feature_name: str) -> bool:
    features = entry.get("features")
    if not isinstance(features, dict):
        return False
    feature = features.get(feature_name)
    return isinstance(feature, dict) and bool(feature.get("enabled"))


def _storage_feature_endpoint(entry: dict[str, object], feature_name: str) -> str | None:
    features = entry.get("features")
    if not isinstance(features, dict):
        return None
    feature = features.get(feature_name)
    if not isinstance(feature, dict):
        return None
    endpoint = feature.get("endpoint")
    return endpoint.strip() if isinstance(endpoint, str) and endpoint.strip() else None


def _select_storage_endpoint(entries: list[dict[str, object]]) -> dict[str, object] | None:
    if not entries:
        return None
    return (
        next((entry for entry in entries if bool(entry.get("is_default")) and _storage_feature_enabled(entry, "sns")), None)
        or next((entry for entry in entries if _storage_feature_enabled(entry, "sns")), None)
        or next((entry for entry in entries if bool(entry.get("is_default"))), None)
        or entries[0]
    )


def _derive_ceph_test_env_from_storage_endpoints(env: dict[str, str]) -> None:
    selected = _select_storage_endpoint(_storage_endpoint_entries(env))
    if not selected:
        return

    def _entry_str(key: str) -> str | None:
        value = selected.get(key)
        return value.strip() if isinstance(value, str) and value.strip() else None

    def _setdefault(name: str, value: object | None) -> None:
        if name in env or value is None:
            return
        text = str(value).strip()
        if text:
            env[name] = text

    endpoint_url = _entry_str("endpoint_url")
    admin_endpoint = (
        _storage_feature_endpoint(selected, "admin")
        or _storage_feature_endpoint(selected, "account")
        or _entry_str("admin_endpoint")
        or _entry_str("admin_endpoint_url")
        or endpoint_url
    )

    _setdefault("CEPH_TEST_LAB_S3_ENDPOINT", endpoint_url)
    _setdefault("CEPH_TEST_RGW_ADMIN_ENDPOINT", admin_endpoint)
    _setdefault("CEPH_TEST_RGW_REGION", _entry_str("region"))
    _setdefault("CEPH_TEST_RGW_ADMIN_ACCESS_KEY", _entry_str("admin_access_key"))
    _setdefault("CEPH_TEST_RGW_ADMIN_SECRET_KEY", _entry_str("admin_secret_key"))
    _setdefault("CEPH_TEST_SUPERVISION_ACCESS_KEY", _entry_str("supervision_access_key") or _entry_str("admin_access_key"))
    _setdefault("CEPH_TEST_SUPERVISION_SECRET_KEY", _entry_str("supervision_secret_key") or _entry_str("admin_secret_key"))
    _setdefault("CEPH_TEST_CEPH_ADMIN_ACCESS_KEY", _entry_str("ceph_admin_access_key") or _entry_str("admin_access_key"))
    _setdefault("CEPH_TEST_CEPH_ADMIN_SECRET_KEY", _entry_str("ceph_admin_secret_key") or _entry_str("admin_secret_key"))
    if "CEPH_TEST_LAB_VERIFY_TLS" not in env and "verify_tls" in selected:
        env["CEPH_TEST_LAB_VERIFY_TLS"] = "true" if bool(selected.get("verify_tls")) else "false"
    if "CEPH_TEST_RGW_VERIFY_TLS" not in env and "verify_tls" in selected:
        env["CEPH_TEST_RGW_VERIFY_TLS"] = "true" if bool(selected.get("verify_tls")) else "false"


def _build_endpoint_payload(source: dict[str, str] | None = None) -> str:
    env = source or os.environ
    existing_payload = _env_str("ENV_STORAGE_ENDPOINTS", source=env)
    if existing_payload and not _env_str("CEPH_TEST_LAB_S3_ENDPOINT", source=env):
        return existing_payload

    s3_endpoint = _require_env("CEPH_TEST_LAB_S3_ENDPOINT", source=env)
    s3_endpoint_z2 = _env_str("CEPH_TEST_LAB_S3_ENDPOINT_Z2", source=env)
    admin_endpoint = _require_env("CEPH_TEST_RGW_ADMIN_ENDPOINT", source=env)
    region = _env_str("CEPH_TEST_RGW_REGION", "us-east-1", source=env) or "us-east-1"
    verify_tls = _env_bool("CEPH_TEST_LAB_VERIFY_TLS", True, source=env)

    common_credentials = {
        "admin_access_key": _require_env("CEPH_TEST_RGW_ADMIN_ACCESS_KEY", source=env),
        "admin_secret_key": _require_env("CEPH_TEST_RGW_ADMIN_SECRET_KEY", source=env),
        "supervision_access_key": _require_env("CEPH_TEST_SUPERVISION_ACCESS_KEY", source=env),
        "supervision_secret_key": _require_env("CEPH_TEST_SUPERVISION_SECRET_KEY", source=env),
        "ceph_admin_access_key": _require_env("CEPH_TEST_CEPH_ADMIN_ACCESS_KEY", source=env),
        "ceph_admin_secret_key": _require_env("CEPH_TEST_CEPH_ADMIN_SECRET_KEY", source=env),
    }

    def _entry(name: str, endpoint_url: str, *, is_default: bool) -> dict[str, object]:
        return {
            "name": name,
            "endpoint_url": endpoint_url,
            "region": region,
            "verify_tls": verify_tls,
            "provider": "ceph",
            **common_credentials,
            "features": {
                "admin": {"enabled": True, "endpoint": admin_endpoint},
                "account": {"enabled": True, "endpoint": admin_endpoint},
                "sts": {"enabled": True, "endpoint": endpoint_url},
                "usage": {"enabled": True},
                "metrics": {"enabled": True},
                "static_website": {"enabled": True},
                "iam": {"enabled": True},
                "sns": {"enabled": True},
                "replication": {"enabled": True},
                "sse": {"enabled": True},
                "healthcheck": {"enabled": True, "mode": "s3"},
            },
            "is_default": is_default,
        }

    if s3_endpoint_z2:
        payload = [
            _entry("s3-z1", s3_endpoint, is_default=True),
            _entry("s3-z2", s3_endpoint_z2, is_default=False),
        ]
    else:
        payload = [_entry("Lab Ceph", s3_endpoint, is_default=True)]
    return json.dumps(payload)


def _build_app_settings_payload() -> str:
    payload = {
        "general": {
            "manager_enabled": True,
            "ceph_admin_enabled": True,
            "storage_ops_enabled": True,
            "browser_enabled": True,
            "browser_root_enabled": True,
            "browser_manager_enabled": True,
            "browser_ceph_admin_enabled": True,
            "browser_portal_enabled": True,
            "portal_enabled": True,
            "billing_enabled": False,
            "endpoint_status_enabled": True,
            "quota_alerts_enabled": False,
            "usage_history_enabled": False,
            "bucket_migration_enabled": True,
            "bucket_compare_enabled": True,
            "bucket_integrity_check_enabled": True,
            "bucket_usage_stats_enabled": True,
            "manager_ceph_s3_user_keys_enabled": True,
            "allow_login_access_keys": False,
            "allow_login_endpoint_list": False,
            "allow_login_custom_endpoint": False,
        }
    }
    return json.dumps(payload)


def _prepare_environment(backend_root: Path, backend_base_url: str) -> dict[str, str]:
    env = os.environ.copy()

    # CI should not rely on a repo-local .env file or partially injected nested auth provider variables.
    if env.get("CI"):
        env_file = backend_root / ".env"
        if env_file.exists():
            env_file.unlink()
    else:
        _load_local_env_defaults(env, backend_root)

    endpoint_payload = _build_endpoint_payload(env)
    _derive_ceph_test_env_from_storage_endpoints(env)

    for key in list(env):
        if key.startswith("OIDC_PROVIDERS__") or key.startswith("LDAP_PROVIDERS__"):
            env.pop(key, None)
    env["OIDC_PROVIDERS"] = "{}"
    env["LDAP_PROVIDERS"] = "{}"

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
        "APP_SETTINGS_PATH",
    ):
        env.pop(key, None)

    runtime_dir = backend_root / ".ci-runtime"
    runtime_dir.mkdir(exist_ok=True)
    database_path = runtime_dir / "ceph-functional-ci.db"
    app_settings_path = runtime_dir / "app_settings.json"
    for suffix in ("", "-shm", "-wal"):
        candidate = Path(f"{database_path}{suffix}")
        if candidate.exists():
            candidate.unlink()
    if app_settings_path.exists():
        app_settings_path.unlink()

    super_admin_email = _env_str("SEED_SUPER_ADMIN_EMAIL", "ci-ceph-functional-admin@example.com", source=env)
    request_origin = _origin_from_url(backend_base_url)
    super_admin_password = _env_str("SEED_SUPER_ADMIN_PASSWORD", _generate_secret(), source=env)
    rgw_region = _env_str("CEPH_TEST_RGW_REGION", "us-east-1", source=env) or "us-east-1"
    rgw_verify_tls = _env_bool(
        "CEPH_TEST_RGW_VERIFY_TLS",
        _env_bool("CEPH_TEST_LAB_VERIFY_TLS", True, source=env),
        source=env,
    )

    env["DATABASE_URL"] = f"sqlite:///{database_path.resolve().as_posix()}"
    env["PUBLIC_ORIGIN"] = request_origin
    env["CORS_ORIGINS"] = json.dumps([request_origin])
    env["JWT_KEYS"] = _env_str("JWT_KEYS", json.dumps([_generate_secret()]), source=env) or json.dumps(
        [_generate_secret()]
    )
    env["CREDENTIAL_KEYS"] = _env_str(
        "CREDENTIAL_KEYS",
        json.dumps([_generate_secret()]),
        source=env,
    ) or json.dumps([_generate_secret()])
    env["SEED_SUPER_ADMIN_EMAIL"] = super_admin_email or "ci-ceph-functional-admin@example.com"
    env["SEED_SUPER_ADMIN_PASSWORD"] = super_admin_password or _generate_secret()
    env["SEED_SUPER_ADMIN_FULL_NAME"] = _env_str(
        "SEED_SUPER_ADMIN_FULL_NAME",
        "Ceph Functional CI Admin",
        source=env,
    ) or (
        "Ceph Functional CI Admin"
    )
    env["SEED_SUPER_ADMIN_MODE"] = "if_empty"
    env["ENV_STORAGE_ENDPOINTS"] = endpoint_payload
    app_settings_path.write_text(_build_app_settings_payload(), encoding="utf-8")
    env["APP_SETTINGS_PATH"] = app_settings_path.resolve().as_posix()

    env["FEATURE_MANAGER_ENABLED"] = "true"
    env["FEATURE_BROWSER_ENABLED"] = "true"
    env["FEATURE_CEPH_ADMIN_ENABLED"] = "true"
    env["FEATURE_STORAGE_OPS_ENABLED"] = "true"
    env["FEATURE_ENDPOINT_STATUS_ENABLED"] = "true"
    env["FEATURE_PORTAL_ENABLED"] = "true"
    env["BUCKET_MIGRATION_WORKER_ENABLED"] = "true"

    env["CEPH_TEST_BACKEND_BASE_URL"] = backend_base_url
    env["CEPH_TEST_SUPERADMIN_EMAIL"] = env["SEED_SUPER_ADMIN_EMAIL"]
    env["CEPH_TEST_SUPERADMIN_PASSWORD"] = env["SEED_SUPER_ADMIN_PASSWORD"]
    env["CEPH_TEST_REQUEST_ORIGIN"] = request_origin
    env["CEPH_TEST_VERIFY_TLS"] = "false"
    env["CEPH_TEST_RGW_ADMIN_ENDPOINT"] = _require_env("CEPH_TEST_RGW_ADMIN_ENDPOINT", source=env)
    env["CEPH_TEST_RGW_ADMIN_ACCESS_KEY"] = _require_env("CEPH_TEST_RGW_ADMIN_ACCESS_KEY", source=env)
    env["CEPH_TEST_RGW_ADMIN_SECRET_KEY"] = _require_env("CEPH_TEST_RGW_ADMIN_SECRET_KEY", source=env)
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
    backend_port = _select_backend_port()
    backend_base_url = f"http://{BACKEND_HOST}:{backend_port}/api"
    health_url = f"http://{BACKEND_HOST}:{backend_port}/health"

    env = _prepare_environment(backend_root, backend_base_url)

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
                str(backend_port),
            ],
            cwd=backend_root,
            env=env,
            stdout=log_file,
            stderr=subprocess.STDOUT,
            text=True,
        )
        try:
            _wait_for_backend(backend, health_url, BACKEND_BOOT_TIMEOUT_SECONDS, backend_log_path)
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
