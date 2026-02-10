# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from types import SimpleNamespace

import pytest

from app.routers.ceph_admin import buckets as buckets_router


class FakeRGWAdmin:
    def __init__(self, payload: list[dict]):
        self._payload = payload
        self.get_all_buckets_calls = 0
        self.get_account_calls = 0
        self.get_user_calls = 0

    def get_all_buckets(self, with_stats: bool = True):
        self.get_all_buckets_calls += 1
        return self._payload

    def get_bucket_info(self, bucket_name: str, stats: bool = True, allow_not_found: bool = False):
        for entry in self._payload:
            if entry.get("name") == bucket_name or entry.get("bucket") == bucket_name:
                return entry
        return {"not_found": True} if allow_not_found else None

    def get_account(self, owner_id: str, allow_not_found: bool = True):
        self.get_account_calls += 1
        return {"id": owner_id, "name": f"Owner-{owner_id}"}

    def get_user(self, uid: str, tenant: str | None = None, allow_not_found: bool = True):
        self.get_user_calls += 1
        return {"user": {"uid": uid, "display_name": f"User-{uid}"}}


@pytest.fixture(autouse=True)
def clear_buckets_listing_cache():
    with buckets_router._BUCKET_LIST_CACHE_LOCK:
        buckets_router._BUCKET_LIST_CACHE.clear()
    with buckets_router._RGW_BUCKET_PAYLOAD_CACHE_LOCK:
        buckets_router._RGW_BUCKET_PAYLOAD_CACHE.clear()
    yield
    with buckets_router._BUCKET_LIST_CACHE_LOCK:
        buckets_router._BUCKET_LIST_CACHE.clear()
    with buckets_router._RGW_BUCKET_PAYLOAD_CACHE_LOCK:
        buckets_router._RGW_BUCKET_PAYLOAD_CACHE.clear()


def _build_ctx(endpoint_id: int, payload: list[dict]):
    rgw_admin = FakeRGWAdmin(payload)
    ctx = SimpleNamespace(
        endpoint=SimpleNamespace(id=endpoint_id),
        rgw_admin=rgw_admin,
        access_key="AKIA_TEST",
        secret_key="SECRET_TEST",
    )
    return ctx, rgw_admin


def test_ceph_admin_bucket_listing_cache_is_reused_across_pages():
    payload = [
        {"name": "bucket-a", "owner": "owner-a"},
        {"name": "bucket-b", "owner": "owner-b"},
        {"name": "bucket-c", "owner": "owner-c"},
        {"name": "bucket-d", "owner": "owner-d"},
    ]
    ctx, rgw_admin = _build_ctx(endpoint_id=17, payload=payload)

    first = buckets_router.list_buckets(
        page=1,
        page_size=2,
        filter=None,
        advanced_filter=None,
        sort_by="name",
        sort_dir="asc",
        include=[],
        with_stats=False,
        ctx=ctx,
    )
    second = buckets_router.list_buckets(
        page=2,
        page_size=2,
        filter=None,
        advanced_filter=None,
        sort_by="name",
        sort_dir="asc",
        include=[],
        with_stats=False,
        ctx=ctx,
    )

    assert [item.name for item in first.items] == ["bucket-a", "bucket-b"]
    assert [item.name for item in second.items] == ["bucket-c", "bucket-d"]
    assert rgw_admin.get_all_buckets_calls == 1


def test_ceph_admin_bucket_listing_cache_can_be_invalidated_per_endpoint():
    payload = [{"name": "bucket-a", "owner": "owner-a"}, {"name": "bucket-b", "owner": "owner-b"}]
    ctx, rgw_admin = _build_ctx(endpoint_id=42, payload=payload)

    buckets_router.list_buckets(
        page=1,
        page_size=25,
        filter=None,
        advanced_filter=None,
        sort_by="name",
        sort_dir="asc",
        include=[],
        with_stats=False,
        ctx=ctx,
    )
    buckets_router._invalidate_bucket_listing_cache(ctx.endpoint.id)
    buckets_router.list_buckets(
        page=1,
        page_size=25,
        filter=None,
        advanced_filter=None,
        sort_by="name",
        sort_dir="asc",
        include=[],
        with_stats=False,
        ctx=ctx,
    )

    assert rgw_admin.get_all_buckets_calls == 2


def test_ceph_admin_bucket_listing_cache_does_not_leak_owner_name_mutations():
    payload = [
        {"name": "bucket-a", "owner": "RGW00000000000000001"},
        {"name": "bucket-b", "owner": "RGW00000000000000002"},
    ]
    ctx, rgw_admin = _build_ctx(endpoint_id=73, payload=payload)

    with_owner_name = buckets_router.list_buckets(
        page=1,
        page_size=25,
        filter=None,
        advanced_filter=None,
        sort_by="name",
        sort_dir="asc",
        include=["owner_name"],
        with_stats=False,
        ctx=ctx,
    )
    without_owner_name = buckets_router.list_buckets(
        page=1,
        page_size=25,
        filter=None,
        advanced_filter=None,
        sort_by="name",
        sort_dir="asc",
        include=[],
        with_stats=False,
        ctx=ctx,
    )

    assert all(item.owner_name for item in with_owner_name.items)
    assert all(item.owner_name is None for item in without_owner_name.items)
    assert rgw_admin.get_all_buckets_calls == 1


def test_ceph_admin_bucket_listing_cache_is_reused_for_quick_filter_changes():
    payload = [
        {"name": "alpha-bucket", "owner": "owner-a"},
        {"name": "beta-bucket", "owner": "owner-b"},
        {"name": "gamma-bucket", "owner": "owner-c"},
    ]
    ctx, rgw_admin = _build_ctx(endpoint_id=91, payload=payload)

    first = buckets_router.list_buckets(
        page=1,
        page_size=25,
        filter="a",
        advanced_filter=None,
        sort_by="name",
        sort_dir="asc",
        include=[],
        with_stats=False,
        ctx=ctx,
    )
    second = buckets_router.list_buckets(
        page=1,
        page_size=25,
        filter="al",
        advanced_filter=None,
        sort_by="name",
        sort_dir="asc",
        include=[],
        with_stats=False,
        ctx=ctx,
    )

    assert [item.name for item in first.items] == ["alpha-bucket", "beta-bucket", "gamma-bucket"]
    assert [item.name for item in second.items] == ["alpha-bucket"]
    assert rgw_admin.get_all_buckets_calls == 1
