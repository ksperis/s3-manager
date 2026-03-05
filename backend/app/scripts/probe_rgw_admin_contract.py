# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from app.services.rgw_admin import RGWAdminClient, RGWAdminError

try:
    from dotenv import load_dotenv
except ModuleNotFoundError:  # pragma: no cover - optional dependency guard
    load_dotenv = None  # type: ignore[assignment]


def _load_local_env_files() -> None:
    if load_dotenv is None:
        return
    backend_root = Path(__file__).resolve().parents[2]
    for path in (backend_root / ".env", backend_root.parent / ".env"):
        if path.exists():
            load_dotenv(path, override=False)


def _env_str(*names: str) -> str | None:
    for name in names:
        value = os.getenv(name)
        if value is None:
            continue
        cleaned = value.strip()
        if cleaned:
            return cleaned
    return None


def _env_bool(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "t", "yes", "y", "on"}


def _raw_status(client: RGWAdminClient, path: str, *, params: dict[str, Any]) -> int:
    response = client.session.request(
        "GET",
        f"{client.endpoint}{path}",
        params=params,
        auth=client.auth,
        timeout=client.request_timeout_seconds,
        verify=client.session.verify,
    )
    return response.status_code


def _pick_sample_account(client: RGWAdminClient) -> str | None:
    try:
        payload = client.list_accounts(include_details=False)
    except RGWAdminError:
        return None
    for entry in payload:
        if isinstance(entry, dict):
            value = str(entry.get("account_id") or entry.get("id") or "").strip()
        else:
            value = str(entry or "").strip()
        if value:
            return value
    return None


def _pick_sample_user(client: RGWAdminClient) -> tuple[str | None, str | None]:
    try:
        payload = client.list_users()
    except RGWAdminError:
        return None, None
    for entry in payload:
        if isinstance(entry, dict):
            raw = str(entry.get("user") or entry.get("uid") or entry.get("id") or "").strip()
        else:
            raw = str(entry or "").strip()
        if not raw:
            continue
        if "$" in raw:
            tenant, uid = raw.split("$", 1)
            if tenant and uid:
                return tenant, uid
        return None, raw
    return None, None


def main() -> int:
    _load_local_env_files()
    endpoint = _env_str("CEPH_TEST_RGW_ADMIN_ENDPOINT", "SEED_RGW_ADMIN_ENDPOINT", "SEED_S3_ENDPOINT")
    access_key = _env_str(
        "CEPH_TEST_RGW_ADMIN_ACCESS_KEY",
        "SEED_RGW_ADMIN_ACCESS_KEY",
        "SEED_CEPH_ADMIN_ACCESS_KEY",
        "SEED_S3_ACCESS_KEY",
    )
    secret_key = _env_str(
        "CEPH_TEST_RGW_ADMIN_SECRET_KEY",
        "SEED_RGW_ADMIN_SECRET_KEY",
        "SEED_CEPH_ADMIN_SECRET_KEY",
        "SEED_S3_SECRET_KEY",
    )
    region = _env_str("CEPH_TEST_RGW_REGION", "SEED_S3_REGION")
    verify_tls = _env_bool("CEPH_TEST_RGW_VERIFY_TLS", False)

    if not endpoint or not access_key or not secret_key:
        print("missing RGW admin settings (endpoint/access_key/secret_key)")
        return 2

    client = RGWAdminClient(
        access_key=access_key,
        secret_key=secret_key,
        endpoint=endpoint,
        region=region,
        verify_tls=verify_tls,
    )

    account_id = _pick_sample_account(client)
    tenant, uid = _pick_sample_user(client)
    if not account_id:
        print("unable to probe /admin/account strictness: no account id available")
        return 2
    if not uid:
        print("unable to probe /admin/user strictness: no uid available")
        return 2

    checks: list[tuple[str, int, int]] = []
    checks.append(
        (
            "GET /admin/account id",
            _raw_status(client, "/admin/account", params={"id": account_id, "format": "json"}),
            200,
        )
    )
    checks.append(
        (
            "GET /admin/account account-id",
            _raw_status(client, "/admin/account", params={"account-id": account_id, "format": "json"}),
            400,
        )
    )
    checks.append(
        (
            "GET /admin/account account_id",
            _raw_status(client, "/admin/account", params={"account_id": account_id, "format": "json"}),
            400,
        )
    )
    checks.append(
        (
            "GET /admin/account sync-stats + id",
            _raw_status(client, "/admin/account", params={"id": account_id, "sync-stats": "true", "format": "json"}),
            200,
        )
    )
    checks.append(
        (
            "GET /admin/account sync-stats + account-id",
            _raw_status(
                client,
                "/admin/account",
                params={"account-id": account_id, "sync-stats": "true", "format": "json"},
            ),
            400,
        )
    )
    user_params = {"uid": uid, "format": "json"}
    if tenant:
        user_params["tenant"] = tenant
    checks.append(
        (
            "GET /admin/user uid",
            _raw_status(client, "/admin/user", params=user_params),
            200,
        )
    )
    user_id_params = dict(user_params)
    user_id_params.pop("uid", None)
    user_id_params["user-id"] = uid
    checks.append(
        (
            "GET /admin/user user-id",
            _raw_status(client, "/admin/user", params=user_id_params),
            400,
        )
    )
    user_id_snake_params = dict(user_params)
    user_id_snake_params.pop("uid", None)
    user_id_snake_params["user_id"] = uid
    checks.append(
        (
            "GET /admin/user user_id",
            _raw_status(client, "/admin/user", params=user_id_snake_params),
            400,
        )
    )

    failed = False
    for label, got, expected in checks:
        ok = got == expected
        failed = failed or not ok
        print(f"[{'OK' if ok else 'KO'}] {label}: got={got} expected={expected}")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
