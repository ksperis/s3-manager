# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from types import SimpleNamespace

from app.models.bucket import BucketQuotaUpdate
from app.routers.ceph_admin import buckets as buckets_router


class _FakeRGWAdmin:
    def __init__(self, bucket_info: dict) -> None:
        self.bucket_info = bucket_info

    def get_bucket_info(self, bucket_name: str, stats: bool = True, allow_not_found: bool = False):
        return self.bucket_info


def _build_ctx(bucket_info: dict) -> SimpleNamespace:
    endpoint = SimpleNamespace(
        id=1,
        provider="ceph",
        features_config="features:\n  usage:\n    enabled: true\n",
    )
    return SimpleNamespace(
        endpoint=endpoint,
        rgw_admin=_FakeRGWAdmin(bucket_info),
        access_key="AKIA_TEST",
        secret_key="SECRET_TEST",
    )


def test_update_quota_builds_tenant_qualified_owner_uid(monkeypatch):
    captured: dict = {}

    def fake_set_bucket_quota(self, name, account, payload, rgw_admin=None):
        captured["name"] = name
        captured["uid"] = account.rgw_user_uid
        captured["account_id"] = account.rgw_account_id
        captured["has_rgw_admin"] = rgw_admin is not None

    monkeypatch.setattr(buckets_router.BucketsService, "set_bucket_quota", fake_set_bucket_quota)

    response = buckets_router.update_quota(
        "bucket-a",
        BucketQuotaUpdate(max_size_gb=10, max_size_unit="GiB", max_objects=1000),
        ctx=_build_ctx(
            {
                "bucket": "bucket-a",
                "tenant": "RGW00000000000000001",
                "owner": "tests3user",
            }
        ),
    )

    assert response == {"message": "Bucket quota updated"}
    assert captured == {
        "name": "bucket-a",
        "uid": "RGW00000000000000001$tests3user",
        "account_id": None,
        "has_rgw_admin": True,
    }


def test_update_quota_uses_account_owner_identifier_as_uid(monkeypatch):
    captured: dict = {}

    def fake_set_bucket_quota(self, name, account, payload, rgw_admin=None):
        captured["name"] = name
        captured["uid"] = account.rgw_user_uid
        captured["account_id"] = account.rgw_account_id
        captured["has_rgw_admin"] = rgw_admin is not None

    monkeypatch.setattr(buckets_router.BucketsService, "set_bucket_quota", fake_set_bucket_quota)

    response = buckets_router.update_quota(
        "bucket-b",
        BucketQuotaUpdate(max_size_gb=1, max_size_unit="GiB"),
        ctx=_build_ctx(
            {
                "bucket": "bucket-b",
                "owner": "RGW00000000000000009",
            }
        ),
    )

    assert response == {"message": "Bucket quota updated"}
    assert captured == {
        "name": "bucket-b",
        "uid": None,
        "account_id": "RGW00000000000000009",
        "has_rgw_admin": True,
    }
