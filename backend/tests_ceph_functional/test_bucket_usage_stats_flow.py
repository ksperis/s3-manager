# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import json
import uuid
from typing import Any

import pytest

from .clients import BackendAPIError, BackendSession
from .config import CephTestSettings
from .resources import ResourceTracker


def _bucket(prefix: str) -> str:
    return f"{prefix}-usage-stats-{uuid.uuid4().hex[:6]}"


def _parse_sse_result(text: str) -> dict[str, Any]:
    event_name = "message"
    data_lines: list[str] = []
    for raw_line in text.splitlines() + [""]:
        line = raw_line.rstrip("\r")
        if line == "":
            if event_name == "result" and data_lines:
                return json.loads("\n".join(data_lines))
            event_name = "message"
            data_lines = []
            continue
        if line.startswith("event:"):
            event_name = line.split(":", 1)[1].strip()
        elif line.startswith("data:"):
            data_lines.append(line.split(":", 1)[1].lstrip())
    raise AssertionError(f"No result event found in SSE stream: {text[:500]}")


def _upload(session: BackendSession, account_id: int, bucket_name: str, key: str, payload: bytes, filename: str) -> None:
    session.request(
        "POST",
        f"/manager/buckets/{bucket_name}/objects/upload",
        params={"account_id": account_id},
        data={"prefix": "", "key": key},
        files={"file": (filename, payload, "application/octet-stream")},
        expected_status=201,
    )


def _run_manager_usage_stats(session: BackendSession, account_id: int, bucket_name: str) -> dict[str, Any]:
    response = session.request(
        "POST",
        f"/manager/buckets/{bucket_name}/usage-stats/stream",
        params={"account_id": account_id},
        json={"parallelism": 1},
    )
    return _parse_sse_result(response.text)


def _run_manager_scope_usage_stats(session: BackendSession, account_id: int) -> dict[str, Any]:
    response = session.request(
        "POST",
        "/manager/usage-stats/stream",
        params={"account_id": account_id},
        json={"parallelism": 1},
    )
    return _parse_sse_result(response.text)


def _find_optional_ceph_admin_endpoint_id(
    session: BackendSession,
    settings: CephTestSettings,
) -> int | None:
    try:
        endpoints = session.get("/ceph-admin/endpoints")
    except BackendAPIError as exc:
        detail = ""
        if isinstance(exc.payload, dict):
            detail = str(exc.payload.get("detail") or "")
        elif exc.payload is not None:
            detail = str(exc.payload)
        if exc.status_code == 403 and "ceph admin feature is disabled" in detail.lower():
            return None
        raise
    if not isinstance(endpoints, list) or not endpoints:
        return None

    selected: dict[str, Any] | None = None
    endpoint_name_filter = (settings.ceph_admin_endpoint_name or "").strip().lower()
    if endpoint_name_filter:
        selected = next(
            (candidate for candidate in endpoints if str(candidate.get("name") or "").strip().lower() == endpoint_name_filter),
            None,
        )
        if selected is None:
            return None

    if selected is None and settings.ceph_admin_require_default_endpoint:
        selected = next((candidate for candidate in endpoints if bool(candidate.get("is_default"))), None)
        if selected is None:
            return None

    if selected is None:
        selected = endpoints[0]

    endpoint_id_raw = selected.get("id")
    if endpoint_id_raw is None:
        return None
    endpoint_id = int(endpoint_id_raw)
    access = session.get(f"/ceph-admin/endpoints/{endpoint_id}/access")
    if not bool(access.get("can_admin")):
        return None
    return endpoint_id


def _run_ceph_admin_scope_usage_stats(session: BackendSession, endpoint_id: int) -> dict[str, Any]:
    response = session.request(
        "POST",
        f"/ceph-admin/endpoints/{endpoint_id}/usage-stats/stream",
        json={"parallelism": 1},
    )
    return _parse_sse_result(response.text)


def _run_admin_managed_usage_stats(session: BackendSession, endpoint_id: int) -> dict[str, Any]:
    response = session.request(
        "POST",
        "/admin/usage-stats/stream",
        params={"endpoint_id": endpoint_id},
        json={"parallelism": 1},
    )
    return _parse_sse_result(response.text)


@pytest.mark.ceph_functional
def test_bucket_usage_stats_counts_current_and_noncurrent_version_bytes(
    ceph_test_settings: CephTestSettings,
    provisioned_account,
    resource_tracker: ResourceTracker,
    super_admin_session: BackendSession,
) -> None:
    manager_session: BackendSession = provisioned_account.manager_session
    account_id = provisioned_account.account_id

    bucket_name = _bucket(ceph_test_settings.test_prefix)
    manager_session.post(
        "/manager/buckets",
        params={"account_id": account_id},
        json={
            "name": bucket_name,
            "versioning": True,
            "block_public_access": False,
        },
        expected_status=201,
    )
    resource_tracker.track_bucket(account_id, bucket_name)

    properties = manager_session.get(
        f"/manager/buckets/{bucket_name}/properties",
        params={"account_id": account_id},
    )
    if properties.get("versioning_status") != "Enabled":
        pytest.skip(f"Bucket versioning was not enabled by this endpoint: {properties.get('versioning_status')}")

    _upload(manager_session, account_id, bucket_name, "docs/report.pdf", b"0123456789", "report-v1.pdf")
    _upload(manager_session, account_id, bucket_name, "docs/report.pdf", b"01234567890123456789", "report-v2.pdf")
    _upload(manager_session, account_id, bucket_name, "images/logo.png", b"12345", "logo.png")
    manager_session.post(
        f"/manager/buckets/{bucket_name}/objects/delete",
        params={"account_id": account_id},
        json={"keys": ["images/logo.png"]},
    )

    result = _run_manager_usage_stats(manager_session, account_id, bucket_name)
    assert result["status"] in {"completed", "completed_with_warnings"}
    bucket_result = result["buckets"][0]
    snapshot = bucket_result["snapshot"]
    if not snapshot["version_listing_available"]:
        pytest.skip("Endpoint does not support object version listing; current/non-current bytes unavailable.")

    assert snapshot["object_version_count"] >= 3
    assert snapshot["delete_marker_count"] >= 1
    assert snapshot["total_bytes"] >= 35
    assert snapshot["current_bytes"] >= 20
    assert snapshot["noncurrent_bytes"] >= 15
    current = next(entry for entry in snapshot["current_vs_noncurrent"] if entry["key"] == "current")
    noncurrent = next(entry for entry in snapshot["current_vs_noncurrent"] if entry["key"] == "noncurrent")
    assert current["bytes"] >= 20
    assert noncurrent["bytes"] >= 15

    latest = manager_session.get(
        f"/manager/buckets/{bucket_name}/usage-stats",
        params={"account_id": account_id},
    )
    assert latest["snapshot"]["bucket_name"] == bucket_name
    assert latest["snapshot"]["current_bytes"] == snapshot["current_bytes"]
    assert latest["snapshot"]["noncurrent_bytes"] == snapshot["noncurrent_bytes"]

    manager_scope_result = _run_manager_scope_usage_stats(manager_session, account_id)
    assert manager_scope_result["status"] in {"completed", "completed_with_warnings"}
    assert manager_scope_result["total_buckets"] >= 1
    assert manager_scope_result["completed_buckets"] >= 1

    manager_aggregate = manager_session.get(
        "/manager/usage-stats/latest",
        params={"account_id": account_id},
    )["aggregate"]
    assert manager_aggregate["bucket_count"] >= 1
    assert manager_aggregate["buckets_with_snapshot"] >= 1
    assert manager_aggregate["total_bytes"] >= snapshot["total_bytes"]
    assert manager_aggregate["current_bytes"] >= snapshot["current_bytes"]
    assert manager_aggregate["noncurrent_bytes"] >= snapshot["noncurrent_bytes"]

    account_detail = super_admin_session.get(f"/admin/accounts/{account_id}")
    admin_endpoint_id = account_detail.get("storage_endpoint_id")
    if admin_endpoint_id is not None:
        admin_scope_result = _run_admin_managed_usage_stats(super_admin_session, int(admin_endpoint_id))
        assert admin_scope_result["status"] in {"completed", "completed_with_warnings"}
        assert admin_scope_result["total_buckets"] >= 1
        assert admin_scope_result["completed_buckets"] >= 1

        admin_aggregate = super_admin_session.get(
            "/admin/usage-stats/latest",
            params={"endpoint_id": int(admin_endpoint_id)},
        )["aggregate"]
        assert admin_aggregate["scope_kind"] == "admin_managed"
        assert admin_aggregate["scope_id"] == str(admin_endpoint_id)
        assert admin_aggregate["managed_account_count"] >= 1
        assert admin_aggregate["accounts_with_listed_buckets"] >= 1
        assert admin_aggregate["bucket_count"] >= 1
        assert admin_aggregate["buckets_with_snapshot"] >= 1
        assert admin_aggregate["total_bytes"] >= snapshot["total_bytes"]
        assert admin_aggregate["current_bytes"] >= snapshot["current_bytes"]
        assert admin_aggregate["noncurrent_bytes"] >= snapshot["noncurrent_bytes"]

    ceph_admin_endpoint_id = _find_optional_ceph_admin_endpoint_id(super_admin_session, ceph_test_settings)
    if ceph_admin_endpoint_id is not None:
        ceph_scope_result = _run_ceph_admin_scope_usage_stats(super_admin_session, ceph_admin_endpoint_id)
        assert ceph_scope_result["status"] in {"completed", "completed_with_warnings"}
        assert ceph_scope_result["total_buckets"] >= 1
        ceph_aggregate = super_admin_session.get(
            f"/ceph-admin/endpoints/{ceph_admin_endpoint_id}/usage-stats/latest"
        )["aggregate"]
        assert ceph_aggregate["bucket_count"] >= 1
        assert ceph_aggregate["buckets_with_snapshot"] >= 1
        assert ceph_aggregate["total_bytes"] >= snapshot["total_bytes"]

    try:
        storage_ops_response = super_admin_session.request(
            "POST",
            "/storage-ops/buckets/usage-stats/stream",
            json={"targets": [{"context_id": str(account_id), "bucket_name": bucket_name}], "parallelism": 1},
        )
    except BackendAPIError as exc:
        detail = str(exc.payload.get("detail") if isinstance(exc.payload, dict) else exc.payload)
        if "Not authorized" in detail:
            return
        raise
    storage_ops_result = _parse_sse_result(storage_ops_response.text)
    assert storage_ops_result["status"] in {"completed", "completed_with_warnings"}
