# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.models.ceph_admin import (
    CephAdminBucketCompareRequest,
    CephAdminBucketConfigDiff,
    CephAdminBucketContentDiff,
)
from app.routers.ceph_admin import buckets as buckets_router


def _build_ctx(endpoint_id: int = 1):
    endpoint = SimpleNamespace(
        id=endpoint_id,
        provider="ceph",
        endpoint_url="https://source.example.test",
        region="",
        features_config="features:\n  admin:\n    enabled: true\n",
        ceph_admin_access_key="AKIA_SOURCE",
        ceph_admin_secret_key="SOURCE_SECRET",
    )
    return SimpleNamespace(
        endpoint=endpoint,
        rgw_admin=SimpleNamespace(),
        access_key="AKIA_SOURCE",
        secret_key="SOURCE_SECRET",
    )


def _build_target_endpoint(endpoint_id: int = 2):
    return SimpleNamespace(
        id=endpoint_id,
        provider="ceph",
        endpoint_url="https://target.example.test",
        region="",
        features_config="features:\n  admin:\n    enabled: true\n",
        ceph_admin_access_key="AKIA_TARGET",
        ceph_admin_secret_key="TARGET_SECRET",
    )


def test_compare_bucket_pair_returns_diff_and_config(monkeypatch):
    payload = CephAdminBucketCompareRequest(
        target_endpoint_id=2,
        source_bucket="bucket-a",
        target_bucket="bucket-b",
        include_config=True,
        size_only=False,
    )
    monkeypatch.setattr(buckets_router, "_resolve_storage_endpoint", lambda _db, _endpoint_id: _build_target_endpoint(2))

    def fake_compare_content(self, source_bucket, source_account, target_bucket, target_account, **kwargs):
        assert source_bucket == "bucket-a"
        assert target_bucket == "bucket-b"
        assert kwargs["size_only"] is False
        return CephAdminBucketContentDiff(
            compare_mode="md5_or_size",
            source_count=10,
            target_count=9,
            matched_count=8,
            different_count=1,
            only_source_count=1,
            only_target_count=0,
            only_source_sample=["logs/a.txt"],
            only_target_sample=[],
            different_sample=[],
        )

    monkeypatch.setattr(buckets_router.BucketsService, "compare_bucket_content", fake_compare_content)
    monkeypatch.setattr(
        buckets_router.BucketsService,
        "compare_bucket_configuration",
        lambda *_args, **_kwargs: CephAdminBucketConfigDiff(changed=False, sections=[]),
    )

    response = buckets_router.compare_bucket_pair(endpoint_id=1, payload=payload, db=SimpleNamespace(), ctx=_build_ctx(1))

    assert response.source_endpoint_id == 1
    assert response.target_endpoint_id == 2
    assert response.source_bucket == "bucket-a"
    assert response.target_bucket == "bucket-b"
    assert response.content_diff.different_count == 1
    assert response.config_diff is not None
    assert response.has_differences is True


def test_compare_bucket_pair_returns_no_diff(monkeypatch):
    payload = CephAdminBucketCompareRequest(
        target_endpoint_id=2,
        source_bucket="bucket-a",
        target_bucket="bucket-a",
        include_config=False,
        size_only=True,
    )
    monkeypatch.setattr(buckets_router, "_resolve_storage_endpoint", lambda _db, _endpoint_id: _build_target_endpoint(2))
    monkeypatch.setattr(
        buckets_router.BucketsService,
        "compare_bucket_content",
        lambda *_args, **_kwargs: CephAdminBucketContentDiff(
            compare_mode="size_only",
            source_count=5,
            target_count=5,
            matched_count=5,
            different_count=0,
            only_source_count=0,
            only_target_count=0,
            only_source_sample=[],
            only_target_sample=[],
            different_sample=[],
        ),
    )

    response = buckets_router.compare_bucket_pair(endpoint_id=1, payload=payload, db=SimpleNamespace(), ctx=_build_ctx(1))

    assert response.has_differences is False
    assert response.config_diff is None


def test_compare_bucket_pair_translates_service_runtime_errors(monkeypatch):
    payload = CephAdminBucketCompareRequest(
        target_endpoint_id=2,
        source_bucket="bucket-a",
        target_bucket="bucket-b",
    )
    monkeypatch.setattr(buckets_router, "_resolve_storage_endpoint", lambda _db, _endpoint_id: _build_target_endpoint(2))

    def failing_compare(*_args, **_kwargs):
        raise RuntimeError("target bucket not found")

    monkeypatch.setattr(buckets_router.BucketsService, "compare_bucket_content", failing_compare)

    with pytest.raises(HTTPException) as exc:
        buckets_router.compare_bucket_pair(endpoint_id=1, payload=payload, db=SimpleNamespace(), ctx=_build_ctx(1))

    assert exc.value.status_code == 502
    assert "target bucket not found" in str(exc.value.detail)
