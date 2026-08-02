# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import asyncio
import logging
import threading
import time
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from starlette.requests import Request

from app.db import StorageEndpoint, User, UserRole
from app.main import app
from app.models.app_settings import AppSettings
from app.models.bucket_integrity import BucketIntegrityCheckProgress, BucketIntegrityCheckRequest, BucketIntegrityCheckResult
from app.routers.bucket_integrity_stream import stream_bucket_integrity_check
from app.routers import dependencies as dependencies_router
from app.routers.dependencies_internal import settings_loader
from app.routers.ceph_admin import integrity as ceph_integrity
from app.routers.ceph_admin.dependencies import CephAdminContext
from app.routers.manager import integrity as manager_integrity
from app.routers.storage_ops import integrity as storage_ops_integrity
from app.services.bucket_integrity_service import BucketIntegrityCheckCancelled


def _build_request(path: str = "/api/manager/bucket-integrity/stream", query_string: bytes = b"") -> Request:
    return Request(
        {
            "type": "http",
            "method": "POST",
            "path": path,
            "query_string": query_string,
            "headers": [],
        }
    )


def _result(status: str = "passed") -> BucketIntegrityCheckResult:
    return BucketIntegrityCheckResult(
        status=status,
        total_buckets=1,
        completed_buckets=1,
        listed_count=1,
        checked_count=1,
        failed_count=0 if status == "passed" else 1,
        bytes_read=3,
        started_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
        finished_at=datetime(2026, 1, 1, 0, 0, 1, tzinfo=timezone.utc),
        buckets=[],
    )


def _manager_tool_user(*, bucket_integrity_check: bool = True) -> User:
    return User(
        email="integrity-tool@example.com",
        hashed_password="x",
        is_active=True,
        role=UserRole.UI_USER.value,
        can_access_manager_bucket_integrity_check=bucket_integrity_check,
    )


def test_require_bucket_integrity_enabled_blocks_when_feature_disabled(monkeypatch):
    settings = AppSettings()
    settings.general.bucket_integrity_check_enabled = False
    monkeypatch.setattr(settings_loader, "load_app_settings", lambda: settings)

    with pytest.raises(HTTPException) as exc:
        dependencies_router.require_bucket_integrity_check_enabled(_manager_tool_user(), db=None)

    assert exc.value.status_code == 403
    assert "bucket integrity check feature is disabled" in str(exc.value.detail).lower()


def test_require_bucket_integrity_enabled_blocks_without_user_tool_access(monkeypatch):
    settings = AppSettings()
    settings.general.bucket_integrity_check_enabled = True
    monkeypatch.setattr(settings_loader, "load_app_settings", lambda: settings)

    with pytest.raises(HTTPException) as exc:
        dependencies_router.require_bucket_integrity_check_enabled(_manager_tool_user(bucket_integrity_check=False), db=None)

    assert exc.value.status_code == 403
    assert str(exc.value.detail) == "Not authorized"


def test_manager_integrity_route_streams_progress_and_result(monkeypatch):
    captured: dict[str, object] = {}

    class FakeService:
        def run(self, targets, options, *, progress_callback=None, cancel_check=None):
            captured["targets"] = targets
            captured["options"] = options
            if progress_callback:
                progress_callback(
                    BucketIntegrityCheckProgress(
                        stage="verify",
                        bucket_name="bucket-a",
                        total_buckets=1,
                        listed_count=1,
                        checked_count=1,
                        bytes_read=3,
                    )
                )
            return _result()

    previous_overrides = app.dependency_overrides.copy()
    app.dependency_overrides[dependencies_router.require_manager_enabled] = lambda: None
    app.dependency_overrides[manager_integrity.require_bucket_integrity_check_enabled] = lambda: None
    app.dependency_overrides[manager_integrity.get_account_context] = lambda: SimpleNamespace(
        name="Tenant A",
        manager_capabilities=SimpleNamespace(can_manage_buckets=True),
    )
    app.dependency_overrides[manager_integrity.get_current_account_admin] = lambda: SimpleNamespace(id=1)
    monkeypatch.setattr(manager_integrity, "BucketIntegrityCheckService", FakeService)
    try:
        with TestClient(app) as client:
            response = client.post(
                "/api/manager/bucket-integrity/stream?account_id=s3u-1",
                json={"buckets": ["bucket-a"], "parallelism": 4, "check_mode": "get"},
            )
    finally:
        app.dependency_overrides = previous_overrides

    assert response.status_code == 200
    assert "event: progress" in response.text
    assert "event: result" in response.text
    assert '"status":"passed"' in response.text
    targets = captured["targets"]
    assert targets[0].bucket_name == "bucket-a"
    assert targets[0].context_id == "s3u-1"
    assert captured["options"].parallelism == 4
    assert captured["options"].check_mode == "get"


def test_manager_integrity_route_returns_403_when_flag_disabled(monkeypatch):
    settings = AppSettings()
    settings.general.bucket_integrity_check_enabled = False
    monkeypatch.setattr(settings_loader, "load_app_settings", lambda: settings)

    previous_overrides = app.dependency_overrides.copy()
    app.dependency_overrides[dependencies_router.require_manager_enabled] = lambda: None
    app.dependency_overrides[manager_integrity.get_account_context] = lambda: SimpleNamespace(
        name="Tenant A",
        manager_capabilities=SimpleNamespace(can_manage_buckets=True),
    )
    app.dependency_overrides[manager_integrity.get_current_account_admin] = lambda: SimpleNamespace(id=1)
    app.dependency_overrides[dependencies_router.get_current_user] = lambda: _manager_tool_user()
    try:
        with TestClient(app) as client:
            response = client.post(
                "/api/manager/bucket-integrity/stream?account_id=s3u-1",
                json={"buckets": ["bucket-a"]},
            )
    finally:
        app.dependency_overrides = previous_overrides

    assert response.status_code == 403
    assert "Bucket integrity check feature is disabled" in response.text


def test_integrity_stream_waits_for_worker_cleanup_after_disconnect():
    cleanup_finished = threading.Event()

    def run_check(progress_callback, cancel_check):
        progress_callback(BucketIntegrityCheckProgress(stage="prepare", total_buckets=1))
        try:
            while True:
                cancel_check()
                time.sleep(0.01)
        except BucketIntegrityCheckCancelled:
            time.sleep(0.15)
            cleanup_finished.set()
            raise

    async def _run() -> None:
        state = {"calls": 0}

        async def is_disconnected() -> bool:
            state["calls"] += 1
            return state["calls"] >= 2

        response = stream_bucket_integrity_check(
            SimpleNamespace(is_disconnected=is_disconnected),
            run_check=run_check,
            logger=logging.getLogger("test-integrity-stream"),
            failure_message="Integrity stream failed",
        )
        async for _chunk in response.body_iterator:
            pass

    asyncio.run(_run())
    assert cleanup_finished.is_set()


def test_integrity_stream_sanitizes_http_exception_details():
    def run_check(_progress_callback, _cancel_check):
        raise HTTPException(status_code=502, detail="upstream token=leaked at https://rgw.internal/object")

    async def _run() -> str:
        response = stream_bucket_integrity_check(
            SimpleNamespace(is_disconnected=lambda: asyncio.sleep(0, result=False)),
            run_check=run_check,
            logger=logging.getLogger("test-integrity-stream"),
            failure_message="Integrity stream failed",
        )
        chunks: list[str] = []
        async for chunk in response.body_iterator:
            chunks.append(chunk.decode() if isinstance(chunk, bytes) else chunk)
        return "".join(chunks)

    body = asyncio.run(_run())
    assert "event: error" in body
    assert "token=<redacted>" in body
    assert "<redacted-url>" in body
    assert "token=leaked" not in body
    assert "rgw.internal" not in body


def test_ceph_admin_integrity_route_uses_dedicated_endpoint_credentials(monkeypatch):
    captured: dict[str, object] = {}

    class FakeService:
        def run(self, targets, options, *, progress_callback=None, cancel_check=None):
            captured["targets"] = targets
            captured["options"] = options
            return _result()

    def fake_stream(request, *, run_check, logger, failure_message):
        captured["stream_result"] = run_check(lambda progress: None, lambda: None)
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
    monkeypatch.setattr(ceph_integrity, "BucketIntegrityCheckService", FakeService)
    monkeypatch.setattr(ceph_integrity, "stream_bucket_integrity_check", fake_stream)

    response = ceph_integrity.stream_ceph_admin_bucket_integrity_check(
        payload=BucketIntegrityCheckRequest(buckets=["bucket-a"]),
        request=_build_request(path="/api/ceph-admin/endpoints/7/buckets/integrity-check/stream"),
        ctx=ctx,
    )

    assert response == "stream"
    target = captured["targets"][0]
    assert target.bucket_name == "bucket-a"
    assert target.context_id == "ceph-admin-7"
    assert target.account.effective_rgw_credentials() == ("admin-ak", "admin-sk")
    assert captured["options"].check_mode == "head"


def test_storage_ops_integrity_route_resolves_authorized_manager_contexts(monkeypatch):
    captured: dict[str, object] = {}

    class FakeService:
        def run(self, targets, options, *, progress_callback=None, cancel_check=None):
            captured["targets"] = targets
            captured["options"] = options
            return _result()

    def fake_stream(request, *, run_check, logger, failure_message):
        captured["stream_result"] = run_check(lambda progress: None, lambda: None)
        return "stream"

    def fake_get_account_context(*, request, account_ref, actor, db):
        captured.setdefault("account_refs", []).append(account_ref)
        return SimpleNamespace(name=f"Account {account_ref}")

    monkeypatch.setattr(storage_ops_integrity, "BucketIntegrityCheckService", FakeService)
    monkeypatch.setattr(storage_ops_integrity, "stream_bucket_integrity_check", fake_stream)
    monkeypatch.setattr(
        storage_ops_integrity,
        "list_execution_contexts",
        lambda *, workspace, user, db: [SimpleNamespace(id="s3u-1", display_name="S3 User 1")],
    )
    monkeypatch.setattr(storage_ops_integrity, "get_account_context", fake_get_account_context)

    response = storage_ops_integrity.stream_storage_ops_bucket_integrity_check(
        payload=BucketIntegrityCheckRequest(
            targets=[{"context_id": "s3u-1", "bucket_name": "bucket-a"}],
            check_mode="get",
        ),
        request=_build_request(path="/api/storage-ops/buckets/integrity-check/stream"),
        user=SimpleNamespace(id=1),
        db=SimpleNamespace(),
    )

    assert response == "stream"
    assert captured["account_refs"] == ["s3u-1"]
    target = captured["targets"][0]
    assert target.bucket_name == "bucket-a"
    assert target.context_id == "s3u-1"
    assert target.context_name == "S3 User 1"
    assert captured["options"].check_mode == "get"
