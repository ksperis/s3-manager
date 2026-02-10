# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import json
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.routers.ceph_admin import accounts as accounts_router


class FakeRGWAdmin:
    def __init__(self, accounts_payload: list[object], account_details: dict[str, dict]):
        self._accounts_payload = accounts_payload
        self._account_details = account_details
        self.list_accounts_calls = 0
        self.get_account_calls = 0

    def list_accounts(self, include_details: bool = True):
        self.list_accounts_calls += 1
        return self._accounts_payload

    def get_account(self, account_id: str, allow_not_found: bool = True):
        self.get_account_calls += 1
        payload = self._account_details.get(account_id)
        if payload is None:
            return {"not_found": True} if allow_not_found else None
        return payload


@pytest.fixture(autouse=True)
def clear_accounts_listing_cache():
    with accounts_router._ACCOUNTS_LIST_CACHE_LOCK:
        accounts_router._ACCOUNTS_LIST_CACHE.clear()
    with accounts_router._RGW_ACCOUNTS_PAYLOAD_CACHE_LOCK:
        accounts_router._RGW_ACCOUNTS_PAYLOAD_CACHE.clear()
    yield
    with accounts_router._ACCOUNTS_LIST_CACHE_LOCK:
        accounts_router._ACCOUNTS_LIST_CACHE.clear()
    with accounts_router._RGW_ACCOUNTS_PAYLOAD_CACHE_LOCK:
        accounts_router._RGW_ACCOUNTS_PAYLOAD_CACHE.clear()


def _build_ctx(endpoint_id: int, accounts_payload: list[object], account_details: dict[str, dict]):
    rgw_admin = FakeRGWAdmin(accounts_payload=accounts_payload, account_details=account_details)
    ctx = SimpleNamespace(endpoint=SimpleNamespace(id=endpoint_id), rgw_admin=rgw_admin)
    return ctx, rgw_admin


def _build_account_payload(
    account_id: str,
    *,
    account_name: str | None = None,
    email: str | None = None,
    max_users: int | None = None,
    max_buckets: int | None = None,
    quota_size: int | None = None,
    quota_objects: int | None = None,
    bucket_count: int | None = None,
    user_count: int | None = None,
) -> dict:
    payload: dict = {
        "id": account_id,
        "name": account_name,
        "email": email,
        "max_users": max_users,
        "max_buckets": max_buckets,
        "bucket_count": bucket_count,
        "user_count": user_count,
    }
    if quota_size is not None or quota_objects is not None:
        payload["quota"] = {
            "max_size": quota_size,
            "max_objects": quota_objects,
        }
    return payload


def test_ceph_admin_accounts_listing_cache_is_reused_across_pages():
    accounts_payload = ["RGW03", "RGW01", "RGW02"]
    account_details = {
        "RGW01": _build_account_payload("RGW01", account_name="Alpha"),
        "RGW02": _build_account_payload("RGW02", account_name="Beta"),
        "RGW03": _build_account_payload("RGW03", account_name="Gamma"),
    }
    ctx, rgw_admin = _build_ctx(endpoint_id=21, accounts_payload=accounts_payload, account_details=account_details)

    first = accounts_router.list_rgw_accounts(
        page=1,
        page_size=2,
        search=None,
        advanced_filter=None,
        sort_by="account_id",
        sort_dir="asc",
        include=[],
        ctx=ctx,
    )
    second = accounts_router.list_rgw_accounts(
        page=2,
        page_size=2,
        search=None,
        advanced_filter=None,
        sort_by="account_id",
        sort_dir="asc",
        include=[],
        ctx=ctx,
    )

    assert [item.account_id for item in first.items] == ["RGW01", "RGW02"]
    assert [item.account_id for item in second.items] == ["RGW03"]
    assert rgw_admin.list_accounts_calls == 1


def test_ceph_admin_accounts_listing_cache_is_reused_for_quick_filter_changes():
    accounts_payload = [
        {"id": "RGW01", "name": "Alpha"},
        {"id": "RGW02", "name": "Beta"},
        {"id": "RGW03", "name": "Gamma"},
    ]
    account_details = {
        "RGW01": _build_account_payload("RGW01", account_name="Alpha"),
        "RGW02": _build_account_payload("RGW02", account_name="Beta"),
        "RGW03": _build_account_payload("RGW03", account_name="Gamma"),
    }
    ctx, rgw_admin = _build_ctx(endpoint_id=22, accounts_payload=accounts_payload, account_details=account_details)

    first = accounts_router.list_rgw_accounts(
        page=1,
        page_size=25,
        search="rgw",
        advanced_filter=None,
        sort_by="account_id",
        sort_dir="asc",
        include=[],
        ctx=ctx,
    )
    second = accounts_router.list_rgw_accounts(
        page=1,
        page_size=25,
        search="01",
        advanced_filter=None,
        sort_by="account_id",
        sort_dir="asc",
        include=[],
        ctx=ctx,
    )

    assert [item.account_id for item in first.items] == ["RGW01", "RGW02", "RGW03"]
    assert [item.account_id for item in second.items] == ["RGW01"]
    assert rgw_admin.list_accounts_calls == 1


def test_ceph_admin_accounts_advanced_filter_uses_cached_listing_and_lazy_include():
    accounts_payload = ["RGW01", "RGW02", "RGW03"]
    account_details = {
        "RGW01": _build_account_payload("RGW01", account_name="Alpha", email="alpha@example.test"),
        "RGW02": _build_account_payload("RGW02", account_name="Beta", email="beta@example.test"),
        "RGW03": _build_account_payload("RGW03", account_name="Gamma", email="gamma@example.test"),
    }
    ctx, rgw_admin = _build_ctx(endpoint_id=23, accounts_payload=accounts_payload, account_details=account_details)
    advanced_filter = json.dumps(
        {
            "match": "all",
            "rules": [{"field": "email", "op": "contains", "value": "alpha"}],
        }
    )

    filtered = accounts_router.list_rgw_accounts(
        page=1,
        page_size=25,
        search=None,
        advanced_filter=advanced_filter,
        sort_by="account_id",
        sort_dir="asc",
        include=[],
        ctx=ctx,
    )
    assert [item.account_id for item in filtered.items] == ["RGW01"]
    assert filtered.items[0].email is None
    assert rgw_admin.list_accounts_calls == 1
    assert rgw_admin.get_account_calls == 3

    enriched = accounts_router.list_rgw_accounts(
        page=1,
        page_size=25,
        search=None,
        advanced_filter=advanced_filter,
        sort_by="account_id",
        sort_dir="asc",
        include=["profile"],
        ctx=ctx,
    )
    assert [item.email for item in enriched.items] == ["alpha@example.test"]
    assert rgw_admin.list_accounts_calls == 1
    assert rgw_admin.get_account_calls == 4


def test_ceph_admin_accounts_advanced_filter_rejects_invalid_json():
    accounts_payload = ["RGW01"]
    account_details = {"RGW01": _build_account_payload("RGW01", account_name="Alpha")}
    ctx, _ = _build_ctx(endpoint_id=24, accounts_payload=accounts_payload, account_details=account_details)

    with pytest.raises(HTTPException) as exc:
        accounts_router.list_rgw_accounts(
            page=1,
            page_size=25,
            search=None,
            advanced_filter="{invalid-json",
            sort_by="account_id",
            sort_dir="asc",
            include=[],
            ctx=ctx,
        )
    assert exc.value.status_code == 400
