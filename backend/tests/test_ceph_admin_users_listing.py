# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import json
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.routers.ceph_admin import users as users_router


class FakeRGWAdmin:
    def __init__(
        self,
        users_payload: list[str],
        user_details: dict[tuple[str | None, str], dict],
        bucket_payloads: dict[str, list[dict]] | None = None,
    ):
        self._users_payload = users_payload
        self._user_details = user_details
        self._bucket_payloads = bucket_payloads or {}
        self.list_users_calls = 0
        self.get_user_calls = 0
        self.get_account_calls = 0
        self.list_user_keys_calls = 0
        self.get_all_buckets_calls = 0

    def list_users(self):
        self.list_users_calls += 1
        return self._users_payload

    def get_user(self, uid: str, tenant: str | None = None, allow_not_found: bool = True):
        self.get_user_calls += 1
        payload = self._user_details.get((tenant, uid))
        if payload is None:
            return {"not_found": True} if allow_not_found else None
        return payload

    def get_account(
        self,
        account_id: str,
        allow_not_found: bool = True,
        allow_not_implemented: bool = False,
    ):
        self.get_account_calls += 1
        return {"id": account_id, "name": f"Account-{account_id}"}

    def list_user_keys(self, uid: str, tenant: str | None = None):
        self.list_user_keys_calls += 1
        return []

    def get_all_buckets(self, account_id: str | None = None, uid: str | None = None, with_stats: bool = False):  # noqa: ARG002
        self.get_all_buckets_calls += 1
        assert uid is not None
        return list(self._bucket_payloads.get(uid, []))


@pytest.fixture(autouse=True)
def clear_users_listing_cache():
    with users_router._USERS_LIST_CACHE_LOCK:
        users_router._USERS_LIST_CACHE.clear()
    with users_router._RGW_USERS_PAYLOAD_CACHE_LOCK:
        users_router._RGW_USERS_PAYLOAD_CACHE.clear()
    yield
    with users_router._USERS_LIST_CACHE_LOCK:
        users_router._USERS_LIST_CACHE.clear()
    with users_router._RGW_USERS_PAYLOAD_CACHE_LOCK:
        users_router._RGW_USERS_PAYLOAD_CACHE.clear()


def _build_ctx(
    endpoint_id: int,
    users_payload: list[str],
    user_details: dict[tuple[str | None, str], dict],
    *,
    endpoint: object | None = None,
    bucket_payloads: dict[str, list[dict]] | None = None,
):
    rgw_admin = FakeRGWAdmin(users_payload=users_payload, user_details=user_details, bucket_payloads=bucket_payloads)
    ctx = SimpleNamespace(endpoint=endpoint or SimpleNamespace(id=endpoint_id), rgw_admin=rgw_admin)
    return ctx, rgw_admin


def _build_user_payload(
    uid: str,
    *,
    tenant: str | None = None,
    account_id: str | None = None,
    account_name: str | None = None,
    full_name: str | None = None,
    email: str | None = None,
    suspended: bool | None = None,
    max_buckets: int | None = None,
    quota_size: int | None = None,
    quota_objects: int | None = None,
) -> dict:
    user_value = f"{tenant}${uid}" if tenant else uid
    payload: dict = {
        "user": {
            "uid": user_value,
            "display_name": full_name,
            "email": email,
            "suspended": suspended,
            "max_buckets": max_buckets,
        },
        "account_id": account_id,
    }
    if account_name is not None:
        payload["account_name"] = account_name
    if quota_size is not None or quota_objects is not None:
        payload["user_quota"] = {
            "max_size": quota_size,
            "max_objects": quota_objects,
        }
    return payload


def test_ceph_admin_users_listing_cache_is_reused_across_pages():
    users_payload = ["alpha", "beta", "gamma", "delta"]
    user_details = {
        (None, "alpha"): _build_user_payload("alpha"),
        (None, "beta"): _build_user_payload("beta"),
        (None, "gamma"): _build_user_payload("gamma"),
        (None, "delta"): _build_user_payload("delta"),
    }
    ctx, rgw_admin = _build_ctx(endpoint_id=11, users_payload=users_payload, user_details=user_details)

    first = users_router.list_rgw_users(
        page=1,
        page_size=2,
        search=None,
        advanced_filter=None,
        sort_by="uid",
        sort_dir="asc",
        include=[],
        ctx=ctx,
    )
    second = users_router.list_rgw_users(
        page=2,
        page_size=2,
        search=None,
        advanced_filter=None,
        sort_by="uid",
        sort_dir="asc",
        include=[],
        ctx=ctx,
    )

    assert [item.uid for item in first.items] == ["alpha", "beta"]
    assert [item.uid for item in second.items] == ["delta", "gamma"]
    assert rgw_admin.list_users_calls == 1


def test_ceph_admin_users_listing_cache_is_reused_for_quick_filter_changes():
    users_payload = ["alpha", "beta", "gamma"]
    user_details = {
        (None, "alpha"): _build_user_payload("alpha"),
        (None, "beta"): _build_user_payload("beta"),
        (None, "gamma"): _build_user_payload("gamma"),
    }
    ctx, rgw_admin = _build_ctx(endpoint_id=12, users_payload=users_payload, user_details=user_details)

    first = users_router.list_rgw_users(
        page=1,
        page_size=25,
        search="a",
        advanced_filter=None,
        sort_by="uid",
        sort_dir="asc",
        include=[],
        ctx=ctx,
    )
    second = users_router.list_rgw_users(
        page=1,
        page_size=25,
        search="al",
        advanced_filter=None,
        sort_by="uid",
        sort_dir="asc",
        include=[],
        ctx=ctx,
    )

    assert [item.uid for item in first.items] == ["alpha", "beta", "gamma"]
    assert [item.uid for item in second.items] == ["alpha"]
    assert rgw_admin.list_users_calls == 1


def test_ceph_admin_users_advanced_filter_uses_cached_listing_and_lazy_include():
    users_payload = ["u1", "u2", "u3"]
    user_details = {
        (None, "u1"): _build_user_payload("u1", full_name="Alice Example", email="alice@example.test"),
        (None, "u2"): _build_user_payload("u2", full_name="Bob Example", email="bob@example.test"),
        (None, "u3"): _build_user_payload("u3", full_name="Aline Example", email="aline@example.test"),
    }
    ctx, rgw_admin = _build_ctx(endpoint_id=13, users_payload=users_payload, user_details=user_details)
    advanced_filter = json.dumps(
        {
            "match": "all",
            "rules": [{"field": "full_name", "op": "contains", "value": "ali"}],
        }
    )

    filtered = users_router.list_rgw_users(
        page=1,
        page_size=25,
        search=None,
        advanced_filter=advanced_filter,
        sort_by="uid",
        sort_dir="asc",
        include=[],
        ctx=ctx,
    )
    assert [item.uid for item in filtered.items] == ["u1", "u3"]
    assert rgw_admin.list_users_calls == 1
    assert rgw_admin.get_user_calls == 3

    enriched = users_router.list_rgw_users(
        page=1,
        page_size=25,
        search=None,
        advanced_filter=advanced_filter,
        sort_by="uid",
        sort_dir="asc",
        include=["profile"],
        ctx=ctx,
    )
    assert [item.full_name for item in enriched.items] == ["Alice Example", "Aline Example"]
    assert rgw_admin.list_users_calls == 1
    assert rgw_admin.get_user_calls == 5


def test_ceph_admin_users_active_filter_includes_missing_suspended_flag():
    users_payload = ["active", "suspended", "implicit-active"]
    user_details = {
        (None, "active"): _build_user_payload("active", suspended=False),
        (None, "suspended"): _build_user_payload("suspended", suspended=True),
        (None, "implicit-active"): _build_user_payload("implicit-active", suspended=None),
    }
    ctx, rgw_admin = _build_ctx(endpoint_id=15, users_payload=users_payload, user_details=user_details)
    advanced_filter = json.dumps(
        {
            "match": "all",
            "rules": [{"field": "suspended", "op": "eq", "value": False}],
        }
    )

    response = users_router.list_rgw_users(
        page=1,
        page_size=25,
        search=None,
        advanced_filter=advanced_filter,
        sort_by="uid",
        sort_dir="asc",
        include=[],
        ctx=ctx,
    )

    assert [item.uid for item in response.items] == ["active", "implicit-active"]
    assert rgw_admin.list_users_calls == 1


def test_ceph_admin_users_advanced_filter_rejects_invalid_json():
    users_payload = ["alpha"]
    user_details = {(None, "alpha"): _build_user_payload("alpha")}
    ctx, _ = _build_ctx(endpoint_id=14, users_payload=users_payload, user_details=user_details)

    with pytest.raises(HTTPException) as exc:
        users_router.list_rgw_users(
            page=1,
            page_size=25,
            search=None,
            advanced_filter="{invalid-json",
            sort_by="uid",
            sort_dir="asc",
            include=[],
            ctx=ctx,
        )
    assert exc.value.status_code == 400


def test_ceph_admin_users_listing_account_include_skips_lookup_when_feature_disabled():
    users_payload = ["alpha"]
    user_details = {
        (None, "alpha"): _build_user_payload(
            "alpha",
            account_id="RGW-1",
            account_name="Inline Account",
        )
    }
    endpoint = SimpleNamespace(
        id=16,
        provider="ceph",
        features_config="features:\n  account:\n    enabled: false\n",
    )
    ctx, rgw_admin = _build_ctx(endpoint_id=16, users_payload=users_payload, user_details=user_details, endpoint=endpoint)

    response = users_router.list_rgw_users(
        page=1,
        page_size=25,
        search=None,
        advanced_filter=None,
        sort_by="uid",
        sort_dir="asc",
        include=["account"],
        ctx=ctx,
    )

    assert response.items[0].account_id == "RGW-1"
    assert response.items[0].account_name == "Inline Account"
    assert rgw_admin.get_account_calls == 0


def test_ceph_admin_user_detail_preserves_payload_account_name_when_account_api_disabled():
    users_payload = ["alpha"]
    user_details = {
        (None, "alpha"): _build_user_payload(
            "alpha",
            account_id="RGW-1",
            account_name="Inline Account",
        )
    }
    endpoint = SimpleNamespace(
        id=17,
        provider="ceph",
        features_config="features:\n  account:\n    enabled: false\n",
    )
    ctx, rgw_admin = _build_ctx(endpoint_id=17, users_payload=users_payload, user_details=user_details, endpoint=endpoint)

    detail = users_router.get_rgw_user_detail("alpha", tenant=None, ctx=ctx)

    assert detail.account_id == "RGW-1"
    assert detail.account_name == "Inline Account"
    assert rgw_admin.get_account_calls == 0
    assert rgw_admin.list_user_keys_calls == 1


def test_build_user_detail_reads_default_placement_and_storage_class():
    payload = _build_user_payload("alice")
    payload["user"]["default_placement"] = "hot-placement"
    payload["user"]["default_storage_class"] = "STANDARD"

    detail = users_router._build_user_detail(
        payload,
        uid_fallback="alice",
        tenant_fallback=None,
        account_name=None,
        keys=[],
    )

    assert detail.default_placement == "hot-placement"
    assert detail.default_storage_class == "STANDARD"


def test_build_user_detail_ignores_legacy_kebab_case_default_fields():
    payload = _build_user_payload("alice")
    payload["user"]["default-placement"] = "legacy-placement"
    payload["user"]["default-storage-class"] = "LEGACY"

    detail = users_router._build_user_detail(
        payload,
        uid_fallback="alice",
        tenant_fallback=None,
        account_name=None,
        keys=[],
    )

    assert detail.default_placement is None
    assert detail.default_storage_class is None


def test_ceph_admin_users_quota_usage_percent_filter_aggregates_bucket_usage():
    users_payload = ["tenant-a$alice"]
    user_details = {
        ("tenant-a", "alice"): _build_user_payload(
            "alice",
            tenant="tenant-a",
            quota_size=100,
            quota_objects=10,
        )
    }
    bucket_payloads = {
        "tenant-a$alice": [
            {"name": "bucket-a", "usage": {"rgw.main": {"size_actual": 30, "num_objects": 3}}},
            {"name": "bucket-b", "usage": {"rgw.main": {"size_actual": 50, "num_objects": 5}}},
        ]
    }
    ctx, rgw_admin = _build_ctx(
        endpoint_id=18,
        users_payload=users_payload,
        user_details=user_details,
        bucket_payloads=bucket_payloads,
    )
    advanced_filter = json.dumps(
        {
            "match": "all",
            "rules": [{"field": "quota_usage_size_percent", "op": "gte", "value": 80}],
        }
    )

    response = users_router.list_rgw_users(
        page=1,
        page_size=25,
        search=None,
        advanced_filter=advanced_filter,
        sort_by="uid",
        sort_dir="asc",
        include=[],
        ctx=ctx,
    )

    assert [item.uid for item in response.items] == ["alice"]
    assert rgw_admin.get_all_buckets_calls == 1


def test_ceph_admin_users_do_not_fetch_usage_without_usage_percent_filter():
    users_payload = ["alpha"]
    user_details = {
        (None, "alpha"): _build_user_payload("alpha", quota_size=100, quota_objects=10),
    }
    bucket_payloads = {
        "alpha": [{"name": "bucket-a", "usage": {"rgw.main": {"size_actual": 30, "num_objects": 3}}}]
    }
    ctx, rgw_admin = _build_ctx(
        endpoint_id=19,
        users_payload=users_payload,
        user_details=user_details,
        bucket_payloads=bucket_payloads,
    )
    advanced_filter = json.dumps(
        {
            "match": "all",
            "rules": [{"field": "quota_max_size_bytes", "op": "gte", "value": 50}],
        }
    )

    response = users_router.list_rgw_users(
        page=1,
        page_size=25,
        search=None,
        advanced_filter=advanced_filter,
        sort_by="uid",
        sort_dir="asc",
        include=[],
        ctx=ctx,
    )

    assert [item.uid for item in response.items] == ["alpha"]
    assert rgw_admin.get_all_buckets_calls == 0
