# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import json
import time
import asyncio
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.models.bucket import (
    BucketLifecycleConfig,
    BucketLoggingConfiguration,
    BucketObjectLock,
    BucketProperties,
    BucketPublicAccessBlock,
    BucketWebsiteConfiguration,
    BucketWebsiteRedirectAllRequestsTo,
)
from app.models.ceph_admin import CephAdminBucketSummary
from app.routers.ceph_admin import buckets as buckets_router
from app.services.buckets_service import BucketsService


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


def test_ceph_admin_bucket_listing_cache_does_not_leak_lifecycle_column_details(monkeypatch: pytest.MonkeyPatch):
    payload = [
        {"name": "bucket-a", "owner": "owner-a"},
        {"name": "bucket-b", "owner": "owner-b"},
    ]
    ctx, rgw_admin = _build_ctx(endpoint_id=74, payload=payload)

    lifecycle_by_bucket = {
        "bucket-a": [{"ID": "exp-a", "Expiration": {"Days": 7}, "Transitions": [{"Days": 30, "StorageClass": "GLACIER"}]}],
        "bucket-b": [{"ID": "exp-b", "Expiration": {"Days": 14}}],
    }

    def fake_get_lifecycle(self, name: str, account):
        return BucketLifecycleConfig(rules=lifecycle_by_bucket.get(name, []))

    monkeypatch.setattr(BucketsService, "get_lifecycle", fake_get_lifecycle)

    with_details = buckets_router.list_buckets(
        page=1,
        page_size=25,
        filter=None,
        advanced_filter=None,
        sort_by="name",
        sort_dir="asc",
        include=["lifecycle_expiration_days", "lifecycle_transition_days"],
        with_stats=False,
        ctx=ctx,
    )
    without_details = buckets_router.list_buckets(
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

    assert with_details.items[0].column_details == {
        "lifecycle_expiration_days": [7],
        "lifecycle_transition_days": [30],
    }
    assert with_details.items[1].column_details == {
        "lifecycle_expiration_days": [14],
        "lifecycle_transition_days": [],
    }
    assert all(item.column_details is None for item in without_details.items)
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
            self.info_calls: list[tuple[str, bool]] = []

        def get_all_buckets(self, with_stats: bool = True):
            self.calls.append(with_stats)
            return ["bucket-a", "bucket-b"]

        def get_bucket_info(self, bucket_name: str, stats: bool = True, allow_not_found: bool = False):
            self.info_calls.append((bucket_name, stats))
            owners = {
                "bucket-a": "user-alpha",
                "bucket-b": "user-beta",
            }
            return {"name": bucket_name, "owner": owners.get(bucket_name)}

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
    assert rgw_admin.calls == [False]
    assert rgw_admin.info_calls == [("bucket-a", False), ("bucket-b", False)]


def test_ceph_admin_bucket_listing_falls_back_without_stats_and_backfills_owner():
    class StatsFallbackAdmin:
        def __init__(self):
            self.calls: list[bool] = []
            self.info_calls: list[tuple[str, bool]] = []

        def get_all_buckets(self, with_stats: bool = True):
            self.calls.append(with_stats)
            if with_stats:
                raise buckets_router.RGWAdminError("stats call failed")
            return ["bucket-a", "bucket-b"]

        def get_bucket_info(self, bucket_name: str, stats: bool = True, allow_not_found: bool = False):
            self.info_calls.append((bucket_name, stats))
            owners = {
                "bucket-a": "owner-a",
                "bucket-b": "owner-b",
            }
            return {"name": bucket_name, "owner": owners.get(bucket_name)}

    rgw_admin = StatsFallbackAdmin()
    ctx = SimpleNamespace(
        endpoint=SimpleNamespace(id=188),
        rgw_admin=rgw_admin,
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

    assert response.stats_available is False
    assert response.stats_warning
    assert [(item.name, item.owner) for item in response.items] == [
        ("bucket-a", "owner-a"),
        ("bucket-b", "owner-b"),
    ]
    assert rgw_admin.calls == [True, False]
    assert rgw_admin.info_calls == [("bucket-a", False), ("bucket-b", False)]


def test_ceph_admin_bucket_listing_rejects_stats_sort_when_stats_fetch_fails():
    class FailingStatsAdmin:
        def get_all_buckets(self, with_stats: bool = True):
            if with_stats:
                raise buckets_router.RGWAdminError("stats call failed")
            return ["bucket-a"]

    ctx = SimpleNamespace(
        endpoint=SimpleNamespace(id=189),
        rgw_admin=FailingStatsAdmin(),
        access_key="AKIA_TEST",
        secret_key="SECRET_TEST",
    )

    with pytest.raises(HTTPException) as exc:
        buckets_router.list_buckets(
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

    assert exc.value.status_code == 502
    assert "Bucket stats are unavailable" in str(exc.value.detail)


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


def test_ceph_admin_bucket_listing_lifecycle_param_filters_use_same_rule_matching(monkeypatch: pytest.MonkeyPatch):
    payload = [
        {"name": "bucket-a", "owner": "owner-a"},
        {"name": "bucket-b", "owner": "owner-b"},
        {"name": "bucket-c", "owner": "owner-c"},
    ]
    ctx, _ = _build_ctx(endpoint_id=201, payload=payload)

    lifecycle_by_bucket = {
        "bucket-a": [
            {"ID": "keep-temp", "AbortIncompleteMultipartUpload": {"DaysAfterInitiation": 3}},
            {"ID": "archive"},
        ],
        "bucket-b": [
            {"ID": "archive", "AbortIncompleteMultipartUpload": {"DaysAfterInitiation": 10}},
        ],
        "bucket-c": [
            {"ID": "keep-temp"},
            {"ID": "archive", "AbortIncompleteMultipartUpload": {"DaysAfterInitiation": 10}},
        ],
    }

    def fake_get_lifecycle(self, name: str, account):
        return BucketLifecycleConfig(rules=lifecycle_by_bucket.get(name, []))

    monkeypatch.setattr(BucketsService, "get_lifecycle", fake_get_lifecycle)

    advanced_filter = json.dumps(
        {
            "match": "all",
            "rules": [
                {"feature": "lifecycle_rules", "param": "lifecycle_rule_id", "op": "eq", "value": "keep-temp"},
                {"feature": "lifecycle_rules", "param": "lifecycle_abort_multipart_days", "op": "gte", "value": 3},
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

    # bucket-c does not match because name and abort conditions are on different lifecycle rules.
    assert [item.name for item in response.items] == ["bucket-a"]


def test_ceph_admin_bucket_listing_lifecycle_rule_name_can_be_negated_with_quantifier_none(monkeypatch: pytest.MonkeyPatch):
    payload = [
        {"name": "bucket-a", "owner": "owner-a"},
        {"name": "bucket-b", "owner": "owner-b"},
    ]
    ctx, _ = _build_ctx(endpoint_id=202, payload=payload)

    def fake_get_lifecycle(self, name: str, account):
        rules = [{"ID": "archive"}] if name == "bucket-b" else [{"ID": "keep"}]
        return BucketLifecycleConfig(rules=rules)

    monkeypatch.setattr(BucketsService, "get_lifecycle", fake_get_lifecycle)

    advanced_filter = json.dumps(
        {
            "match": "all",
            "rules": [
                {
                    "feature": "lifecycle_rules",
                    "param": "lifecycle_rule_id",
                    "op": "eq",
                    "value": "archive",
                    "quantifier": "none",
                }
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

    assert [item.name for item in response.items] == ["bucket-a"]


@pytest.mark.parametrize(
    ("op", "value", "expected"),
    [
        ("has", "transition", ["bucket-b", "bucket-c"]),
        ("has_not", "transition", ["bucket-a"]),
    ],
)
def test_ceph_admin_bucket_listing_lifecycle_rule_type_filters(
    monkeypatch: pytest.MonkeyPatch, op: str, value: str, expected: list[str]
):
    payload = [
        {"name": "bucket-a", "owner": "owner-a"},
        {"name": "bucket-b", "owner": "owner-b"},
        {"name": "bucket-c", "owner": "owner-c"},
    ]
    ctx, _ = _build_ctx(endpoint_id=206, payload=payload)

    lifecycle_by_bucket = {
        "bucket-a": [{"ID": "exp", "Expiration": {"Days": 30}, "AbortIncompleteMultipartUpload": {"DaysAfterInitiation": 7}}],
        "bucket-b": [{"ID": "tr", "Transitions": [{"Days": 30, "StorageClass": "GLACIER"}]}],
        "bucket-c": [{"ID": "nctr", "NoncurrentVersionTransitions": [{"NoncurrentDays": 14, "StorageClass": "GLACIER"}], "Transitions": [{"Days": 60, "StorageClass": "GLACIER"}]}],
    }

    def fake_get_lifecycle(self, name: str, account):
        return BucketLifecycleConfig(rules=lifecycle_by_bucket.get(name, []))

    monkeypatch.setattr(BucketsService, "get_lifecycle", fake_get_lifecycle)

    advanced_filter = json.dumps(
        {
            "match": "all",
            "rules": [
                {
                    "feature": "lifecycle_rules",
                    "param": "lifecycle_rule_type",
                    "op": op,
                    "value": value,
                }
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

    assert [item.name for item in response.items] == expected


def test_ceph_admin_bucket_listing_lifecycle_rule_type_and_abort_days_must_match_same_rule(monkeypatch: pytest.MonkeyPatch):
    payload = [
        {"name": "bucket-a", "owner": "owner-a"},
        {"name": "bucket-b", "owner": "owner-b"},
    ]
    ctx, _ = _build_ctx(endpoint_id=207, payload=payload)

    lifecycle_by_bucket = {
        "bucket-a": [
            {"ID": "exp", "Expiration": {"Days": 30}},
            {"ID": "abort", "AbortIncompleteMultipartUpload": {"DaysAfterInitiation": 7}},
        ],
        "bucket-b": [
            {"ID": "exp-abort", "Expiration": {"Days": 30}, "AbortIncompleteMultipartUpload": {"DaysAfterInitiation": 7}},
        ],
    }

    def fake_get_lifecycle(self, name: str, account):
        return BucketLifecycleConfig(rules=lifecycle_by_bucket.get(name, []))

    monkeypatch.setattr(BucketsService, "get_lifecycle", fake_get_lifecycle)

    advanced_filter = json.dumps(
        {
            "match": "all",
            "rules": [
                {"feature": "lifecycle_rules", "param": "lifecycle_rule_type", "op": "has", "value": "expiration"},
                {"feature": "lifecycle_rules", "param": "lifecycle_abort_multipart_days", "op": "gte", "value": 7},
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

    assert [item.name for item in response.items] == ["bucket-b"]


@pytest.mark.parametrize(
    ("op", "value", "expected"),
    [
        ("eq", 3, ["bucket-a"]),
        ("neq", 3, ["bucket-b"]),
        ("gt", 3, ["bucket-b"]),
        ("gte", 10, ["bucket-b"]),
        ("lt", 10, ["bucket-a"]),
        ("lte", 3, ["bucket-a"]),
    ],
)
def test_ceph_admin_bucket_listing_lifecycle_abort_days_operators(
    monkeypatch: pytest.MonkeyPatch, op: str, value: int, expected: list[str]
):
    payload = [
        {"name": "bucket-a", "owner": "owner-a"},
        {"name": "bucket-b", "owner": "owner-b"},
    ]
    ctx, _ = _build_ctx(endpoint_id=203, payload=payload)

    def fake_get_lifecycle(self, name: str, account):
        days = 3 if name == "bucket-a" else 10
        return BucketLifecycleConfig(rules=[{"ID": f"rule-{name}", "AbortIncompleteMultipartUpload": {"DaysAfterInitiation": days}}])

    monkeypatch.setattr(BucketsService, "get_lifecycle", fake_get_lifecycle)

    advanced_filter = json.dumps(
        {
            "match": "all",
            "rules": [
                {
                    "feature": "lifecycle_rules",
                    "param": "lifecycle_abort_multipart_days",
                    "op": op,
                    "value": value,
                }
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

    assert [item.name for item in response.items] == expected


@pytest.mark.parametrize(
    ("param", "bucket_a_rule", "bucket_b_rule", "value", "expected"),
    [
        (
            "lifecycle_expiration_days",
            {"ID": "rule-a", "Expiration": {"Days": 3}},
            {"ID": "rule-b", "Expiration": {"Days": 10}},
            10,
            ["bucket-b"],
        ),
        (
            "lifecycle_noncurrent_expiration_days",
            {"ID": "rule-a", "NoncurrentVersionExpiration": {"NoncurrentDays": 3}},
            {"ID": "rule-b", "NoncurrentVersionExpiration": {"NoncurrentDays": 10}},
            10,
            ["bucket-b"],
        ),
        (
            "lifecycle_transition_days",
            {"ID": "rule-a", "Transitions": [{"Days": 3, "StorageClass": "GLACIER"}]},
            {"ID": "rule-b", "Transitions": [{"Days": 10, "StorageClass": "GLACIER"}]},
            10,
            ["bucket-b"],
        ),
    ],
)
def test_ceph_admin_bucket_listing_lifecycle_other_days_filters(
    monkeypatch: pytest.MonkeyPatch,
    param: str,
    bucket_a_rule: dict,
    bucket_b_rule: dict,
    value: int,
    expected: list[str],
):
    payload = [
        {"name": "bucket-a", "owner": "owner-a"},
        {"name": "bucket-b", "owner": "owner-b"},
    ]
    ctx, _ = _build_ctx(endpoint_id=208, payload=payload)

    def fake_get_lifecycle(self, name: str, account):
        rule = bucket_a_rule if name == "bucket-a" else bucket_b_rule
        return BucketLifecycleConfig(rules=[rule])

    monkeypatch.setattr(BucketsService, "get_lifecycle", fake_get_lifecycle)

    advanced_filter = json.dumps(
        {
            "match": "all",
            "rules": [
                {
                    "feature": "lifecycle_rules",
                    "param": param,
                    "op": "gte",
                    "value": value,
                }
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

    assert [item.name for item in response.items] == expected


@pytest.mark.parametrize(
    ("op", "value", "expected"),
    [
        ("eq", 3, ["bucket-a"]),
        ("neq", 3, ["bucket-b"]),
        ("gt", 3, ["bucket-b"]),
        ("gte", 10, ["bucket-b"]),
        ("lt", 10, ["bucket-a"]),
        ("lte", 3, ["bucket-a"]),
    ],
)
def test_ceph_admin_bucket_listing_lifecycle_transition_days_operators(
    monkeypatch: pytest.MonkeyPatch, op: str, value: int, expected: list[str]
):
    payload = [
        {"name": "bucket-a", "owner": "owner-a"},
        {"name": "bucket-b", "owner": "owner-b"},
    ]
    ctx, _ = _build_ctx(endpoint_id=210, payload=payload)

    def fake_get_lifecycle(self, name: str, account):
        days = 3 if name == "bucket-a" else 10
        return BucketLifecycleConfig(rules=[{"ID": f"rule-{name}", "Transitions": [{"Days": days, "StorageClass": "GLACIER"}]}])

    monkeypatch.setattr(BucketsService, "get_lifecycle", fake_get_lifecycle)

    advanced_filter = json.dumps(
        {
            "match": "all",
            "rules": [
                {
                    "feature": "lifecycle_rules",
                    "param": "lifecycle_transition_days",
                    "op": op,
                    "value": value,
                }
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

    assert [item.name for item in response.items] == expected


def test_ceph_admin_bucket_listing_lifecycle_transition_days_and_rule_name_must_match_same_rule(
    monkeypatch: pytest.MonkeyPatch,
):
    payload = [
        {"name": "bucket-a", "owner": "owner-a"},
        {"name": "bucket-b", "owner": "owner-b"},
    ]
    ctx, _ = _build_ctx(endpoint_id=209, payload=payload)

    lifecycle_by_bucket = {
        "bucket-a": [
            {"ID": "archive", "Expiration": {"Days": 30}},
            {"ID": "cold", "Transitions": [{"Days": 30, "StorageClass": "GLACIER"}]},
        ],
        "bucket-b": [
            {"ID": "archive", "Transitions": [{"Days": 30, "StorageClass": "GLACIER"}]},
        ],
    }

    def fake_get_lifecycle(self, name: str, account):
        return BucketLifecycleConfig(rules=lifecycle_by_bucket.get(name, []))

    monkeypatch.setattr(BucketsService, "get_lifecycle", fake_get_lifecycle)

    advanced_filter = json.dumps(
        {
            "match": "all",
            "rules": [
                {"feature": "lifecycle_rules", "param": "lifecycle_rule_id", "op": "eq", "value": "archive"},
                {"feature": "lifecycle_rules", "param": "lifecycle_transition_days", "op": "eq", "value": 30},
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

    assert [item.name for item in response.items] == ["bucket-b"]


def test_ceph_admin_bucket_listing_feature_param_filters_exclude_unavailable_buckets_even_in_any_mode(
    monkeypatch: pytest.MonkeyPatch,
):
    payload = [
        {"name": "bucket-a", "owner": "owner-a"},
        {"name": "bucket-b", "owner": "target-owner"},
    ]
    ctx, _ = _build_ctx(endpoint_id=204, payload=payload)

    def fake_get_lifecycle(self, name: str, account):
        if name == "bucket-b":
            raise RuntimeError("lifecycle unavailable")
        return BucketLifecycleConfig(rules=[{"ID": "rule-a", "AbortIncompleteMultipartUpload": {"DaysAfterInitiation": 5}}])

    monkeypatch.setattr(BucketsService, "get_lifecycle", fake_get_lifecycle)

    advanced_filter = json.dumps(
        {
            "match": "any",
            "rules": [
                {"field": "owner", "op": "contains", "value": "target-owner"},
                {"feature": "lifecycle_rules", "param": "lifecycle_abort_multipart_days", "op": "gte", "value": 5},
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

    assert [item.name for item in response.items] == ["bucket-a"]


def test_ceph_admin_bucket_listing_feature_param_filters_cover_non_lifecycle_features(monkeypatch: pytest.MonkeyPatch):
    payload = [
        {"name": "bucket-a", "owner": "owner-a"},
        {"name": "bucket-b", "owner": "owner-b"},
    ]
    ctx, _ = _build_ctx(endpoint_id=205, payload=payload)

    def fake_get_bucket_properties(self, name: str, account):
        if name == "bucket-a":
            return BucketProperties(
                object_lock_enabled=True,
                object_lock=BucketObjectLock(enabled=True, mode="GOVERNANCE", days=30),
                public_access_block=BucketPublicAccessBlock(
                    block_public_acls=True,
                    ignore_public_acls=True,
                    block_public_policy=True,
                    restrict_public_buckets=True,
                ),
                lifecycle_rules=[],
                cors_rules=[{"AllowedMethods": ["GET", "HEAD"], "AllowedOrigins": ["https://example.test"]}],
            )
        return BucketProperties(
            object_lock_enabled=False,
            object_lock=BucketObjectLock(enabled=False, mode="COMPLIANCE", days=5),
            public_access_block=BucketPublicAccessBlock(
                block_public_acls=False,
                ignore_public_acls=False,
                block_public_policy=False,
                restrict_public_buckets=False,
            ),
            lifecycle_rules=[],
            cors_rules=[{"AllowedMethods": ["PUT"], "AllowedOrigins": ["https://other.test"]}],
        )

    def fake_get_bucket_logging(self, name: str, account):
        if name == "bucket-a":
            return BucketLoggingConfiguration(enabled=True, target_bucket="audit-bucket", target_prefix="logs/")
        return BucketLoggingConfiguration(enabled=False, target_bucket=None, target_prefix=None)

    def fake_get_bucket_website(self, name: str, account):
        if name == "bucket-a":
            return BucketWebsiteConfiguration(
                index_document="index.html",
                redirect_all_requests_to=BucketWebsiteRedirectAllRequestsTo(host_name="www.example.test"),
            )
        return BucketWebsiteConfiguration(index_document=None, redirect_all_requests_to=None)

    def fake_get_policy(self, name: str, account):
        if name == "bucket-a":
            return {
                "Statement": [
                    {"Effect": "Allow", "Action": "s3:GetObject", "Resource": "*"},
                    {"Effect": "Deny", "Action": "s3:DeleteObject", "Resource": "*", "Condition": {"Bool": {"aws:SecureTransport": "false"}}},
                ]
            }
        return {"Statement": [{"Effect": "Allow", "Action": "s3:GetObject", "Resource": "*"}]}

    monkeypatch.setattr(BucketsService, "get_bucket_properties", fake_get_bucket_properties)
    monkeypatch.setattr(BucketsService, "get_bucket_logging", fake_get_bucket_logging)
    monkeypatch.setattr(BucketsService, "get_bucket_website", fake_get_bucket_website)
    monkeypatch.setattr(BucketsService, "get_policy", fake_get_policy)

    advanced_filter = json.dumps(
        {
            "match": "all",
            "rules": [
                {"feature": "object_lock", "param": "object_lock_mode", "op": "eq", "value": "GOVERNANCE"},
                {"feature": "object_lock", "param": "object_lock_retention_days", "op": "gte", "value": 30},
                {"feature": "block_public_access", "param": "bpa_block_public_acls", "op": "eq", "value": True},
                {"feature": "cors", "param": "cors_allowed_method", "op": "has", "value": "GET"},
                {"feature": "cors", "param": "cors_allowed_origin", "op": "has", "value": "https://example.test"},
                {"feature": "access_logging", "param": "logging_enabled", "op": "eq", "value": True},
                {"feature": "access_logging", "param": "logging_target_bucket", "op": "eq", "value": "audit-bucket"},
                {"feature": "static_website", "param": "website_index_present", "op": "eq", "value": True},
                {"feature": "static_website", "param": "website_redirect_host_present", "op": "eq", "value": True},
                {"feature": "bucket_policy", "param": "policy_statement_count", "op": "gte", "value": 2},
                {"feature": "bucket_policy", "param": "policy_has_conditions", "op": "eq", "value": True},
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

    assert [item.name for item in response.items] == ["bucket-a"]


def test_ceph_admin_bucket_listing_advanced_progress_is_monotonic():
    payload = [
        {"name": "bucket-a", "owner": "owner-a"},
        {"name": "bucket-b", "owner": "owner-b"},
        {"name": "bucket-c", "owner": "owner-c"},
    ]
    ctx, _ = _build_ctx(endpoint_id=301, payload=payload)
    snapshots: list[buckets_router._BucketListingProgressSnapshot] = []
    advanced_filter = json.dumps({"match": "all", "rules": [{"field": "owner", "op": "contains", "value": "owner"}]})

    response = buckets_router._compute_bucket_listing(
        page=1,
        page_size=25,
        filter=None,
        advanced_filter=advanced_filter,
        sort_by="name",
        sort_dir="asc",
        include=[],
        with_stats=False,
        ctx=ctx,
        progress_callback=snapshots.append,
        cancel_check=None,
    )

    percents = [snapshot.percent for snapshot in snapshots]
    assert response.total == 3
    assert percents
    assert percents == sorted(percents)
    assert all(0 <= percent <= 100 for percent in percents)
    assert percents[-1] == 100


def test_ceph_admin_bucket_stream_requires_advanced_filter_payload():
    async def _run() -> None:
        request = SimpleNamespace(is_disconnected=lambda: asyncio.sleep(0, result=False))
        with pytest.raises(HTTPException) as exc:
            await buckets_router.stream_buckets(
                request=request,
                page=1,
                page_size=25,
                filter=None,
                advanced_filter=None,
                sort_by="name",
                sort_dir="asc",
                include=[],
                with_stats=False,
                ctx=SimpleNamespace(endpoint=SimpleNamespace(id=999), rgw_admin=SimpleNamespace(), access_key="x", secret_key="y"),
            )
        assert exc.value.status_code == 400

    asyncio.run(_run())


def test_ceph_admin_bucket_stream_emits_progress_result_and_done(monkeypatch: pytest.MonkeyPatch):
    payload = [{"name": "bucket-a", "owner": "owner-a"}]
    ctx, _ = _build_ctx(endpoint_id=302, payload=payload)
    emitted_calls = {"compute": 0}

    def fake_compute(
        *,
        page: int,
        page_size: int,
        filter: str | None,
        advanced_filter: str | None,
        sort_by: str,
        sort_dir: str,
        include: list[str],
        with_stats: bool,
        ctx,
        progress_callback=None,
        cancel_check=None,
    ):
        emitted_calls["compute"] += 1
        if progress_callback:
            progress_callback(
                buckets_router._BucketListingProgressSnapshot(
                    percent=10,
                    stage="prepare",
                    processed=0,
                    total=1,
                    message="Preparing",
                )
            )
            progress_callback(
                buckets_router._BucketListingProgressSnapshot(
                    percent=65,
                    stage="expensive_filters",
                    processed=1,
                    total=1,
                    message="Filtering",
                )
            )
        return buckets_router.PaginatedCephAdminBucketsResponse(
            items=[buckets_router.CephAdminBucketSummary(name="bucket-a", tenant=None, owner="owner-a")],
            total=1,
            page=page,
            page_size=page_size,
            has_next=False,
        )

    monkeypatch.setattr(buckets_router, "_compute_bucket_listing", fake_compute)

    async def _run() -> str:
        request = SimpleNamespace(is_disconnected=lambda: asyncio.sleep(0, result=False))
        response = await buckets_router.stream_buckets(
            request=request,
            page=1,
            page_size=25,
            filter=None,
            advanced_filter=json.dumps({"match": "all", "rules": [{"field": "name", "op": "contains", "value": "bucket"}]}),
            sort_by="name",
            sort_dir="asc",
            include=[],
            with_stats=False,
            ctx=ctx,
        )
        chunks: list[str] = []
        async for chunk in response.body_iterator:
            chunks.append(chunk.decode() if isinstance(chunk, bytes) else chunk)
        return "".join(chunks)

    body = asyncio.run(_run())
    assert emitted_calls["compute"] == 1
    assert body.count("event: progress") >= 1
    assert "event: result" in body
    assert "event: done" in body
    assert "\"percent\":10" in body
    assert "\"percent\":65" in body


def test_ceph_admin_bucket_stream_cancels_work_when_client_disconnects(monkeypatch: pytest.MonkeyPatch):
    payload = [{"name": "bucket-a", "owner": "owner-a"}]
    ctx, _ = _build_ctx(endpoint_id=303, payload=payload)
    cancelled = {"value": False}

    def fake_compute(
        *,
        page: int,
        page_size: int,
        filter: str | None,
        advanced_filter: str | None,
        sort_by: str,
        sort_dir: str,
        include: list[str],
        with_stats: bool,
        ctx,
        progress_callback=None,
        cancel_check=None,
    ):
        if progress_callback:
            progress_callback(
                buckets_router._BucketListingProgressSnapshot(
                    percent=5,
                    stage="prepare",
                    processed=0,
                    total=1,
                    message="Preparing",
                )
            )
        try:
            while True:
                if cancel_check:
                    cancel_check()
                time.sleep(0.01)
        except buckets_router._BucketListingCancelled:
            cancelled["value"] = True
            raise

    monkeypatch.setattr(buckets_router, "_compute_bucket_listing", fake_compute)

    async def _run() -> None:
        state = {"calls": 0}

        async def is_disconnected() -> bool:
            state["calls"] += 1
            return state["calls"] >= 2

        request = SimpleNamespace(is_disconnected=is_disconnected)
        response = await buckets_router.stream_buckets(
            request=request,
            page=1,
            page_size=25,
            filter=None,
            advanced_filter=json.dumps({"match": "all", "rules": [{"field": "name", "op": "contains", "value": "bucket"}]}),
            sort_by="name",
            sort_dir="asc",
            include=[],
            with_stats=False,
            ctx=ctx,
        )
        async for _ in response.body_iterator:
            pass

    asyncio.run(_run())
    assert cancelled["value"] is True
