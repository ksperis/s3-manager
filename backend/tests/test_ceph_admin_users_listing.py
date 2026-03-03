# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import json
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.routers.ceph_admin import users as users_router


class FakeRGWAdmin:
    def __init__(self, users_payload: list[str], user_details: dict[tuple[str | None, str], dict]):
        self._users_payload = users_payload
        self._user_details = user_details
        self.list_users_calls = 0
        self.get_user_calls = 0
        self.get_account_calls = 0

    def list_users(self):
        self.list_users_calls += 1
        return self._users_payload

    def get_user(self, uid: str, tenant: str | None = None, allow_not_found: bool = True):
        self.get_user_calls += 1
        payload = self._user_details.get((tenant, uid))
        if payload is None:
            return {"not_found": True} if allow_not_found else None
        return payload

    def get_account(self, account_id: str, allow_not_found: bool = True):
        self.get_account_calls += 1
        return {"id": account_id, "name": f"Account-{account_id}"}


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


def _build_ctx(endpoint_id: int, users_payload: list[str], user_details: dict[tuple[str | None, str], dict]):
    rgw_admin = FakeRGWAdmin(users_payload=users_payload, user_details=user_details)
    ctx = SimpleNamespace(endpoint=SimpleNamespace(id=endpoint_id), rgw_admin=rgw_admin)
    return ctx, rgw_admin


def _build_user_payload(
    uid: str,
    *,
    tenant: str | None = None,
    account_id: str | None = None,
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


def test_build_user_detail_reads_default_placement_and_storage_class():
    payload = _build_user_payload("alice")
    payload["user"]["default-placement"] = "hot-placement"
    payload["user"]["default-storage-class"] = "STANDARD"

    detail = users_router._build_user_detail(
        payload,
        uid_fallback="alice",
        tenant_fallback=None,
        account_name=None,
        keys=[],
    )

    assert detail.default_placement == "hot-placement"
    assert detail.default_storage_class == "STANDARD"
