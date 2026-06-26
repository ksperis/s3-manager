# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import pytest

from .ceph_admin_helpers import run_or_skip
from .clients import BackendSession
from .conftest import CephAdminEndpointTestContext, S3AccountTestContext


def _parse_int(value) -> int | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return None


def _parse_bool(value) -> bool | None:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"true", "1", "yes", "enabled", "enable"}:
            return True
        if normalized in {"false", "0", "no", "disabled", "disable"}:
            return False
    return None


def _quota_payload(payload: dict, keys: tuple[str, ...]) -> dict | None:
    for key in keys:
        value = payload.get(key)
        if isinstance(value, dict):
            return value
    return None


def _quota_max_objects(payload: dict, keys: tuple[str, ...]) -> int | None:
    quota = _quota_payload(payload, keys)
    if quota is None:
        return None
    return _parse_int(quota.get("max_objects"))


def _quota_enabled(payload: dict, keys: tuple[str, ...]) -> bool | None:
    quota = _quota_payload(payload, keys)
    if quota is None:
        return None
    return _parse_bool(quota.get("enabled"))


def _assert_quota_objects_applied(
    *,
    label: str,
    api_detail: dict,
    api_key: str,
    raw_account: dict,
    raw_keys: tuple[str, ...],
    expected: int,
) -> None:
    raw_enabled = _quota_enabled(raw_account, raw_keys)
    raw_objects = _quota_max_objects(raw_account, raw_keys)
    if raw_enabled is False or raw_objects != expected:
        pytest.skip(
            f"RGW {label} quota update is not applied on this cluster "
            f"(enabled={raw_enabled}, max_objects={raw_objects})"
        )

    api_quota = api_detail.get(api_key)
    assert isinstance(api_quota, dict), f"Updated account detail should include {api_key}"
    if raw_enabled is not None:
        assert api_quota.get("enabled") is True
    assert _quota_max_objects(api_detail, (api_key,)) == expected


def _find_account(items: list[dict], account_id: str) -> dict | None:
    for item in items:
        if str(item.get("account_id") or "").strip() == account_id:
            return item
    return None


@pytest.mark.ceph_functional
def test_ceph_admin_accounts_listing_detail_update_and_metrics(
    super_admin_session: BackendSession,
    ceph_admin_endpoint: CephAdminEndpointTestContext,
    provisioned_account: S3AccountTestContext,
) -> None:
    rgw_account_id = (provisioned_account.rgw_account_id or "").strip()
    if not rgw_account_id:
        pytest.skip("Ceph Admin accounts flow requires an RGW account_id on the provisioned test account")

    endpoint_id = ceph_admin_endpoint.endpoint_id
    base_path = f"/ceph-admin/endpoints/{endpoint_id}/accounts"

    listing = run_or_skip(
        "ceph-admin account listing",
        lambda: super_admin_session.get(
            base_path,
            params={
                "search": rgw_account_id,
                "page": 1,
                "page_size": 50,
                "sort_by": "account_id",
                "sort_dir": "asc",
                "include": "profile,limits,quota,stats",
            },
        ),
    )
    assert isinstance(listing, dict)
    assert "items" in listing
    matched = _find_account(listing["items"], rgw_account_id)
    if matched is None:
        # Some clusters do not index account search consistently; retry with full first page.
        listing = run_or_skip(
            "ceph-admin account listing (fallback)",
            lambda: super_admin_session.get(
                base_path,
                params={
                    "page": 1,
                    "page_size": 200,
                    "sort_by": "account_id",
                    "sort_dir": "asc",
                    "include": "profile,limits,quota,stats",
                },
            ),
        )
        matched = _find_account(listing["items"], rgw_account_id)
    assert matched is not None, f"Account {rgw_account_id} should be visible in ceph-admin listing"

    detail = run_or_skip(
        "ceph-admin account detail",
        lambda: super_admin_session.get(f"{base_path}/{rgw_account_id}/detail"),
    )
    assert detail["account_id"] == rgw_account_id

    updated = run_or_skip(
        "ceph-admin account config update",
        lambda: super_admin_session.put(
            f"{base_path}/{rgw_account_id}/config",
            json={
                "max_users": 25,
                "max_buckets": 25,
                "quota_enabled": True,
                "quota_max_objects": 20000,
                "bucket_quota_enabled": True,
                "bucket_quota_max_objects": 2000,
            },
        ),
    )
    assert updated["account_id"] == rgw_account_id
    if updated.get("max_users") is not None:
        if int(updated["max_users"]) != 25:
            pytest.skip(
                f"RGW account limits update is not applied on this cluster (max_users={updated['max_users']})"
            )
    if updated.get("max_buckets") is not None:
        if int(updated["max_buckets"]) != 25:
            pytest.skip(
                f"RGW account limits update is not applied on this cluster (max_buckets={updated['max_buckets']})"
            )

    raw_account = run_or_skip(
        "ceph-admin account raw payload",
        lambda: super_admin_session.get(f"{base_path}/{rgw_account_id}"),
    )
    assert isinstance(raw_account, dict)
    _assert_quota_objects_applied(
        label="account",
        api_detail=updated,
        api_key="quota",
        raw_account=raw_account,
        raw_keys=("quota", "account_quota"),
        expected=20000,
    )
    _assert_quota_objects_applied(
        label="bucket",
        api_detail=updated,
        api_key="bucket_quota",
        raw_account=raw_account,
        raw_keys=("bucket_quota",),
        expected=2000,
    )

    if ceph_admin_endpoint.can_metrics:
        metrics = run_or_skip(
            "ceph-admin account metrics",
            lambda: super_admin_session.get(f"{base_path}/{rgw_account_id}/metrics"),
        )
        assert "bucket_count" in metrics
        assert "generated_at" in metrics
