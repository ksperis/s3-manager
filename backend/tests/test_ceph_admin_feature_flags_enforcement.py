# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.routers.ceph_admin import accounts as accounts_router
from app.routers.ceph_admin import buckets as buckets_router
from app.routers.ceph_admin import users as users_router


class FakeRGWAdmin:
    def __init__(self) -> None:
        self.with_stats_calls: list[bool] = []

    def get_all_buckets(self, with_stats: bool = True, **_: object):
        self.with_stats_calls.append(bool(with_stats))
        return {"buckets": []}


@pytest.fixture(autouse=True)
def _clear_buckets_caches():
    with buckets_router._BUCKET_LIST_CACHE_LOCK:
        buckets_router._BUCKET_LIST_CACHE.clear()
    with buckets_router._RGW_BUCKET_PAYLOAD_CACHE_LOCK:
        buckets_router._RGW_BUCKET_PAYLOAD_CACHE.clear()
    yield
    with buckets_router._BUCKET_LIST_CACHE_LOCK:
        buckets_router._BUCKET_LIST_CACHE.clear()
    with buckets_router._RGW_BUCKET_PAYLOAD_CACHE_LOCK:
        buckets_router._RGW_BUCKET_PAYLOAD_CACHE.clear()


def _build_endpoint(*, endpoint_id: int = 1, metrics_enabled: bool = True, sse_enabled: bool = False):
    features_yaml = (
        "features:\n"
        "  metrics:\n"
        f"    enabled: {'true' if metrics_enabled else 'false'}\n"
        "  sse:\n"
        f"    enabled: {'true' if sse_enabled else 'false'}\n"
    )
    return SimpleNamespace(
        id=endpoint_id,
        provider="ceph",
        features_config=features_yaml,
    )


def _build_ctx(*, metrics_enabled: bool, sse_enabled: bool = False) -> tuple[SimpleNamespace, FakeRGWAdmin]:
    rgw_admin = FakeRGWAdmin()
    ctx = SimpleNamespace(
        endpoint=_build_endpoint(metrics_enabled=metrics_enabled, sse_enabled=sse_enabled),
        rgw_admin=rgw_admin,
        access_key="AKIA_TEST",
        secret_key="SECRET_TEST",
    )
    return ctx, rgw_admin


def test_ceph_admin_bucket_listing_can_request_stats_when_metrics_feature_disabled():
    ctx, rgw_admin = _build_ctx(metrics_enabled=False)

    response = buckets_router.list_buckets(
        page=1,
        page_size=25,
        filter=None,
        advanced_filter=None,
        sort_by="name",
        sort_dir="asc",
        include=[],
        with_stats=True,
        ctx=ctx,
    )

    assert rgw_admin.with_stats_calls == [True]
    assert response.stats_available is True
    assert response.stats_warning is None


def test_ceph_admin_bucket_listing_returns_owner_and_usage_without_metrics_feature():
    class StatsPayloadAdmin(FakeRGWAdmin):
        def get_all_buckets(self, with_stats: bool = True, **_: object):
            self.with_stats_calls.append(bool(with_stats))
            return {
                "buckets": [
                    {
                        "name": "bucket-a",
                        "owner": "owner-a",
                        "usage": {"total_bytes": 2048, "total_objects": 5},
                    }
                ]
            }

    ctx = SimpleNamespace(
        endpoint=_build_endpoint(metrics_enabled=False),
        rgw_admin=StatsPayloadAdmin(),
        access_key="AKIA_TEST",
        secret_key="SECRET_TEST",
    )

    response = buckets_router.list_buckets(
        page=1,
        page_size=25,
        filter=None,
        advanced_filter=None,
        sort_by="name",
        sort_dir="asc",
        include=[],
        with_stats=True,
        ctx=ctx,
    )

    assert response.items[0].owner == "owner-a"
    assert response.items[0].used_bytes == 2048
    assert response.items[0].object_count == 5
    assert response.stats_available is True
    assert ctx.rgw_admin.with_stats_calls == [True]


def test_ceph_admin_account_metrics_requires_metrics_feature():
    ctx, rgw_admin = _build_ctx(metrics_enabled=False)

    with pytest.raises(HTTPException) as exc:
        accounts_router.get_rgw_account_metrics(account_id="RGW0001", ctx=ctx)

    assert exc.value.status_code == 403
    assert rgw_admin.with_stats_calls == []


def test_ceph_admin_user_metrics_requires_metrics_feature():
    ctx, rgw_admin = _build_ctx(metrics_enabled=False)

    with pytest.raises(HTTPException) as exc:
        users_router.get_rgw_user_metrics(user_id="user-a", tenant=None, ctx=ctx)

    assert exc.value.status_code == 403
    assert rgw_admin.with_stats_calls == []


def test_ceph_admin_bucket_encryption_requires_sse_feature(monkeypatch):
    ctx, _ = _build_ctx(metrics_enabled=True, sse_enabled=False)
    calls = {"get": 0}

    class _FakeBucketsService:
        def get_bucket_encryption(self, bucket_name, account):
            calls["get"] += 1
            return buckets_router.BucketEncryptionConfiguration(rules=[])

    monkeypatch.setattr(buckets_router, "BucketsService", lambda: _FakeBucketsService())

    with pytest.raises(HTTPException) as exc:
        buckets_router.get_bucket_encryption(bucket_name="bucket-a", ctx=ctx)

    assert exc.value.status_code == 403
    assert calls["get"] == 0


def test_ceph_admin_bucket_encryption_allows_when_sse_feature_enabled(monkeypatch):
    ctx, _ = _build_ctx(metrics_enabled=True, sse_enabled=True)

    class _FakeBucketsService:
        def get_bucket_encryption(self, bucket_name, account):
            return buckets_router.BucketEncryptionConfiguration(
                rules=[{"ApplyServerSideEncryptionByDefault": {"SSEAlgorithm": "AES256"}}]
            )

    monkeypatch.setattr(buckets_router, "BucketsService", lambda: _FakeBucketsService())

    payload = buckets_router.get_bucket_encryption(bucket_name="bucket-a", ctx=ctx)

    assert payload.rules == [{"ApplyServerSideEncryptionByDefault": {"SSEAlgorithm": "AES256"}}]
