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


def _build_endpoint(*, endpoint_id: int = 1, usage_enabled: bool = True):
    features_yaml = (
        "features:\n"
        "  usage:\n"
        f"    enabled: {'true' if usage_enabled else 'false'}\n"
    )
    return SimpleNamespace(
        id=endpoint_id,
        provider="ceph",
        features_config=features_yaml,
    )


def _build_ctx(*, usage_enabled: bool) -> tuple[SimpleNamespace, FakeRGWAdmin]:
    rgw_admin = FakeRGWAdmin()
    ctx = SimpleNamespace(
        endpoint=_build_endpoint(usage_enabled=usage_enabled),
        rgw_admin=rgw_admin,
        access_key="AKIA_TEST",
        secret_key="SECRET_TEST",
    )
    return ctx, rgw_admin


def test_ceph_admin_bucket_listing_never_requests_stats_when_usage_feature_disabled():
    ctx, rgw_admin = _build_ctx(usage_enabled=False)

    buckets_router.list_buckets(
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

    assert rgw_admin.with_stats_calls == [False]


def test_ceph_admin_account_metrics_requires_usage_feature():
    ctx, rgw_admin = _build_ctx(usage_enabled=False)

    with pytest.raises(HTTPException) as exc:
        accounts_router.get_rgw_account_metrics(account_id="RGW0001", ctx=ctx)

    assert exc.value.status_code == 403
    assert rgw_admin.with_stats_calls == []


def test_ceph_admin_user_metrics_requires_usage_feature():
    ctx, rgw_admin = _build_ctx(usage_enabled=False)

    with pytest.raises(HTTPException) as exc:
        users_router.get_rgw_user_metrics(user_id="user-a", tenant=None, ctx=ctx)

    assert exc.value.status_code == 403
    assert rgw_admin.with_stats_calls == []
