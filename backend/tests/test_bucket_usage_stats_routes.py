# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from datetime import datetime, timezone

from fastapi.testclient import TestClient
from fastapi.responses import JSONResponse

from app.db import S3Account, StorageEndpoint, User, UserRole
from app.main import app
from app.models.account_capabilities import AccountCapabilities
from app.models.bucket_usage_stats import BucketUsageStatsDistributionEntry, BucketUsageStatsSnapshot
from app.routers import dependencies
from app.routers.admin import usage_stats as admin_usage_stats_router
from app.routers.ceph_admin import usage_stats as ceph_usage_stats_router
from app.routers.manager import usage_stats as manager_usage_stats_router
from app.services.bucket_usage_stats_service import BucketUsageStatsService
from app.services.s3_execution_context import S3ExecutionContext


def _snapshot(bucket_name: str, *, scope_kind: str = "manager", scope_id: str = "1", bytes_value: int = 10) -> BucketUsageStatsSnapshot:
    return BucketUsageStatsSnapshot(
        scope_kind=scope_kind,
        scope_id=scope_id,
        scope_name="Scope",
        bucket_name=bucket_name,
        scan_mode="versions",
        version_listing_available=True,
        object_version_count=1,
        current_version_count=1,
        noncurrent_version_count=0,
        delete_marker_count=0,
        total_bytes=bytes_value,
        current_bytes=bytes_value,
        noncurrent_bytes=0,
        data_type_distribution=[
            BucketUsageStatsDistributionEntry(key="documents", label="Documents", count=1, bytes=bytes_value, ratio_count=1, ratio_bytes=1)
        ],
        storage_class_distribution=[
            BucketUsageStatsDistributionEntry(key="STANDARD", label="STANDARD", count=1, bytes=bytes_value, ratio_count=1, ratio_bytes=1)
        ],
        size_distribution=[],
        age_distribution=[],
        current_vs_noncurrent=[
            BucketUsageStatsDistributionEntry(key="current", label="Current versions", count=1, bytes=bytes_value, ratio_count=1, ratio_bytes=1),
            BucketUsageStatsDistributionEntry(key="noncurrent", label="Non-current versions", count=0, bytes=0, ratio_count=0, ratio_bytes=0),
        ],
        warnings=[],
        calculated_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
    )


def _tool_user() -> User:
    return User(
        id=77,
        email="usage-stats@example.test",
        hashed_password="x",
        is_active=True,
        role=UserRole.UI_USER.value,
    )


def test_manager_usage_stats_latest_aggregates_snapshots_and_coverage(client: TestClient, db_session, monkeypatch):
    BucketUsageStatsService().upsert_snapshot(db_session, _snapshot("bucket-a", bytes_value=20))
    account = S3ExecutionContext(
        context_id="1",
        context_kind="account",
        name="Managed Account",
        access_key=None,
        secret_key=None,
        id=1,
        rgw_account_id="rgw-account",
        manager_capabilities=AccountCapabilities(can_manage_buckets=True),
    )

    monkeypatch.setattr(manager_usage_stats_router, "_list_manager_bucket_names", lambda account, service: ["bucket-a", "bucket-b"])
    app.dependency_overrides[manager_usage_stats_router.get_account_context] = lambda: account
    app.dependency_overrides[manager_usage_stats_router.require_bucket_usage_stats_enabled] = _tool_user
    app.dependency_overrides[manager_usage_stats_router.get_buckets_service] = lambda: object()

    response = client.get("/api/manager/usage-stats/latest", params={"account_id": 1})

    assert response.status_code == 200, response.text
    aggregate = response.json()["aggregate"]
    assert aggregate["scope_kind"] == "manager"
    assert aggregate["scope_id"] == "1"
    assert aggregate["bucket_count"] == 2
    assert aggregate["buckets_with_snapshot"] == 1
    assert aggregate["missing_bucket_count"] == 1
    assert aggregate["total_bytes"] == 20
    assert aggregate["data_type_distribution"][0]["ratio_bytes"] == 1


def test_manager_usage_stats_stream_builds_scope_targets(client: TestClient, monkeypatch):
    account = S3ExecutionContext(
        context_id="1",
        context_kind="account",
        name="Managed Account",
        access_key=None,
        secret_key=None,
        id=1,
        rgw_account_id="rgw-account",
        manager_capabilities=AccountCapabilities(can_manage_buckets=True),
    )
    captured: dict[str, object] = {}

    class FakeService:
        def __init__(self, *_args, **_kwargs):
            pass

        def run(self, targets, options, **_kwargs):
            captured["targets"] = targets
            captured["parallelism"] = options.parallelism
            return {"status": "completed"}

    def fake_stream(_request, run_check, **_kwargs):
        run_check(lambda _event: None, lambda: False)
        return JSONResponse({"ok": True})

    monkeypatch.setattr(manager_usage_stats_router, "_list_manager_bucket_names", lambda account, service: ["bucket-a", "bucket-b"])
    monkeypatch.setattr(manager_usage_stats_router, "BucketUsageStatsService", FakeService)
    monkeypatch.setattr(manager_usage_stats_router, "stream_bucket_usage_stats", fake_stream)
    app.dependency_overrides[manager_usage_stats_router.get_account_context] = lambda: account
    app.dependency_overrides[manager_usage_stats_router.require_bucket_usage_stats_enabled] = _tool_user
    app.dependency_overrides[manager_usage_stats_router.get_buckets_service] = lambda: object()

    response = client.post("/api/manager/usage-stats/stream", params={"account_id": 1}, json={"parallelism": 3})

    assert response.status_code == 200, response.text
    targets = captured["targets"]
    assert [target.bucket_name for target in targets] == ["bucket-a", "bucket-b"]
    assert [target.scope_kind for target in targets] == ["manager", "manager"]
    assert captured["parallelism"] == 3


def test_ceph_admin_usage_stats_latest_aggregates_endpoint_scope(client: TestClient, db_session, monkeypatch):
    BucketUsageStatsService().upsert_snapshot(
        db_session,
        _snapshot("bucket-a", scope_kind="ceph_admin", scope_id="7", bytes_value=30),
    )
    ctx = type("Ctx", (), {"endpoint": type("Endpoint", (), {"id": 7, "name": "Ceph Lab"})()})()

    monkeypatch.setattr(ceph_usage_stats_router, "_list_ceph_bucket_names", lambda ctx: ["bucket-a", "bucket-b"])
    app.dependency_overrides[dependencies.require_ceph_admin_enabled] = lambda: None
    app.dependency_overrides[ceph_usage_stats_router.get_ceph_admin_context] = lambda: ctx

    try:
        response = client.get("/api/ceph-admin/endpoints/7/usage-stats/latest")
    finally:
        app.dependency_overrides.pop(dependencies.require_ceph_admin_enabled, None)
        app.dependency_overrides.pop(ceph_usage_stats_router.get_ceph_admin_context, None)

    assert response.status_code == 200, response.text
    aggregate = response.json()["aggregate"]
    assert aggregate["scope_kind"] == "ceph_admin"
    assert aggregate["scope_id"] == "7"
    assert aggregate["scope_name"] == "Ceph Lab"
    assert aggregate["bucket_count"] == 2
    assert aggregate["buckets_with_snapshot"] == 1
    assert aggregate["total_bytes"] == 30


def test_ceph_admin_usage_stats_stream_builds_endpoint_targets(client: TestClient, monkeypatch):
    endpoint = type(
        "Endpoint",
        (),
        {
            "id": 7,
            "name": "Ceph Lab",
            "endpoint_url": "https://ceph.example.test",
            "region": None,
        },
    )()
    ctx = type("Ctx", (), {"endpoint": endpoint, "s3_endpoint": "https://ceph.example.test", "region": None, "access_key": "ak", "secret_key": "sk"})()
    user = _tool_user()
    captured: dict[str, object] = {}

    class FakeService:
        def __init__(self, *_args, **_kwargs):
            pass

        def run(self, targets, options, **_kwargs):
            captured["targets"] = targets
            captured["parallelism"] = options.parallelism
            return {"status": "completed"}

    def fake_stream(_request, run_check, **_kwargs):
        run_check(lambda _event: None, lambda: False)
        return JSONResponse({"ok": True})

    monkeypatch.setattr(ceph_usage_stats_router, "_list_ceph_bucket_names", lambda ctx: ["bucket-a", "bucket-b"])
    monkeypatch.setattr(ceph_usage_stats_router, "BucketUsageStatsService", FakeService)
    monkeypatch.setattr(ceph_usage_stats_router, "stream_bucket_usage_stats", fake_stream)
    app.dependency_overrides[dependencies.require_ceph_admin_enabled] = lambda: None
    app.dependency_overrides[ceph_usage_stats_router.get_ceph_admin_context] = lambda: ctx
    app.dependency_overrides[ceph_usage_stats_router.get_current_ceph_admin] = lambda: user

    try:
        response = client.post("/api/ceph-admin/endpoints/7/usage-stats/stream", json={"parallelism": 4})
    finally:
        app.dependency_overrides.pop(dependencies.require_ceph_admin_enabled, None)
        app.dependency_overrides.pop(ceph_usage_stats_router.get_ceph_admin_context, None)
        app.dependency_overrides.pop(ceph_usage_stats_router.get_current_ceph_admin, None)

    assert response.status_code == 200, response.text
    targets = captured["targets"]
    assert [target.bucket_name for target in targets] == ["bucket-a", "bucket-b"]
    assert [target.scope_kind for target in targets] == ["ceph_admin", "ceph_admin"]
    assert [target.scope_id for target in targets] == ["7", "7"]
    assert captured["parallelism"] == 4


def _persist_endpoint_and_accounts(db_session):
    endpoint = StorageEndpoint(
        id=7,
        name="Ceph main",
        endpoint_url="https://ceph.example.test",
        provider="ceph",
    )
    account_a = S3Account(
        id=1,
        name="Tenant A",
        rgw_account_id="tenant-a",
        rgw_access_key="ak-a",
        rgw_secret_key="sk-a",
        storage_endpoint_id=7,
    )
    account_b = S3Account(
        id=2,
        name="Tenant B",
        rgw_account_id="tenant-b",
        rgw_access_key="ak-b",
        rgw_secret_key="sk-b",
        storage_endpoint_id=7,
    )
    db_session.add_all([endpoint, account_a, account_b])
    db_session.commit()
    return endpoint, account_a, account_b


def test_admin_usage_stats_latest_aggregates_managed_account_scopes(client: TestClient, db_session, monkeypatch):
    _persist_endpoint_and_accounts(db_session)
    BucketUsageStatsService().upsert_snapshot(db_session, _snapshot("bucket-a", scope_kind="manager", scope_id="1", bytes_value=20))
    BucketUsageStatsService().upsert_snapshot(db_session, _snapshot("bucket-b", scope_kind="ceph_admin", scope_id="7", bytes_value=999))

    class FakeBucketService:
        def list_buckets(self, account, **_kwargs):
            if account.id == 1:
                return [type("Bucket", (), {"name": "bucket-a"})(), type("Bucket", (), {"name": "bucket-missing"})()]
            return [type("Bucket", (), {"name": "bucket-b"})()]

    app.dependency_overrides[admin_usage_stats_router.get_buckets_service] = lambda: FakeBucketService()

    response = client.get("/api/admin/usage-stats/latest", params={"endpoint_id": 7})

    assert response.status_code == 200, response.text
    aggregate = response.json()["aggregate"]
    assert aggregate["scope_kind"] == "admin_managed"
    assert aggregate["scope_id"] == "7"
    assert aggregate["managed_account_count"] == 2
    assert aggregate["accounts_with_listed_buckets"] == 2
    assert aggregate["bucket_count"] == 3
    assert aggregate["buckets_with_snapshot"] == 1
    assert aggregate["missing_bucket_count"] == 2
    assert aggregate["total_bytes"] == 20


def test_admin_usage_stats_latest_warns_for_unlistable_managed_accounts(client: TestClient, db_session):
    _persist_endpoint_and_accounts(db_session)

    class FakeBucketService:
        def list_buckets(self, account, **_kwargs):
            if account.id == 1:
                return [type("Bucket", (), {"name": "bucket-a"})()]
            raise RuntimeError("denied")

    app.dependency_overrides[admin_usage_stats_router.get_buckets_service] = lambda: FakeBucketService()

    response = client.get("/api/admin/usage-stats/latest", params={"endpoint_id": 7})

    assert response.status_code == 200, response.text
    aggregate = response.json()["aggregate"]
    assert aggregate["managed_account_count"] == 2
    assert aggregate["accounts_with_listed_buckets"] == 1
    assert aggregate["skipped_account_count"] == 1
    assert "1 managed account(s) could not be scanned for bucket usage stats." in aggregate["warnings"]


def test_admin_usage_stats_stream_builds_manager_scope_targets(client: TestClient, db_session, monkeypatch):
    _persist_endpoint_and_accounts(db_session)
    captured: dict[str, object] = {}

    class FakeBucketService:
        def list_buckets(self, account, **_kwargs):
            return [type("Bucket", (), {"name": f"bucket-{account.id}"})()]

    class FakeService:
        def __init__(self, *_args, **_kwargs):
            pass

        def run(self, targets, options, **_kwargs):
            captured["targets"] = targets
            captured["parallelism"] = options.parallelism
            return {"status": "completed"}

    def fake_stream(_request, run_check, **_kwargs):
        run_check(lambda _event: None, lambda: False)
        return JSONResponse({"ok": True})

    app.dependency_overrides[admin_usage_stats_router.get_buckets_service] = lambda: FakeBucketService()
    monkeypatch.setattr(admin_usage_stats_router, "BucketUsageStatsService", FakeService)
    monkeypatch.setattr(admin_usage_stats_router, "stream_bucket_usage_stats", fake_stream)

    response = client.post("/api/admin/usage-stats/stream", params={"endpoint_id": 7}, json={"parallelism": 5})

    assert response.status_code == 200, response.text
    targets = captured["targets"]
    assert [target.bucket_name for target in targets] == ["bucket-1", "bucket-2"]
    assert [target.scope_kind for target in targets] == ["manager", "manager"]
    assert [target.scope_id for target in targets] == ["1", "2"]
    assert captured["parallelism"] == 5
