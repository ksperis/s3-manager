# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.models.bucket import BucketEncryptionConfiguration
from app.routers.ceph_admin import accounts as accounts_router
from app.routers.ceph_admin import account_profiles as account_profiles_router
from app.routers.ceph_admin import bucket_config_access as bucket_config_access_router
from app.routers.ceph_admin import bucket_config_core as bucket_config_core_router
from app.routers.ceph_admin import bucket_config_rules as bucket_config_rules_router
from app.routers.ceph_admin import bucket_tools as bucket_tools_router
from app.routers.ceph_admin import buckets as buckets_router
from app.routers.ceph_admin import user_keys as user_keys_router
from app.routers.ceph_admin import user_profiles as user_profiles_router
from app.routers.ceph_admin import users as users_router
from app.services import ceph_admin_bucket_listing_cache
from router_test_utils import effective_routes


class FakeRGWAdmin:
    def __init__(self) -> None:
        self.with_stats_calls: list[bool] = []

    def get_all_buckets(self, with_stats: bool = True, **_: object):
        self.with_stats_calls.append(bool(with_stats))
        return {"buckets": []}


@pytest.fixture(autouse=True)
def _clear_buckets_caches():
    ceph_admin_bucket_listing_cache.reset_ceph_admin_bucket_listing_caches_for_tests()
    yield
    ceph_admin_bucket_listing_cache.reset_ceph_admin_bucket_listing_caches_for_tests()


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
        region=None,
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


def test_ceph_admin_bucket_objects_use_endpoint_credentials_without_browser_workspace_gate():
    ctx, _ = _build_ctx(metrics_enabled=True)

    class FakeBrowserService:
        def __init__(self) -> None:
            self.calls: list[tuple[str, object, dict[str, object]]] = []

        def list_objects(self, bucket_name: str, account: object, **kwargs: object):
            self.calls.append((bucket_name, account, kwargs))
            return {
                "prefix": "reports/",
                "objects": [],
                "prefixes": ["reports/2026/"],
                "is_truncated": False,
                "next_continuation_token": None,
            }

    service = FakeBrowserService()

    response = bucket_tools_router.list_bucket_objects(
        bucket_name="archive",
        prefix="reports/",
        continuation_token=None,
        max_keys=100,
        ctx=ctx,
        service=service,
    )

    assert response["prefix"] == "reports/"
    assert len(service.calls) == 1
    bucket_name, account, kwargs = service.calls[0]
    assert bucket_name == "archive"
    assert account.name == "ceph-admin:1"
    assert account.storage_endpoint is ctx.endpoint
    assert kwargs == {"prefix": "reports/", "continuation_token": None, "max_keys": 100}


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
        account_profiles_router.get_rgw_account_metrics(account_id="RGW0001", ctx=ctx)

    assert exc.value.status_code == 403
    assert rgw_admin.with_stats_calls == []


def test_ceph_admin_user_metrics_requires_metrics_feature():
    ctx, rgw_admin = _build_ctx(metrics_enabled=False)

    with pytest.raises(HTTPException) as exc:
        user_profiles_router.get_rgw_user_metrics(user_id="user-a", tenant=None, ctx=ctx)

    assert exc.value.status_code == 403
    assert rgw_admin.with_stats_calls == []


def test_ceph_admin_bucket_encryption_requires_sse_feature(monkeypatch):
    ctx, _ = _build_ctx(metrics_enabled=True, sse_enabled=False)
    calls = {"get": 0}

    class _FakeBucketsService:
        def get_bucket_encryption(self, bucket_name, account):
            calls["get"] += 1
            return BucketEncryptionConfiguration(rules=[])

    monkeypatch.setattr(
        bucket_config_core_router,
        "BucketConfigurationService",
        lambda: _FakeBucketsService(),
    )

    with pytest.raises(HTTPException) as exc:
        bucket_config_core_router.get_bucket_encryption(bucket_name="bucket-a", ctx=ctx)

    assert exc.value.status_code == 403
    assert calls["get"] == 0


def test_ceph_admin_bucket_encryption_allows_when_sse_feature_enabled(monkeypatch):
    ctx, _ = _build_ctx(metrics_enabled=True, sse_enabled=True)

    class _FakeBucketsService:
        def get_bucket_encryption(self, bucket_name, account):
            return BucketEncryptionConfiguration(
                rules=[{"ApplyServerSideEncryptionByDefault": {"SSEAlgorithm": "AES256"}}]
            )

    monkeypatch.setattr(
        bucket_config_core_router,
        "BucketConfigurationService",
        lambda: _FakeBucketsService(),
    )

    payload = bucket_config_core_router.get_bucket_encryption(bucket_name="bucket-a", ctx=ctx)

    assert payload.rules == [{"ApplyServerSideEncryptionByDefault": {"SSEAlgorithm": "AES256"}}]


def test_ceph_admin_bucket_config_routes_are_owned_by_dedicated_router() -> None:
    feature_routers = (
        bucket_config_core_router.router,
        bucket_config_access_router.router,
        bucket_config_rules_router.router,
    )
    feature_modules = {
        "app.routers.ceph_admin.bucket_config_core",
        "app.routers.ceph_admin.bucket_config_access",
        "app.routers.ceph_admin.bucket_config_rules",
    }
    assert sum(len(router.routes) for router in feature_routers) == 37
    assert all(
        route.endpoint.__module__ in feature_modules
        for router in feature_routers
        for route in router.routes
    )
    bucket_routes = effective_routes(buckets_router.router)
    included_config_routes = [
        route
        for route in bucket_routes
        if route.endpoint.__module__ in feature_modules
    ]
    assert len(included_config_routes) == 37
    assert len(bucket_tools_router.router.routes) == 4
    assert all(
        route.endpoint.__module__ == "app.routers.ceph_admin.bucket_tools"
        for route in bucket_tools_router.router.routes
    )
    assert len(bucket_routes) == 44


def test_ceph_admin_account_routes_have_dedicated_owners():
    assert len(accounts_router.router.routes) == 2
    assert all(
        route.endpoint.__module__ == "app.routers.ceph_admin.accounts"
        for route in accounts_router.router.routes
    )
    assert len(account_profiles_router.router.routes) == 5
    assert all(
        route.endpoint.__module__ == "app.routers.ceph_admin.account_profiles"
        for route in account_profiles_router.router.routes
    )


def test_ceph_admin_user_key_routes_are_owned_by_dedicated_router():
    assert len(user_keys_router.router.routes) == 4
    assert all(
        route.endpoint.__module__ == "app.routers.ceph_admin.user_keys"
        for route in user_keys_router.router.routes
    )
    user_profile_routes = effective_routes(user_profiles_router.router)
    included_key_routes = [
        route
        for route in user_profile_routes
        if route.endpoint.__module__ == "app.routers.ceph_admin.user_keys"
    ]
    assert len(included_key_routes) == 4
    profile_routes = [
        route
        for route in user_profile_routes
        if route.endpoint.__module__ == "app.routers.ceph_admin.user_profiles"
    ]
    assert len(profile_routes) == 5
    assert len(user_profile_routes) == 9
    assert len(users_router.router.routes) == 2
