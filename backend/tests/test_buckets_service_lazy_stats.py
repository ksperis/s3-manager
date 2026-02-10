# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from app.db import S3Account
from app.models.bucket import BucketProperties
from app.services import s3_client
from app.services.buckets_service import BucketsService


def _build_account() -> S3Account:
    return S3Account(
        name="account-lazy-stats",
        rgw_account_id="RGW00000000000000001",
        rgw_access_key="AKIA_TEST",
        rgw_secret_key="SECRET_TEST",
    )


def test_list_buckets_skips_admin_stats_when_disabled(monkeypatch):
    service = BucketsService()
    account = _build_account()
    monkeypatch.setattr(s3_client, "list_buckets", lambda **kwargs: [{"name": "bucket-a"}])

    calls = {"admin": 0}

    def fake_admin_bucket_list(*args, **kwargs):
        calls["admin"] += 1
        return []

    monkeypatch.setattr(service, "_admin_bucket_list", fake_admin_bucket_list)

    buckets = service.list_buckets(account, with_stats=False)

    assert calls["admin"] == 0
    assert len(buckets) == 1
    assert buckets[0].name == "bucket-a"
    assert buckets[0].used_bytes is None
    assert buckets[0].object_count is None
    assert buckets[0].quota_max_size_bytes is None
    assert buckets[0].quota_max_objects is None


def test_list_buckets_fetches_admin_stats_when_enabled(monkeypatch):
    service = BucketsService()
    account = _build_account()
    monkeypatch.setattr(s3_client, "list_buckets", lambda **kwargs: [{"name": "bucket-a"}])

    calls = {"admin": 0}

    def fake_admin_bucket_list(*args, **kwargs):
        calls["admin"] += 1
        assert kwargs.get("with_stats") is True
        return [
            {
                "bucket": "bucket-a",
                "usage": {"rgw.main": {"size_actual": 2048, "num_objects": 5}},
                "bucket_quota": {"max_size": 4096, "max_objects": 10},
            }
        ]

    monkeypatch.setattr(service, "_admin_bucket_list", fake_admin_bucket_list)

    buckets = service.list_buckets(account, with_stats=True)

    assert calls["admin"] == 1
    assert len(buckets) == 1
    assert buckets[0].name == "bucket-a"
    assert buckets[0].used_bytes == 2048
    assert buckets[0].object_count == 5
    assert buckets[0].quota_max_size_bytes == 4096
    assert buckets[0].quota_max_objects == 10


def test_list_buckets_versioning_only_avoids_bundle_properties(monkeypatch):
    service = BucketsService()
    account = _build_account()
    monkeypatch.setattr(s3_client, "list_buckets", lambda **kwargs: [{"name": "bucket-a"}])

    calls = {"versioning": 0}

    monkeypatch.setattr(service, "_admin_bucket_list", lambda *args, **kwargs: [])

    def fake_get_versioning(bucket_name, *_args, **_kwargs):
        assert bucket_name == "bucket-a"
        calls["versioning"] += 1
        return "Enabled"

    monkeypatch.setattr(service, "get_bucket_versioning_status", fake_get_versioning)
    monkeypatch.setattr(
        service,
        "get_bucket_properties",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("get_bucket_properties should not be called")),
    )
    monkeypatch.setattr(
        service,
        "get_lifecycle",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("get_lifecycle should not be called")),
    )
    monkeypatch.setattr(
        service,
        "get_bucket_cors",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("get_bucket_cors should not be called")),
    )

    buckets = service.list_buckets(account, include={"versioning"}, with_stats=False)

    assert calls["versioning"] == 1
    assert buckets[0].features is not None
    assert buckets[0].features["versioning"].state == "Enabled"


def test_list_buckets_multiple_prop_features_use_bundle_properties(monkeypatch):
    service = BucketsService()
    account = _build_account()
    monkeypatch.setattr(s3_client, "list_buckets", lambda **kwargs: [{"name": "bucket-a"}])
    monkeypatch.setattr(service, "_admin_bucket_list", lambda *args, **kwargs: [])

    calls = {"properties": 0}

    def fake_get_properties(bucket_name, *_args, **_kwargs):
        assert bucket_name == "bucket-a"
        calls["properties"] += 1
        return BucketProperties(
            versioning_status="Enabled",
            object_lock_enabled=False,
            object_lock=None,
            public_access_block=None,
            lifecycle_rules=[],
            cors_rules=[],
        )

    monkeypatch.setattr(service, "get_bucket_properties", fake_get_properties)
    monkeypatch.setattr(
        service,
        "get_bucket_versioning_status",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("dedicated versioning API should not be called")),
    )
    monkeypatch.setattr(
        service,
        "get_bucket_cors",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("dedicated cors API should not be called")),
    )

    buckets = service.list_buckets(account, include={"versioning", "cors"}, with_stats=False)

    assert calls["properties"] == 1
    assert buckets[0].features is not None
    assert buckets[0].features["versioning"].state == "Enabled"
    assert buckets[0].features["cors"].state == "Not set"
