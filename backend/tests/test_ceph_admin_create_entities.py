# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from types import SimpleNamespace

import pytest

from app.models.ceph_admin import (
    CephAdminRgwAccountCreate,
    CephAdminRgwAccountConfigUpdate,
    CephAdminRgwUserCapsUpdate,
    CephAdminRgwUserCreate,
    CephAdminRgwUserConfigUpdate,
)
from app.routers.ceph_admin import accounts as accounts_router
from app.routers.ceph_admin import buckets as buckets_router
from app.routers.ceph_admin import endpoints as endpoints_router
from app.routers.ceph_admin import users as users_router


@pytest.fixture(autouse=True)
def clear_ceph_admin_caches():
    with accounts_router._ACCOUNTS_LIST_CACHE_LOCK:
        accounts_router._ACCOUNTS_LIST_CACHE.clear()
    with accounts_router._RGW_ACCOUNTS_PAYLOAD_CACHE_LOCK:
        accounts_router._RGW_ACCOUNTS_PAYLOAD_CACHE.clear()
    with users_router._USERS_LIST_CACHE_LOCK:
        users_router._USERS_LIST_CACHE.clear()
    with users_router._RGW_USERS_PAYLOAD_CACHE_LOCK:
        users_router._RGW_USERS_PAYLOAD_CACHE.clear()
    with buckets_router._BUCKET_LIST_CACHE_LOCK:
        buckets_router._BUCKET_LIST_CACHE.clear()
    with buckets_router._RGW_BUCKET_PAYLOAD_CACHE_LOCK:
        buckets_router._RGW_BUCKET_PAYLOAD_CACHE.clear()
    yield
    with accounts_router._ACCOUNTS_LIST_CACHE_LOCK:
        accounts_router._ACCOUNTS_LIST_CACHE.clear()
    with accounts_router._RGW_ACCOUNTS_PAYLOAD_CACHE_LOCK:
        accounts_router._RGW_ACCOUNTS_PAYLOAD_CACHE.clear()
    with users_router._USERS_LIST_CACHE_LOCK:
        users_router._USERS_LIST_CACHE.clear()
    with users_router._RGW_USERS_PAYLOAD_CACHE_LOCK:
        users_router._RGW_USERS_PAYLOAD_CACHE.clear()
    with buckets_router._BUCKET_LIST_CACHE_LOCK:
        buckets_router._BUCKET_LIST_CACHE.clear()
    with buckets_router._RGW_BUCKET_PAYLOAD_CACHE_LOCK:
        buckets_router._RGW_BUCKET_PAYLOAD_CACHE.clear()


class FakeAccountsAdmin:
    def __init__(self):
        self.create_account_calls: list[dict] = []
        self.set_account_quota_calls: list[dict] = []

    def create_account(
        self,
        account_id: str | None = None,
        account_name: str | None = None,
        email: str | None = None,
        max_users: int | None = None,
        max_buckets: int | None = None,
        max_roles: int | None = None,
        max_groups: int | None = None,
        max_access_keys: int | None = None,
        extra_params: dict | None = None,
    ):
        resolved_account_id = account_id or "RGW99999999999999990"
        self.create_account_calls.append(
            {
                "account_id": resolved_account_id,
                "account_name": account_name,
                "email": email,
                "max_users": max_users,
                "max_buckets": max_buckets,
                "max_roles": max_roles,
                "max_groups": max_groups,
                "max_access_keys": max_access_keys,
                "extra_params": extra_params,
            }
        )
        return {"id": resolved_account_id, "name": account_name or resolved_account_id}

    def set_account_quota(
        self,
        account_id: str,
        max_size_bytes: int | None,
        max_objects: int | None,
        enabled: bool,
        quota_type: str = "account",
    ):
        self.set_account_quota_calls.append(
            {
                "account_id": account_id,
                "max_size_bytes": max_size_bytes,
                "max_objects": max_objects,
                "enabled": enabled,
                "quota_type": quota_type,
            }
        )
        return {}

    def get_account(
        self,
        account_id: str,
        allow_not_found: bool = True,
        allow_not_implemented: bool = False,
    ):
        return {
            "id": account_id,
            "name": f"Account-{account_id}",
            "max_users": 8,
            "max_buckets": 20,
            "quota": {
                "enabled": True,
                "max_size": 2048,
                "max_objects": 200,
            },
        }


def test_create_rgw_account_supports_quota():
    fake_rgw = FakeAccountsAdmin()
    ctx = SimpleNamespace(endpoint=SimpleNamespace(id=901), rgw_admin=fake_rgw)
    payload = CephAdminRgwAccountCreate(
        account_id="RGW12345678901234567",
        account_name="Primary Account",
        email="owner@example.test",
        max_users=12,
        max_buckets=40,
        quota_enabled=True,
        quota_max_size_bytes=4096,
        quota_max_objects=400,
    )

    response = accounts_router.create_rgw_account(payload=payload, ctx=ctx)

    assert response.account.account_id == "RGW12345678901234567"

    assert len(fake_rgw.create_account_calls) == 1
    assert fake_rgw.create_account_calls[0]["account_id"] == "RGW12345678901234567"
    assert len(fake_rgw.set_account_quota_calls) == 1
    assert fake_rgw.set_account_quota_calls[0]["enabled"] is True


def test_update_rgw_account_quota_omits_unset_object_limit():
    fake_rgw = FakeAccountsAdmin()
    ctx = SimpleNamespace(endpoint=SimpleNamespace(id=901), rgw_admin=fake_rgw)

    accounts_router.update_rgw_account_config(
        "RGW12345678901234567",
        CephAdminRgwAccountConfigUpdate(
            quota_enabled=True,
            quota_max_size_bytes=4096,
        ),
        ctx=ctx,
    )

    assert fake_rgw.set_account_quota_calls[-1] == {
        "account_id": "RGW12345678901234567",
        "max_size_bytes": 4096,
        "max_objects": None,
        "enabled": True,
        "quota_type": "account",
    }


def test_update_rgw_account_quota_clears_object_limit_with_explicit_null():
    fake_rgw = FakeAccountsAdmin()
    ctx = SimpleNamespace(endpoint=SimpleNamespace(id=901), rgw_admin=fake_rgw)

    accounts_router.update_rgw_account_config(
        "RGW12345678901234567",
        CephAdminRgwAccountConfigUpdate(quota_max_objects=None),
        ctx=ctx,
    )

    assert fake_rgw.set_account_quota_calls[-1] == {
        "account_id": "RGW12345678901234567",
        "max_size_bytes": None,
        "max_objects": 0,
        "enabled": True,
        "quota_type": "account",
    }


def test_update_rgw_bucket_quota_omits_unset_object_limit():
    fake_rgw = FakeAccountsAdmin()
    ctx = SimpleNamespace(endpoint=SimpleNamespace(id=901), rgw_admin=fake_rgw)

    accounts_router.update_rgw_account_config(
        "RGW12345678901234567",
        CephAdminRgwAccountConfigUpdate(
            bucket_quota_enabled=True,
            bucket_quota_max_size_bytes=8192,
        ),
        ctx=ctx,
    )

    assert fake_rgw.set_account_quota_calls[-1] == {
        "account_id": "RGW12345678901234567",
        "max_size_bytes": 8192,
        "max_objects": None,
        "enabled": True,
        "quota_type": "bucket",
    }


def test_update_rgw_bucket_quota_clears_object_limit_with_explicit_null():
    fake_rgw = FakeAccountsAdmin()
    ctx = SimpleNamespace(endpoint=SimpleNamespace(id=901), rgw_admin=fake_rgw)

    accounts_router.update_rgw_account_config(
        "RGW12345678901234567",
        CephAdminRgwAccountConfigUpdate(bucket_quota_max_objects=None),
        ctx=ctx,
    )

    assert fake_rgw.set_account_quota_calls[-1] == {
        "account_id": "RGW12345678901234567",
        "max_size_bytes": None,
        "max_objects": 0,
        "enabled": True,
        "quota_type": "bucket",
    }


class FakeUsersAdmin:
    def __init__(self):
        self.create_user_calls: list[dict] = []
        self.create_user_with_account_id_calls: list[dict] = []
        self.update_user_calls: list[dict] = []
        self.set_user_caps_calls: list[dict] = []
        self.set_user_quota_calls: list[dict] = []
        self.get_account_calls = 0

    def _extract_keys(self, raw):
        if not isinstance(raw, dict):
            return []
        entries = raw.get("keys")
        return entries if isinstance(entries, list) else []

    def create_user(
        self,
        uid: str,
        display_name: str | None = None,
        email: str | None = None,
        tenant: str | None = None,
        generate_key: bool = True,
        extra_params: dict | None = None,
    ):
        self.create_user_calls.append(
            {
                "uid": uid,
                "display_name": display_name,
                "email": email,
                "tenant": tenant,
                "generate_key": generate_key,
                "extra_params": extra_params,
            }
        )
        return {"keys": [{"access_key": "AKIA-USER", "secret_key": "SECRET-USER"}]}

    def create_user_with_account_id(
        self,
        uid: str,
        account_id: str,
        display_name: str | None = None,
        account_root: bool = True,
        email: str | None = None,
        generate_key: bool = True,
        extra_params: dict | None = None,
    ):
        self.create_user_with_account_id_calls.append(
            {
                "uid": uid,
                "account_id": account_id,
                "display_name": display_name,
                "account_root": account_root,
                "email": email,
                "generate_key": generate_key,
                "extra_params": extra_params,
            }
        )
        return {"keys": [{"access_key": "AKIA-ACCOUNT", "secret_key": "SECRET-ACCOUNT"}]}

    def update_user(self, uid: str, **kwargs):
        self.update_user_calls.append({"uid": uid, **kwargs})
        return {}

    def set_user_caps(self, uid: str, caps: list[str], tenant: str | None = None, op: str = "add"):
        self.set_user_caps_calls.append({"uid": uid, "caps": caps, "tenant": tenant, "op": op})
        return {}

    def set_user_quota(self, uid: str, tenant: str | None = None, max_size_bytes: int | None = None, max_objects: int | None = None, enabled: bool = True):
        self.set_user_quota_calls.append(
            {
                "uid": uid,
                "tenant": tenant,
                "max_size_bytes": max_size_bytes,
                "max_objects": max_objects,
                "enabled": enabled,
            }
        )
        return {}

    def get_user(self, uid: str, tenant: str | None = None, allow_not_found: bool = True):
        return {
            "user": {
                "uid": uid,
                "display_name": "Account User",
                "email": "account-user@example.test",
                "max_buckets": 10,
            },
            "account_id": "RGW99999999999999999",
            "caps": ["users=read"],
            "user_quota": {"enabled": True, "max_size": 512, "max_objects": 10},
        }

    def get_account(
        self,
        account_id: str,
        allow_not_found: bool = True,
        allow_not_implemented: bool = False,
    ):
        self.get_account_calls += 1
        return {"id": account_id, "name": f"Account-{account_id}"}

    def list_user_keys(self, uid: str, tenant: str | None = None):
        return [{"access_key": "AKIA-LISTED", "secret_key": "SECRET-LISTED", "status": "enabled"}]


def test_create_rgw_user_with_account_scope_returns_generated_key():
    fake_rgw = FakeUsersAdmin()
    ctx = SimpleNamespace(endpoint=SimpleNamespace(id=902), rgw_admin=fake_rgw)
    payload = CephAdminRgwUserCreate(
        uid="billing-user",
        account_id="RGW99999999999999999",
        display_name="Billing user",
        email="billing@example.test",
        account_root=True,
        admin=True,
        system=False,
        suspended=False,
        max_buckets=15,
        generate_key=True,
        caps=CephAdminRgwUserCapsUpdate(mode="add", values=["usage=read"]),
        quota_enabled=True,
        quota_max_size_bytes=1024,
        quota_max_objects=100,
    )

    response = users_router.create_rgw_user(payload=payload, ctx=ctx)

    assert response.detail.uid == "billing-user"
    assert response.detail.account_id == "RGW99999999999999999"
    assert response.detail.account_name == "Account-RGW99999999999999999"
    assert response.generated_key is not None
    assert response.generated_key.access_key == "AKIA-ACCOUNT"
    assert response.generated_key.secret_key == "SECRET-ACCOUNT"

    assert len(fake_rgw.create_user_with_account_id_calls) == 1
    assert fake_rgw.create_user_with_account_id_calls[0]["account_root"] is True
    assert len(fake_rgw.update_user_calls) == 1
    assert len(fake_rgw.set_user_caps_calls) == 1
    assert fake_rgw.set_user_caps_calls[0]["caps"] == ["usage=read"]
    assert len(fake_rgw.set_user_quota_calls) == 1


def test_update_rgw_user_quota_omits_unset_object_limit():
    fake_rgw = FakeUsersAdmin()
    ctx = SimpleNamespace(endpoint=SimpleNamespace(id=902), rgw_admin=fake_rgw)

    users_router.update_rgw_user_config(
        "billing-user",
        CephAdminRgwUserConfigUpdate(
            quota_enabled=True,
            quota_max_size_bytes=2048,
        ),
        ctx=ctx,
    )

    assert fake_rgw.set_user_quota_calls[-1] == {
        "uid": "billing-user",
        "tenant": None,
        "max_size_bytes": 2048,
        "max_objects": None,
        "enabled": True,
    }


def test_update_rgw_user_quota_clears_object_limit_with_explicit_null():
    fake_rgw = FakeUsersAdmin()
    ctx = SimpleNamespace(endpoint=SimpleNamespace(id=902), rgw_admin=fake_rgw)

    users_router.update_rgw_user_config(
        "billing-user",
        CephAdminRgwUserConfigUpdate(quota_max_objects=None),
        ctx=ctx,
    )

    assert fake_rgw.set_user_quota_calls[-1] == {
        "uid": "billing-user",
        "tenant": None,
        "max_size_bytes": None,
        "max_objects": 0,
        "enabled": True,
    }


def test_summarize_rgw_info_collects_placements_and_storage_classes():
    payload = {
        "default_placement_rule": "hot",
        "zonegroup": {
            "name": "zg-a",
            "placement_targets": [
                {"key": "hot", "val": {"storage_classes": {"STANDARD": {}, "COLD": {}}}},
                {"name": "cold", "storage_classes": ["ARCHIVE"]},
            ],
            "storage_classes": {"STANDARD_IA": {}},
        },
        "placement_targets": {
            "archive": {"storage_classes": {"DEEP_ARCHIVE": {}}},
        },
        "storage_classes": ["STANDARD"],
        "realm_name": "realm-a",
    }

    summary = endpoints_router._summarize_rgw_info(payload)

    assert summary.default_placement == "hot"
    assert summary.zonegroup == "zg-a"
    assert summary.realm == "realm-a"
    assert [item.name for item in summary.placement_targets] == ["archive", "cold", "hot"]
    placement_classes = {item.name: item.storage_classes for item in summary.placement_targets}
    assert placement_classes["archive"] == ["DEEP_ARCHIVE"]
    assert placement_classes["cold"] == ["ARCHIVE"]
    assert placement_classes["hot"] == ["COLD", "STANDARD"]
    assert summary.storage_classes == ["ARCHIVE", "COLD", "DEEP_ARCHIVE", "STANDARD", "STANDARD_IA"]
