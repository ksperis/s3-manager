# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from starlette.requests import Request

from app.models.app_settings import AppSettings
from app.models.ceph_admin import CephAdminBucketConfigDiff, CephAdminBucketContentDiff
from app.models.manager_bucket_compare import ManagerBucketCompareRequest
from app.routers import dependencies as dependencies_router
from app.routers.manager import buckets as buckets_router


def _build_request(account_id: str | None = None) -> Request:
    query_string = f"account_id={account_id}".encode("utf-8") if account_id else b""
    scope = {
        "type": "http",
        "method": "POST",
        "path": "/api/manager/buckets/compare",
        "query_string": query_string,
        "headers": [],
    }
    return Request(scope)


def _build_account(account_id: int):
    return SimpleNamespace(id=account_id)


def test_compare_bucket_pair_returns_diff_and_config(monkeypatch):
    payload = ManagerBucketCompareRequest(
        target_context_id="2",
        source_bucket="bucket-a",
        target_bucket="bucket-b",
        include_config=True,
        size_only=False,
    )
    source_account = _build_account(1)
    target_account = _build_account(2)

    def fake_get_account_context(*, account_ref, **_kwargs):
        assert account_ref == "2"
        return target_account

    def fake_compare_content(self, source_bucket, source_ctx, target_bucket, target_ctx, **kwargs):
        assert source_bucket == "bucket-a"
        assert target_bucket == "bucket-b"
        assert source_ctx is source_account
        assert target_ctx is target_account
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

    monkeypatch.setattr(buckets_router, "get_account_context", fake_get_account_context)
    monkeypatch.setattr(buckets_router.BucketsService, "compare_bucket_content", fake_compare_content)
    monkeypatch.setattr(
        buckets_router.BucketsService,
        "compare_bucket_configuration",
        lambda *_args, **_kwargs: CephAdminBucketConfigDiff(changed=False, sections=[]),
    )

    response = buckets_router.compare_bucket_pair(
        payload=payload,
        request=_build_request(account_id="1"),
        db=SimpleNamespace(),
        source_account=source_account,
        actor=SimpleNamespace(),
        service=buckets_router.BucketsService(),
    )

    assert response.source_context_id == "1"
    assert response.target_context_id == "2"
    assert response.source_bucket == "bucket-a"
    assert response.target_bucket == "bucket-b"
    assert response.content_diff is not None
    assert response.content_diff.different_count == 1
    assert response.config_diff is not None
    assert response.has_differences is True


def test_compare_bucket_pair_returns_no_diff(monkeypatch):
    payload = ManagerBucketCompareRequest(
        target_context_id="2",
        source_bucket="bucket-a",
        target_bucket="bucket-a",
        include_config=False,
        size_only=True,
    )
    source_account = _build_account(1)
    target_account = _build_account(2)
    monkeypatch.setattr(buckets_router, "get_account_context", lambda **_kwargs: target_account)
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

    response = buckets_router.compare_bucket_pair(
        payload=payload,
        request=_build_request(account_id="1"),
        db=SimpleNamespace(),
        source_account=source_account,
        actor=SimpleNamespace(),
        service=buckets_router.BucketsService(),
    )

    assert response.has_differences is False
    assert response.config_diff is None


def test_compare_bucket_pair_translates_runtime_errors(monkeypatch):
    payload = ManagerBucketCompareRequest(
        target_context_id="2",
        source_bucket="bucket-a",
        target_bucket="bucket-b",
    )
    source_account = _build_account(1)
    target_account = _build_account(2)
    monkeypatch.setattr(buckets_router, "get_account_context", lambda **_kwargs: target_account)

    def failing_compare(*_args, **_kwargs):
        raise RuntimeError("target bucket not found")

    monkeypatch.setattr(buckets_router.BucketsService, "compare_bucket_content", failing_compare)

    with pytest.raises(HTTPException) as exc:
        buckets_router.compare_bucket_pair(
            payload=payload,
            request=_build_request(account_id="1"),
            db=SimpleNamespace(),
            source_account=source_account,
            actor=SimpleNamespace(),
            service=buckets_router.BucketsService(),
        )

    assert exc.value.status_code == 502
    assert "target bucket not found" in str(exc.value.detail)


def test_compare_bucket_pair_supports_config_only(monkeypatch):
    payload = ManagerBucketCompareRequest(
        target_context_id="2",
        source_bucket="bucket-a",
        target_bucket="bucket-b",
        include_content=False,
        include_config=True,
    )
    source_account = _build_account(1)
    target_account = _build_account(2)
    monkeypatch.setattr(buckets_router, "get_account_context", lambda **_kwargs: target_account)

    def should_not_compare_content(*_args, **_kwargs):
        raise AssertionError("compare_bucket_content should not be called in config-only mode")

    monkeypatch.setattr(buckets_router.BucketsService, "compare_bucket_content", should_not_compare_content)
    monkeypatch.setattr(
        buckets_router.BucketsService,
        "compare_bucket_configuration",
        lambda *_args, **_kwargs: CephAdminBucketConfigDiff(changed=True, sections=[]),
    )

    response = buckets_router.compare_bucket_pair(
        payload=payload,
        request=_build_request(account_id="1"),
        db=SimpleNamespace(),
        source_account=source_account,
        actor=SimpleNamespace(),
        service=buckets_router.BucketsService(),
    )

    assert response.compare_mode is None
    assert response.content_diff is None
    assert response.config_diff is not None
    assert response.has_differences is True


def test_compare_bucket_pair_forwards_selected_config_features(monkeypatch):
    payload = ManagerBucketCompareRequest(
        target_context_id="2",
        source_bucket="bucket-a",
        target_bucket="bucket-b",
        include_content=False,
        include_config=True,
        config_features=["tags", "versioning_status"],
    )
    source_account = _build_account(1)
    target_account = _build_account(2)
    monkeypatch.setattr(buckets_router, "get_account_context", lambda **_kwargs: target_account)
    captured: dict[str, object] = {}

    def should_not_compare_content(*_args, **_kwargs):
        raise AssertionError("compare_bucket_content should not be called in config-only mode")

    def fake_compare_config(self, source_bucket, source_ctx, target_bucket, target_ctx, **kwargs):
        captured["source_bucket"] = source_bucket
        captured["source_ctx"] = source_ctx
        captured["target_bucket"] = target_bucket
        captured["target_ctx"] = target_ctx
        captured["include_sections"] = kwargs.get("include_sections")
        return CephAdminBucketConfigDiff(changed=False, sections=[])

    monkeypatch.setattr(buckets_router.BucketsService, "compare_bucket_content", should_not_compare_content)
    monkeypatch.setattr(buckets_router.BucketsService, "compare_bucket_configuration", fake_compare_config)

    response = buckets_router.compare_bucket_pair(
        payload=payload,
        request=_build_request(account_id="1"),
        db=SimpleNamespace(),
        source_account=source_account,
        actor=SimpleNamespace(),
        service=buckets_router.BucketsService(),
    )

    assert response.has_differences is False
    assert captured["source_bucket"] == "bucket-a"
    assert captured["source_ctx"] is source_account
    assert captured["target_bucket"] == "bucket-b"
    assert captured["target_ctx"] is target_account
    assert captured["include_sections"] == {"tags", "versioning_status"}


def test_compare_bucket_pair_rejects_source_equals_target_for_same_context(monkeypatch):
    payload = ManagerBucketCompareRequest(
        target_context_id="1",
        source_bucket="bucket-a",
        target_bucket="bucket-a",
    )
    source_account = _build_account(1)
    target_account = _build_account(1)
    monkeypatch.setattr(buckets_router, "get_account_context", lambda **_kwargs: target_account)

    with pytest.raises(HTTPException) as exc:
        buckets_router.compare_bucket_pair(
            payload=payload,
            request=_build_request(account_id="1"),
            db=SimpleNamespace(),
            source_account=source_account,
            actor=SimpleNamespace(),
            service=buckets_router.BucketsService(),
        )

    assert exc.value.status_code == 400
    assert "must differ" in str(exc.value.detail).lower()


def test_compare_request_rejects_empty_feature_list_when_config_scope_enabled():
    with pytest.raises(ValidationError):
        ManagerBucketCompareRequest(
            target_context_id="2",
            source_bucket="bucket-a",
            target_bucket="bucket-b",
            include_content=False,
            include_config=True,
            config_features=[],
        )


def test_require_bucket_compare_enabled_blocks_when_feature_disabled(monkeypatch):
    settings = AppSettings()
    settings.general.bucket_compare_enabled = False
    monkeypatch.setattr(dependencies_router, "load_app_settings", lambda: settings)

    with pytest.raises(HTTPException) as exc:
        dependencies_router.require_bucket_compare_enabled()

    assert exc.value.status_code == 403
    assert "bucket compare feature is disabled" in str(exc.value.detail).lower()
