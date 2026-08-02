# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.main import app
from app.models.ceph_admin import (
    CephAdminBucketIndexCheckBatchRequest,
    CephAdminBucketIndexCheckTarget,
)
from app.routers import dependencies
from app.routers.ceph_admin import admin_ops
from app.services.bucket_index_check_service import BucketIndexCheckCancelled, BucketIndexCheckService
from app.services.rgw_admin import RGWAdminOperationResponse


class FakeAdmin:
    def __init__(self) -> None:
        self.calls: list[tuple[str, dict]] = []

    def check_bucket_index_operation(self, bucket: str, **kwargs):
        self.calls.append((bucket, kwargs))
        if bucket == "bucket-b":
            return RGWAdminOperationResponse(
                status_code=409,
                success=False,
                error_code="IndexError",
                message="index mismatch",
                result={"checked": False},
            )
        return RGWAdminOperationResponse(
            status_code=200,
            success=True,
            error_code=None,
            message="index clean",
            result={"checked": True},
        )


def test_batch_request_deduplicates_tenant_bucket_targets_and_caps_size():
    payload = CephAdminBucketIndexCheckBatchRequest(
        targets=[
            {"name": "bucket-a", "tenant": "tenant-a"},
            {"name": " bucket-a ", "tenant": " tenant-a "},
            {"name": "bucket-a", "tenant": "tenant-b"},
        ]
    )

    assert [(target.tenant, target.name) for target in payload.targets] == [
        ("tenant-a", "bucket-a"),
        ("tenant-b", "bucket-a"),
    ]

    with pytest.raises(ValidationError):
        CephAdminBucketIndexCheckBatchRequest(targets=[{"name": f"bucket-{index}"} for index in range(201)])


def test_batch_service_is_read_only_and_keeps_partial_results():
    service = BucketIndexCheckService()
    progress = []
    admin = FakeAdmin()

    result = service.run(
        admin,
        [CephAdminBucketIndexCheckTarget(name="bucket-a"), CephAdminBucketIndexCheckTarget(name="bucket-b")],
        endpoint_id=7,
        endpoint_name="Lab",
        parallelism=2,
        progress_callback=progress.append,
    )

    assert result.status == "completed_with_errors"
    assert result.completed_buckets == 2
    assert result.failed_buckets == 1
    assert {item.name: item.status for item in result.buckets} == {
        "bucket-a": "completed",
        "bucket-b": "failed",
    }
    assert all(call == {"tenant": None, "fix": False, "check_objects": False} for _, call in admin.calls)
    assert not hasattr(service, "_audit")
    assert progress[0].stage == "prepare"
    assert progress[-1].completed_buckets == 2


def test_batch_service_honors_cooperative_cancellation():
    service = BucketIndexCheckService()

    with pytest.raises(BucketIndexCheckCancelled):
        service.run(
            FakeAdmin(),
            [CephAdminBucketIndexCheckTarget(name="bucket-a")],
            endpoint_id=7,
            endpoint_name="Lab",
            parallelism=1,
            cancel_check=lambda: (_ for _ in ()).throw(BucketIndexCheckCancelled()),
        )


def test_batch_route_builds_stream_runner_and_invalidates_once(client: TestClient, monkeypatch):
    captured: dict[str, object] = {}
    ctx = SimpleNamespace(
        endpoint=SimpleNamespace(id=7, name="Lab"),
        rgw_admin=FakeAdmin(),
        actor=SimpleNamespace(id=1, email="admin@example.test", role="ui_superadmin"),
    )

    class FakeService:
        def __init__(self, *_args, **_kwargs):
            pass

        def run(self, rgw_admin, targets, **kwargs):
            captured["rgw_admin"] = rgw_admin
            captured["targets"] = targets
            captured["parallelism"] = kwargs["parallelism"]
            return SimpleNamespace(status="completed")

    def fake_stream(_request, *, run_check, **_kwargs):
        result = run_check(lambda _event: None, lambda: None)
        return JSONResponse({"status": result.status})

    invalidated: list[int] = []
    monkeypatch.setattr(admin_ops, "BucketIndexCheckService", FakeService)
    monkeypatch.setattr(admin_ops, "stream_bucket_index_checks", fake_stream)
    monkeypatch.setattr(admin_ops, "_invalidate_bucket_admin_ops_caches", invalidated.append)
    app.dependency_overrides[dependencies.require_ceph_admin_enabled] = lambda: None
    app.dependency_overrides[admin_ops.get_ceph_admin_context] = lambda: ctx

    try:
        response = client.post(
            "/api/ceph-admin/endpoints/7/bucket-index-check/stream",
            json={
                "targets": [
                    {"name": "bucket-a", "tenant": "tenant-a"},
                    {"name": "bucket-a", "tenant": "tenant-a"},
                ],
                "parallelism": 6,
            },
        )
    finally:
        app.dependency_overrides.pop(dependencies.require_ceph_admin_enabled, None)
        app.dependency_overrides.pop(admin_ops.get_ceph_admin_context, None)

    assert response.status_code == 200, response.text
    assert response.json() == {"status": "completed"}
    assert [(target.tenant, target.name) for target in captured["targets"]] == [("tenant-a", "bucket-a")]
    assert captured["parallelism"] == 6
    assert invalidated == [7]
