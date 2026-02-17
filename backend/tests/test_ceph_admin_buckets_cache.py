# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import json
from types import SimpleNamespace

import pytest

from app.models.ceph_admin import CephAdminBucketSummary
from app.routers.ceph_admin import buckets as buckets_router


class FakeRGWAdmin:
    def __init__(self, payload: list[dict]):
        self._payload = payload
        self.get_all_buckets_calls = 0
        self.get_bucket_info_calls = 0
        self.get_account_calls = 0
        self.get_user_calls = 0

    def get_all_buckets(self, with_stats: bool = True):
        self.get_all_buckets_calls += 1
        return self._payload

    def get_bucket_info(self, bucket_name: str, stats: bool = True, allow_not_found: bool = False):
        self.get_bucket_info_calls += 1
        for entry in self._payload:
            if entry.get("name") == bucket_name or entry.get("bucket") == bucket_name:
                return entry
        return {"not_found": True} if allow_not_found else None

    def get_account(self, owner_id: str, allow_not_found: bool = True):
        self.get_account_calls += 1
        return {"id": owner_id, "name": f"Owner-{owner_id}"}

    def get_user(self, uid: str, tenant: str | None = None, allow_not_found: bool = True):
        self.get_user_calls += 1
        return {"uid": uid, "display_name": f"User-{uid}"}


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


def test_ceph_admin_bucket_listing_name_filter_uses_single_bulk_rgw_call():
    payload = [
        {"name": "bucket-a", "owner": "owner-a"},
        {"name": "bucket-b", "owner": "owner-b"},
        {"name": "bucket-c", "owner": "owner-c"},
    ]
    ctx, rgw_admin = _build_ctx(endpoint_id=109, payload=payload)

    first_filter = json.dumps(
        {
            "match": "any",
            "rules": [{"field": "name", "op": "in", "value": ["bucket-a", "bucket-c"]}],
        }
    )
    second_filter = json.dumps(
        {
            "match": "any",
            "rules": [{"field": "name", "op": "in", "value": ["bucket-b"]}],
        }
    )

    first = buckets_router.list_buckets(
        page=1,
        page_size=25,
        filter=None,
        advanced_filter=first_filter,
        sort_by="name",
        sort_dir="asc",
        include=[],
        with_stats=False,
        ctx=ctx,
    )
    second = buckets_router.list_buckets(
        page=1,
        page_size=25,
        filter=None,
        advanced_filter=second_filter,
        sort_by="name",
        sort_dir="asc",
        include=[],
        with_stats=False,
        ctx=ctx,
    )

    assert [item.name for item in first.items] == ["bucket-a", "bucket-c"]
    assert [item.name for item in second.items] == ["bucket-b"]
    assert rgw_admin.get_all_buckets_calls == 1
    assert rgw_admin.get_bucket_info_calls == 0


def test_ceph_admin_bucket_listing_owner_filter_requires_top_level_owner():
    payload = [
        {"bucket": "bucket-a", "owner": "RGW00000000000000001"},
        {"bucket": "bucket-b", "owner": "RGW00000000000000002"},
    ]
    ctx, rgw_admin = _build_ctx(endpoint_id=151, payload=payload)

    owner_filter = json.dumps(
        {
            "match": "all",
            "rules": [{"field": "owner", "op": "contains", "value": "RGW00000000000000001"}],
        }
    )

    response = buckets_router.list_buckets(
        page=1,
        page_size=25,
        filter=None,
        advanced_filter=owner_filter,
        sort_by="name",
        sort_dir="asc",
        include=[],
        with_stats=False,
        ctx=ctx,
    )

    assert [item.name for item in response.items] == ["bucket-a"]
    assert response.items[0].owner == "RGW00000000000000001"
    assert rgw_admin.get_all_buckets_calls == 1


def test_ceph_admin_bucket_listing_any_mixed_filter_prefers_bulk_field_rules(monkeypatch: pytest.MonkeyPatch):
    payload = [
        {"name": "bucket-a", "owner": "owner-a"},
        {"name": "bucket-b", "owner": "owner-b"},
        {"name": "bucket-c", "owner": "owner-c"},
    ]
    ctx, _ = _build_ctx(endpoint_id=161, payload=payload)
    captured: dict[str, object] = {}

    def fake_enrich(
        buckets: list[CephAdminBucketSummary],
        requested: set[str],
        include_tags: bool,
        service,
        account,
    ) -> list[CephAdminBucketSummary]:
        captured["names"] = [bucket.name for bucket in buckets]
        captured["requested"] = requested
        captured["include_tags"] = include_tags
        enriched: list[CephAdminBucketSummary] = []
        for bucket in buckets:
            base = bucket.model_dump()
            if bucket.name == "bucket-b":
                base["features"] = {"versioning": buckets_router._feature_status_active("Enabled")}
            else:
                base["features"] = {"versioning": buckets_router._feature_status_inactive("Disabled")}
            enriched.append(CephAdminBucketSummary(**base))
        return enriched

    monkeypatch.setattr(buckets_router, "_enrich_buckets", fake_enrich)

    mixed_filter = json.dumps(
        {
            "match": "any",
            "rules": [
                {"field": "owner", "op": "contains", "value": "owner-a"},
                {"feature": "versioning", "state": "enabled"},
            ],
        }
    )

    response = buckets_router.list_buckets(
        page=1,
        page_size=25,
        filter=None,
        advanced_filter=mixed_filter,
        sort_by="name",
        sort_dir="asc",
        include=[],
        with_stats=False,
        ctx=ctx,
    )

    assert captured["names"] == ["bucket-b", "bucket-c"]
    assert captured["requested"] == {"versioning"}
    assert captured["include_tags"] is False
    assert [item.name for item in response.items] == ["bucket-a", "bucket-b"]


def test_ceph_admin_bucket_listing_tag_filter_matches_s3_tags(monkeypatch: pytest.MonkeyPatch):
    payload = [
        {"name": "bucket-a", "owner": "owner-a"},
        {"name": "bucket-b", "owner": "owner-b"},
    ]
    ctx, _ = _build_ctx(endpoint_id=171, payload=payload)

    def fake_enrich(
        buckets: list[CephAdminBucketSummary],
        requested: set[str],
        include_tags: bool,
        service,
        account,
    ) -> list[CephAdminBucketSummary]:
        assert requested == set()
        assert include_tags is True
        enriched: list[CephAdminBucketSummary] = []
        for bucket in buckets:
            base = bucket.model_dump()
            if bucket.name == "bucket-a":
                base["tags"] = [{"key": "env", "value": "prod"}]
            else:
                base["tags"] = [{"key": "env", "value": "dev"}]
            enriched.append(CephAdminBucketSummary(**base))
        return enriched

    monkeypatch.setattr(buckets_router, "_enrich_buckets", fake_enrich)

    tag_filter = json.dumps(
        {
            "match": "all",
            "rules": [{"field": "tag", "op": "contains", "value": "env=prod"}],
        }
    )

    response = buckets_router.list_buckets(
        page=1,
        page_size=25,
        filter=None,
        advanced_filter=tag_filter,
        sort_by="name",
        sort_dir="asc",
        include=[],
        with_stats=False,
        ctx=ctx,
    )

    assert [item.name for item in response.items] == ["bucket-a"]


def test_ceph_admin_bucket_listing_any_tag_filter_prefers_bulk_field_rules(monkeypatch: pytest.MonkeyPatch):
    payload = [
        {"name": "bucket-a", "owner": "owner-a"},
        {"name": "bucket-b", "owner": "owner-b"},
        {"name": "bucket-c", "owner": "owner-c"},
    ]
    ctx, _ = _build_ctx(endpoint_id=172, payload=payload)
    captured: dict[str, object] = {}

    def fake_enrich(
        buckets: list[CephAdminBucketSummary],
        requested: set[str],
        include_tags: bool,
        service,
        account,
    ) -> list[CephAdminBucketSummary]:
        captured["names"] = [bucket.name for bucket in buckets]
        captured["requested"] = requested
        captured["include_tags"] = include_tags
        enriched: list[CephAdminBucketSummary] = []
        for bucket in buckets:
            base = bucket.model_dump()
            base["tags"] = [{"key": "env", "value": "prod"}] if bucket.name == "bucket-c" else [{"key": "env", "value": "dev"}]
            enriched.append(CephAdminBucketSummary(**base))
        return enriched

    monkeypatch.setattr(buckets_router, "_enrich_buckets", fake_enrich)

    mixed_filter = json.dumps(
        {
            "match": "any",
            "rules": [
                {"field": "owner", "op": "contains", "value": "owner-a"},
                {"field": "tag", "op": "contains", "value": "env=prod"},
            ],
        }
    )

    response = buckets_router.list_buckets(
        page=1,
        page_size=25,
        filter=None,
        advanced_filter=mixed_filter,
        sort_by="name",
        sort_dir="asc",
        include=[],
        with_stats=False,
        ctx=ctx,
    )

    assert captured["names"] == ["bucket-b", "bucket-c"]
    assert captured["requested"] == set()
    assert captured["include_tags"] is True
    assert [item.name for item in response.items] == ["bucket-a", "bucket-c"]


def test_ceph_admin_bucket_listing_owner_name_lookup_deduplicates_same_owner():
    payload = [
        {"name": "bucket-a", "owner": "RGW00000000000000001"},
        {"name": "bucket-b", "owner": "RGW00000000000000001"},
        {"name": "bucket-c", "owner": "RGW00000000000000001"},
    ]
    ctx, rgw_admin = _build_ctx(endpoint_id=173, payload=payload)

    response = buckets_router.list_buckets(
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

    assert [item.owner_name for item in response.items] == ["Owner-RGW00000000000000001"] * 3
    assert rgw_admin.get_account_calls == 1


def test_ceph_admin_bucket_listing_owner_name_filter_accounts_only_limits_rgw_calls():
    payload = [
        {"name": "bucket-account", "owner": "RGW00000000000000001"},
        {"name": "bucket-user", "owner": "user-alpha"},
    ]
    ctx, rgw_admin = _build_ctx(endpoint_id=181, payload=payload)

    advanced_filter = json.dumps(
        {
            "match": "all",
            "rules": [
                {"field": "owner_name", "op": "contains", "value": "owner-rgw00000000000000001"},
                {"field": "owner_kind", "op": "eq", "value": "account"},
            ],
        }
    )

    response = buckets_router.list_buckets(
        page=1,
        page_size=25,
        filter=None,
        advanced_filter=advanced_filter,
        sort_by="name",
        sort_dir="asc",
        include=[],
        with_stats=False,
        ctx=ctx,
    )

    assert [item.name for item in response.items] == ["bucket-account"]
    assert rgw_admin.get_account_calls == 1
    assert rgw_admin.get_user_calls == 0


def test_ceph_admin_bucket_listing_owner_name_filter_users_only_limits_rgw_calls():
    payload = [
        {"name": "bucket-account", "owner": "RGW00000000000000001"},
        {"name": "bucket-user", "owner": "user-alpha"},
    ]
    ctx, rgw_admin = _build_ctx(endpoint_id=182, payload=payload)

    advanced_filter = json.dumps(
        {
            "match": "all",
            "rules": [
                {"field": "owner_name", "op": "contains", "value": "user-user-alpha"},
                {"field": "owner_kind", "op": "eq", "value": "user"},
            ],
        }
    )

    response = buckets_router.list_buckets(
        page=1,
        page_size=25,
        filter=None,
        advanced_filter=advanced_filter,
        sort_by="name",
        sort_dir="asc",
        include=[],
        with_stats=False,
        ctx=ctx,
    )

    assert [item.name for item in response.items] == ["bucket-user"]
    assert rgw_admin.get_account_calls == 0
    assert rgw_admin.get_user_calls == 1


def test_ceph_admin_bucket_listing_owner_name_filter_is_strict_for_user_display_name():
    payload = [
        {"name": "bucket-user", "owner": "user-alpha"},
        {"name": "bucket-other", "owner": "user-beta"},
    ]
    ctx, _ = _build_ctx(endpoint_id=183, payload=payload)

    class NoDisplayNameAdmin(FakeRGWAdmin):
        def get_account(self, owner_id: str, allow_not_found: bool = True):
            return None

        def get_user(self, uid: str, tenant: str | None = None, allow_not_found: bool = True):
            return {"user": {"uid": uid}}

    ctx.rgw_admin = NoDisplayNameAdmin(payload)

    advanced_filter = json.dumps(
        {
            "match": "all",
            "rules": [{"field": "owner_name", "op": "contains", "value": "user-alpha"}],
        }
    )

    response = buckets_router.list_buckets(
        page=1,
        page_size=25,
        filter=None,
        advanced_filter=advanced_filter,
        sort_by="name",
        sort_dir="asc",
        include=[],
        with_stats=False,
        ctx=ctx,
    )

    assert [item.name for item in response.items] == []


def test_ceph_admin_bucket_listing_owner_name_filter_is_strict_for_account_name():
    payload = [
        {"name": "bucket-account", "owner": "RGW00000000000000001"},
        {"name": "bucket-other", "owner": "RGW00000000000000002"},
    ]
    ctx, _ = _build_ctx(endpoint_id=184, payload=payload)

    class IdOnlyAccountAdmin(FakeRGWAdmin):
        def get_account(self, owner_id: str, allow_not_found: bool = True):
            return {"id": owner_id}

        def get_user(self, uid: str, tenant: str | None = None, allow_not_found: bool = True):
            return None

    ctx.rgw_admin = IdOnlyAccountAdmin(payload)

    advanced_filter = json.dumps(
        {
            "match": "all",
            "rules": [{"field": "owner_name", "op": "contains", "value": "rgw00000000000000001"}],
        }
    )

    response = buckets_router.list_buckets(
        page=1,
        page_size=25,
        filter=None,
        advanced_filter=advanced_filter,
        sort_by="name",
        sort_dir="asc",
        include=[],
        with_stats=False,
        ctx=ctx,
    )

    assert [item.name for item in response.items] == []


def test_ceph_admin_bucket_listing_owner_name_filter_is_strict_for_account_name_field():
    payload = [
        {"name": "bucket-account", "owner": "RGW00000000000000001"},
        {"name": "bucket-other", "owner": "RGW00000000000000002"},
    ]
    ctx, _ = _build_ctx(endpoint_id=185, payload=payload)

    class AccountNameOnlyAdmin(FakeRGWAdmin):
        def get_account(self, owner_id: str, allow_not_found: bool = True):
            return {"id": owner_id, "account_name": f"Owner-{owner_id}"}

        def get_user(self, uid: str, tenant: str | None = None, allow_not_found: bool = True):
            return None

    ctx.rgw_admin = AccountNameOnlyAdmin(payload)

    advanced_filter = json.dumps(
        {
            "match": "all",
            "rules": [{"field": "owner_name", "op": "contains", "value": "owner-rgw00000000000000001"}],
        }
    )

    response = buckets_router.list_buckets(
        page=1,
        page_size=25,
        filter=None,
        advanced_filter=advanced_filter,
        sort_by="name",
        sort_dir="asc",
        include=[],
        with_stats=False,
        ctx=ctx,
    )

    assert [item.name for item in response.items] == []


def test_ceph_admin_bucket_listing_owner_name_filter_loads_owner_metadata_when_bulk_without_stats():
    class NamesOnlyWithoutStatsAdmin:
        def __init__(self):
            self.calls: list[bool] = []

        def get_all_buckets(self, with_stats: bool = True):
            self.calls.append(with_stats)
            if with_stats:
                return [
                    {"name": "bucket-a", "owner": "user-alpha"},
                    {"name": "bucket-b", "owner": "user-beta"},
                ]
            return ["bucket-a", "bucket-b"]

        def get_bucket_info(self, bucket_name: str, stats: bool = True, allow_not_found: bool = False):
            return {"name": bucket_name}

        def get_account(self, owner_id: str, allow_not_found: bool = True):
            return None

        def get_user(self, uid: str, tenant: str | None = None, allow_not_found: bool = True):
            return {"uid": uid, "display_name": f"Display-{uid}"}

    rgw_admin = NamesOnlyWithoutStatsAdmin()
    ctx = SimpleNamespace(
        endpoint=SimpleNamespace(id=186),
        rgw_admin=rgw_admin,
        access_key="AKIA_TEST",
        secret_key="SECRET_TEST",
    )

    advanced_filter = json.dumps(
        {
            "match": "all",
            "rules": [{"field": "owner_name", "op": "eq", "value": "Display-user-alpha"}],
        }
    )

    response = buckets_router.list_buckets(
        page=1,
        page_size=25,
        filter=None,
        advanced_filter=advanced_filter,
        sort_by="name",
        sort_dir="asc",
        include=[],
        with_stats=False,
        ctx=ctx,
    )

    assert [item.name for item in response.items] == ["bucket-a"]
    assert rgw_admin.calls[0] is True


def test_ceph_admin_bucket_listing_sort_by_usage_treats_missing_values_as_zero():
    payload = [
        {"name": "bucket-max", "owner": "owner-a", "usage": {"total_bytes": 4096, "total_objects": 7}},
        {"name": "bucket-missing", "owner": "owner-c", "usage": {}},
        {"name": "bucket-zero", "owner": "owner-b", "usage": {"total_bytes": 0, "total_objects": 0}},
    ]
    ctx, _ = _build_ctx(endpoint_id=187, payload=payload)

    used_desc = buckets_router.list_buckets(
        page=1,
        page_size=25,
        filter=None,
        advanced_filter=None,
        sort_by="used_bytes",
        sort_dir="desc",
        include=[],
        with_stats=True,
        ctx=ctx,
    )
    used_asc = buckets_router.list_buckets(
        page=1,
        page_size=25,
        filter=None,
        advanced_filter=None,
        sort_by="used_bytes",
        sort_dir="asc",
        include=[],
        with_stats=True,
        ctx=ctx,
    )
    objects_desc = buckets_router.list_buckets(
        page=1,
        page_size=25,
        filter=None,
        advanced_filter=None,
        sort_by="object_count",
        sort_dir="desc",
        include=[],
        with_stats=True,
        ctx=ctx,
    )
    objects_asc = buckets_router.list_buckets(
        page=1,
        page_size=25,
        filter=None,
        advanced_filter=None,
        sort_by="object_count",
        sort_dir="asc",
        include=[],
        with_stats=True,
        ctx=ctx,
    )

    assert [item.name for item in used_desc.items] == ["bucket-max", "bucket-missing", "bucket-zero"]
    assert [item.name for item in used_asc.items] == ["bucket-missing", "bucket-zero", "bucket-max"]
    assert [item.name for item in objects_desc.items] == ["bucket-max", "bucket-missing", "bucket-zero"]
    assert [item.name for item in objects_asc.items] == ["bucket-missing", "bucket-zero", "bucket-max"]


def test_ceph_admin_bucket_listing_prefers_quota_max_size_bytes_when_both_units_are_present():
    max_size_bytes = 10 * 1024 * 1024 * 1024
    payload = [
        {
            "name": "bucket-a",
            "owner": "owner-a",
            "bucket_quota": {
                "max_size": max_size_bytes,
                "max_size_kb": max_size_bytes // 1024,
                "max_objects": 1000,
            },
        }
    ]
    ctx, _ = _build_ctx(endpoint_id=188, payload=payload)

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

    assert len(response.items) == 1
    assert response.items[0].quota_max_size_bytes == max_size_bytes
    assert response.items[0].quota_max_size_bytes != max_size_bytes * 1024
