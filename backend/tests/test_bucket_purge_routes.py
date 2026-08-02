# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from starlette.requests import Request

from app.db import StorageEndpoint, User, UserRole
from app.main import app
from app.models.app_settings import AppSettings
from app.models.bucket_purge import BucketPurgeProgress, BucketPurgeRequest, BucketPurgeResult
from app.routers import dependencies as dependencies_router
from app.services import app_settings_service
from app.routers.ceph_admin import purge as ceph_purge
from app.routers.ceph_admin.dependencies import CephAdminContext
from app.routers.manager import buckets as manager_buckets
from app.routers.manager import purge as manager_purge
from app.routers.storage_ops import purge as storage_ops_purge


def _build_request(path: str = "/api/manager/bucket-purge/stream", query_string: bytes = b"account_id=s3u-1") -> Request:
    return Request(
        {
            "type": "http",
            "method": "POST",
            "path": path,
            "query_string": query_string,
            "headers": [],
        }
    )


def _result(status: str = "completed") -> BucketPurgeResult:
    return BucketPurgeResult(
        status=status,
        total_buckets=1,
        completed_buckets=1,
        listed_objects=2,
        listed_versions=1,
        deleted_objects=2,
        deleted_versions=1,
        failed_count=0 if status == "completed" else 1,
        started_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
        finished_at=datetime(2026, 1, 1, 0, 0, 1, tzinfo=timezone.utc),
        buckets=[],
    )


def _manager_tool_user(*, bucket_purge: bool = True) -> User:
    return User(
        id=17,
        email="purge-tool@example.com",
        hashed_password="x",
        is_active=True,
        role=UserRole.UI_USER.value,
        can_access_manager_bucket_purge=bucket_purge,
    )


def test_require_bucket_purge_enabled_blocks_when_feature_disabled(monkeypatch):
    settings = AppSettings()
    settings.general.bucket_purge_enabled = False
    monkeypatch.setattr(app_settings_service, "load_app_settings", lambda: settings)

    with pytest.raises(HTTPException) as exc:
        dependencies_router.require_bucket_purge_enabled(_manager_tool_user(), db=None)

    assert exc.value.status_code == 403
    assert "bucket purge feature is disabled" in str(exc.value.detail).lower()


def test_require_bucket_purge_enabled_blocks_without_user_tool_access(monkeypatch):
    settings = AppSettings()
    settings.general.bucket_purge_enabled = True
    monkeypatch.setattr(app_settings_service, "load_app_settings", lambda: settings)

    with pytest.raises(HTTPException) as exc:
        dependencies_router.require_bucket_purge_enabled(_manager_tool_user(bucket_purge=False), db=None)

    assert exc.value.status_code == 403
    assert str(exc.value.detail) == "Not authorized"


def test_manager_purge_route_rejects_wrong_confirmation_with_400():
    previous_overrides = app.dependency_overrides.copy()
    app.dependency_overrides[dependencies_router.require_manager_enabled] = lambda: None
    app.dependency_overrides[manager_purge.require_bucket_purge_enabled] = lambda: _manager_tool_user()
    app.dependency_overrides[manager_purge.get_account_context] = lambda: SimpleNamespace(
        name="Tenant A",
        manager_capabilities=SimpleNamespace(can_manage_buckets=True),
    )
    app.dependency_overrides[manager_purge.get_current_account_admin] = lambda: SimpleNamespace(id=1)
    try:
        with TestClient(app) as client:
            response = client.post(
                "/api/manager/bucket-purge/stream?account_id=s3u-1",
                json={"buckets": ["bucket-a", "bucket-b"], "confirmation": "PURGE 1 BUCKETS"},
            )
    finally:
        app.dependency_overrides = previous_overrides

    assert response.status_code == 400
    assert "PURGE 2 BUCKETS" in response.text


def test_manager_delete_with_purge_route_rejects_wrong_confirmation_with_400():
    previous_overrides = app.dependency_overrides.copy()
    app.dependency_overrides[dependencies_router.require_manager_enabled] = lambda: None
    app.dependency_overrides[manager_buckets.require_bucket_purge_enabled] = lambda: _manager_tool_user()
    app.dependency_overrides[manager_buckets.get_account_context] = lambda: SimpleNamespace(
        id=1,
        name="Tenant A",
        manager_capabilities=SimpleNamespace(can_manage_buckets=True),
    )
    app.dependency_overrides[manager_buckets.get_current_account_admin] = lambda: SimpleNamespace(id=1)
    try:
        with TestClient(app) as client:
            response = client.post(
                "/api/manager/buckets/bucket-a/delete/stream?account_id=s3u-1",
                json={"confirmation": "DELETE BUCKET bucket-b"},
            )
    finally:
        app.dependency_overrides = previous_overrides

    assert response.status_code == 400
    assert "DELETE BUCKET bucket-a" in response.text


def test_manager_purge_route_streams_progress_and_result(monkeypatch):
    captured: dict[str, object] = {}

    class FakeService:
        def run(self, targets, options, *, progress_callback=None, cancel_check=None):
            captured["targets"] = targets
            captured["options"] = options
            if progress_callback:
                progress_callback(
                    BucketPurgeProgress(
                        stage="delete",
                        bucket_name="bucket-a",
                        total_buckets=1,
                        listed_objects=2,
                        listed_versions=1,
                        deleted_objects=2,
                        deleted_versions=1,
                        total_entries_estimate=3,
                        total_entries_final=True,
                    )
                )
            return _result()

    previous_overrides = app.dependency_overrides.copy()
    app.dependency_overrides[dependencies_router.require_manager_enabled] = lambda: None
    app.dependency_overrides[manager_purge.require_bucket_purge_enabled] = lambda: _manager_tool_user()
    app.dependency_overrides[manager_purge.get_account_context] = lambda: SimpleNamespace(
        name="Tenant A",
        manager_capabilities=SimpleNamespace(can_manage_buckets=True),
    )
    app.dependency_overrides[manager_purge.get_current_account_admin] = lambda: SimpleNamespace(id=1)
    monkeypatch.setattr(manager_purge, "BucketPurgeService", FakeService)
    monkeypatch.setattr(manager_purge, "_record_audit", lambda **kwargs: None)
    try:
        with TestClient(app) as client:
            response = client.post(
                "/api/manager/bucket-purge/stream?account_id=s3u-1",
                json={
                    "buckets": ["bucket-a"],
                    "parallelism": 4,
                    "include_versions": True,
                    "confirmation": "PURGE 1 BUCKETS",
                },
            )
    finally:
        app.dependency_overrides = previous_overrides

    assert response.status_code == 200
    assert "event: progress" in response.text
    assert "event: result" in response.text
    assert '"status":"completed"' in response.text
    assert '"total_entries_estimate":3' in response.text
    assert '"total_entries_final":true' in response.text
    targets = captured["targets"]
    assert targets[0].bucket_name == "bucket-a"
    assert targets[0].context_id == "s3u-1"
    assert captured["options"].parallelism == 4
    assert captured["options"].include_versions is True
    assert captured["options"].individual_deletes is False


def test_manager_delete_with_purge_route_streams_progress_and_result(monkeypatch):
    captured: dict[str, object] = {}

    class FakeService:
        def run_delete_bucket_with_purge(self, target, options, *, progress_callback=None, cancel_check=None):
            captured["target"] = target
            captured["options"] = options
            if progress_callback:
                progress_callback(
                    BucketPurgeProgress(
                        stage="delete_bucket",
                        bucket_name="bucket-a",
                        total_buckets=1,
                        listed_objects=2,
                        listed_versions=1,
                        deleted_objects=2,
                        deleted_versions=1,
                        total_entries_estimate=3,
                        total_entries_final=True,
                    )
                )
            return _result().model_copy(update={"status": "completed", "bucket_deleted": True})

    previous_overrides = app.dependency_overrides.copy()
    app.dependency_overrides[dependencies_router.require_manager_enabled] = lambda: None
    app.dependency_overrides[manager_buckets.require_bucket_purge_enabled] = lambda: _manager_tool_user()
    app.dependency_overrides[manager_buckets.get_account_context] = lambda: SimpleNamespace(
        id=1,
        name="Tenant A",
        manager_capabilities=SimpleNamespace(can_manage_buckets=True),
    )
    app.dependency_overrides[manager_buckets.get_current_account_admin] = lambda: SimpleNamespace(id=1)
    monkeypatch.setattr(manager_buckets, "BucketPurgeService", FakeService)
    monkeypatch.setattr(manager_buckets, "_record_bucket_delete_with_purge_audit", lambda **kwargs: None)
    monkeypatch.setattr(manager_buckets, "_invalidate_bucket_listing_for_account", lambda account: None)
    try:
        with TestClient(app) as client:
            response = client.post(
                "/api/manager/buckets/bucket-a/delete/stream?account_id=s3u-1",
                json={
                    "parallelism": 4,
                    "confirmation": "DELETE BUCKET bucket-a",
                },
            )
    finally:
        app.dependency_overrides = previous_overrides

    assert response.status_code == 200
    assert "event: progress" in response.text
    assert "event: result" in response.text
    assert '"bucket_deleted":true' in response.text
    assert '"total_entries_estimate":3' in response.text
    assert '"total_entries_final":true' in response.text
    target = captured["target"]
    assert target.bucket_name == "bucket-a"
    assert target.context_id == "s3u-1"
    assert captured["options"].parallelism == 4
    assert captured["options"].individual_deletes is False
    assert "entry_limit" not in captured


def test_ceph_admin_purge_route_uses_dedicated_endpoint_credentials(monkeypatch):
    captured: dict[str, object] = {}

    class FakeService:
        def run(self, targets, options, *, progress_callback=None, cancel_check=None):
            captured["targets"] = targets
            captured["options"] = options
            return _result()

    def fake_stream(request, *, run_purge, logger, failure_message, **kwargs):
        captured["stream_result"] = run_purge(lambda progress: None, lambda: None)
        return "stream"

    endpoint = StorageEndpoint(
        id=7,
        name="Ceph A",
        endpoint_url="https://s3.example.test",
        provider="ceph",
    )
    ctx = CephAdminContext(
        endpoint=endpoint,
        rgw_admin=SimpleNamespace(),
        s3_endpoint="https://s3.example.test",
        region="us-east-1",
        access_key="admin-ak",
        secret_key="admin-sk",
    )
    monkeypatch.setattr(ceph_purge, "BucketPurgeService", FakeService)
    monkeypatch.setattr(ceph_purge, "stream_bucket_purge", fake_stream)

    response = ceph_purge.stream_ceph_admin_bucket_purge(
        payload=BucketPurgeRequest(buckets=["bucket-a"], confirmation="PURGE 1 BUCKETS"),
        request=_build_request(path="/api/ceph-admin/endpoints/7/buckets/purge/stream", query_string=b""),
        user=SimpleNamespace(id=1, email="admin@example.test", role=UserRole.UI_ADMIN.value),
        ctx=ctx,
    )

    assert response == "stream"
    target = captured["targets"][0]
    assert target.bucket_name == "bucket-a"
    assert target.context_id == "ceph-admin-7"
    assert target.account.effective_rgw_credentials() == ("admin-ak", "admin-sk")
    assert captured["options"].include_versions is True
    assert captured["options"].individual_deletes is True


def test_storage_ops_purge_route_resolves_authorized_manager_contexts(monkeypatch):
    captured: dict[str, object] = {}

    class FakeService:
        def run(self, targets, options, *, progress_callback=None, cancel_check=None):
            captured["targets"] = targets
            captured["options"] = options
            return _result()

    def fake_stream(request, *, run_purge, logger, failure_message, **kwargs):
        captured["stream_result"] = run_purge(lambda progress: None, lambda: None)
        return "stream"

    def fake_get_account_context(*, request, account_ref, actor, db):
        captured.setdefault("account_refs", []).append(account_ref)
        return SimpleNamespace(name=f"Account {account_ref}")

    monkeypatch.setattr(storage_ops_purge, "BucketPurgeService", FakeService)
    monkeypatch.setattr(storage_ops_purge, "stream_bucket_purge", fake_stream)
    monkeypatch.setattr(
        storage_ops_purge,
        "list_execution_contexts",
        lambda *, workspace, user, db: [SimpleNamespace(id="s3u-1", display_name="S3 User 1")],
    )
    monkeypatch.setattr(storage_ops_purge, "get_account_context", fake_get_account_context)

    response = storage_ops_purge.stream_storage_ops_bucket_purge(
        payload=BucketPurgeRequest(
            targets=[{"context_id": "s3u-1", "bucket_name": "bucket-a"}],
            confirmation="PURGE 1 BUCKETS",
        ),
        request=_build_request(path="/api/storage-ops/buckets/purge/stream", query_string=b""),
        user=SimpleNamespace(id=1, email="ops@example.test", role=UserRole.UI_ADMIN.value),
        db=SimpleNamespace(),
    )

    assert response == "stream"
    assert captured["account_refs"] == ["s3u-1"]
    target = captured["targets"][0]
    assert target.bucket_name == "bucket-a"
    assert target.context_id == "s3u-1"
    assert target.context_name == "S3 User 1"
    assert captured["options"].parallelism == 10
    assert captured["options"].individual_deletes is False
