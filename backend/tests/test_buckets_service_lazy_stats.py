# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from app.db import S3Account, StorageEndpoint
from app.models.bucket import BucketNotificationConfiguration, BucketProperties, BucketQuotaUpdate
from app.services import s3_client
from app.services import buckets_service as buckets_service_module
from app.services.buckets_service import BucketsService
from app.services.bucket_configuration_service import BucketConfigurationService


def _build_account() -> S3Account:
    return S3Account(
        name="account-lazy-stats",
        rgw_account_id="RGW00000000000000001",
        rgw_access_key="AKIA_TEST",
        rgw_secret_key="SECRET_TEST",
    )


def test_bucket_feature_enrichment_is_owned_by_dedicated_module():
    assert not hasattr(buckets_service_module, "account_sns_feature_enabled")
    assert not hasattr(buckets_service_module, "is_bucket_notification_configuration_configured")


def test_bucket_configuration_is_owned_by_dedicated_service():
    configuration_methods = {
        "get_bucket_properties",
        "set_versioning",
        "set_bucket_quota",
        "get_policy",
        "set_lifecycle",
        "set_bucket_replication",
        "set_bucket_notifications",
        "set_bucket_website",
        "set_object_lock",
    }
    assert all(not hasattr(BucketsService, method) for method in configuration_methods)
    assert all(hasattr(BucketConfigurationService, method) for method in configuration_methods)


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


def test_list_buckets_prefers_quota_max_size_bytes_when_both_units_are_present(monkeypatch):
    service = BucketsService()
    account = _build_account()
    monkeypatch.setattr(s3_client, "list_buckets", lambda **kwargs: [{"name": "bucket-a"}])

    max_size_bytes = 10 * 1024 * 1024 * 1024
    max_size_kb = max_size_bytes // 1024

    monkeypatch.setattr(
        service,
        "_admin_bucket_list",
        lambda *args, **kwargs: [
            {
                "bucket": "bucket-a",
                "usage": {"rgw.main": {"size_actual": 2048, "num_objects": 5}},
                "bucket_quota": {
                    "max_size": max_size_bytes,
                    "max_size_kb": max_size_kb,
                    "max_objects": 10,
                },
            }
        ],
    )

    buckets = service.list_buckets(account, with_stats=True)

    assert len(buckets) == 1
    assert buckets[0].quota_max_size_bytes == max_size_bytes
    assert buckets[0].quota_max_size_bytes != max_size_bytes * 1024


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

    monkeypatch.setattr(service.configuration, "get_bucket_versioning_status", fake_get_versioning)
    monkeypatch.setattr(
        service.configuration,
        "get_bucket_properties",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("get_bucket_properties should not be called")),
    )
    monkeypatch.setattr(
        service.configuration,
        "get_lifecycle",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("get_lifecycle should not be called")),
    )
    monkeypatch.setattr(
        service.configuration,
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

    monkeypatch.setattr(service.configuration, "get_bucket_properties", fake_get_properties)
    monkeypatch.setattr(
        service.configuration,
        "get_bucket_versioning_status",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("dedicated versioning API should not be called")),
    )
    monkeypatch.setattr(
        service.configuration,
        "get_bucket_cors",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("dedicated cors API should not be called")),
    )

    buckets = service.list_buckets(account, include={"versioning", "cors"}, with_stats=False)

    assert calls["properties"] == 1
    assert buckets[0].features is not None
    assert buckets[0].features["versioning"].state == "Enabled"
    assert buckets[0].features["cors"].state == "Not set"


def test_list_buckets_notifications_feature_statuses(monkeypatch):
    service = BucketsService()
    account = _build_account()
    monkeypatch.setattr(
        s3_client,
        "list_buckets",
        lambda **kwargs: [{"name": "bucket-configured"}, {"name": "bucket-empty"}, {"name": "bucket-failing"}],
    )
    monkeypatch.setattr(service, "_admin_bucket_list", lambda *args, **kwargs: [])

    def fake_get_notifications(bucket_name, *_args, **_kwargs):
        if bucket_name == "bucket-configured":
            return BucketNotificationConfiguration(
                configuration={
                    "TopicConfigurations": [
                        {
                            "Id": "topic-1",
                            "TopicArn": "arn:aws:sns:us-east-1:123456789012:bucket-events",
                            "Events": ["s3:ObjectCreated:*"],
                        }
                    ]
                }
            )
        if bucket_name == "bucket-empty":
            return BucketNotificationConfiguration(configuration={"TopicConfigurations": [], "QueueConfigurations": [{}]})
        raise RuntimeError("GetBucketNotificationConfiguration failed")

    monkeypatch.setattr(service.configuration, "get_bucket_notifications", fake_get_notifications)

    buckets = service.list_buckets(account, include={"notifications"}, with_stats=False)
    features = {bucket.name: bucket.features["notifications"] for bucket in buckets if bucket.features}

    assert features["bucket-configured"].state == "Configured"
    assert features["bucket-configured"].tone == "active"
    assert features["bucket-empty"].state == "Not set"
    assert features["bucket-empty"].tone == "inactive"
    assert features["bucket-failing"].state == "Unavailable"
    assert features["bucket-failing"].tone == "unknown"


def test_list_buckets_notifications_unavailable_when_sns_disabled(monkeypatch):
    service = BucketsService()
    account = _build_account()
    account.storage_endpoint = StorageEndpoint(
        name="Ceph no SNS",
        endpoint_url="http://127.0.0.1:9000",
        provider="ceph",
        region=None,
        features_config="features:\n  sns:\n    enabled: false\n",
    )
    monkeypatch.setattr(s3_client, "list_buckets", lambda **kwargs: [{"name": "bucket-a"}])
    monkeypatch.setattr(service, "_admin_bucket_list", lambda *args, **kwargs: [])

    calls = {"notifications": 0}

    def fake_get_notifications(*_args, **_kwargs):
        calls["notifications"] += 1
        raise AssertionError("notifications must not be fetched when SNS is disabled")

    monkeypatch.setattr(service.configuration, "get_bucket_notifications", fake_get_notifications)

    buckets = service.list_buckets(account, include={"notifications"}, with_stats=False)

    assert calls["notifications"] == 0
    assert buckets[0].features is not None
    assert buckets[0].features["notifications"].state == "Unavailable"
    assert buckets[0].features["notifications"].tone == "unknown"


def test_set_bucket_quota_calls_single_scope_without_user_lookup(monkeypatch):
    service = BucketConfigurationService()
    account = S3Account(
        name="quota-owner",
        rgw_account_id=None,
        rgw_user_uid="RGW00000000000000001$tests3user",
    )

    captured: dict = {}

    class FakeRGWAdmin:
        def get_user(self, *args, **kwargs):
            raise AssertionError("set_bucket_quota must not perform fallback user lookups")

        def set_bucket_quota(self, **kwargs):
            captured.update(kwargs)
            return {"ok": True}

    monkeypatch.setattr(service, "_rgw_bucket_quota_admin_for_account", lambda *_: FakeRGWAdmin())

    service.set_bucket_quota(
        "bucket-a",
        account,
        BucketQuotaUpdate(max_size_gb=10, max_size_unit="GiB", max_objects=1000),
    )

    assert captured["bucket"] == "bucket-a"
    assert captured["tenant"] is None
    assert captured["uid"] == "RGW00000000000000001$tests3user"
    assert captured["max_size_bytes"] == 10 * 1024 * 1024 * 1024
    assert captured["max_objects"] == 1000
    assert captured["enabled"] is True
    assert "account_id" not in captured


def test_set_bucket_quota_uses_injected_rgw_admin_client(monkeypatch):
    service = BucketConfigurationService()
    account = S3Account(
        name="quota-owner-account",
        rgw_account_id="RGW00000000000000009",
        rgw_user_uid=None,
    )
    captured: dict = {}

    class FakeRGWAdmin:
        def set_bucket_quota(self, **kwargs):
            captured.update(kwargs)
            return {"ok": True}

    monkeypatch.setattr(
        service,
        "_rgw_bucket_quota_admin_for_account",
        lambda *_: (_ for _ in ()).throw(AssertionError("injected rgw_admin must be used")),
    )

    service.set_bucket_quota(
        "bucket-b",
        account,
        BucketQuotaUpdate(max_size_gb=5, max_size_unit="GiB"),
        rgw_admin=FakeRGWAdmin(),
    )

    assert captured["bucket"] == "bucket-b"
    assert captured["uid"] == "RGW00000000000000009-admin"
    assert captured["tenant"] is None


def test_set_bucket_quota_uses_endpoint_admin_credentials(monkeypatch):
    service = BucketConfigurationService()
    account = S3Account(
        name="quota-owner-account",
        rgw_account_id="RGW00000000000000009",
        rgw_user_uid=None,
    )
    account.storage_endpoint = StorageEndpoint(
        name="Ceph endpoint",
        endpoint_url="https://s3.example.test",
        admin_endpoint="https://admin.example.test",
        provider="ceph",
        admin_access_key="endpoint-admin-ak",
        admin_secret_key="endpoint-admin-sk",
        ceph_admin_access_key="ceph-admin-ak",
        ceph_admin_secret_key="ceph-admin-sk",
        features_config='{"admin":{"enabled":true,"endpoint":"https://admin.example.test"}}',
    )
    captured: dict = {}

    class FakeRGWAdmin:
        def set_bucket_quota(self, **kwargs):
            captured["quota"] = kwargs
            return {"ok": True}

    def fake_get_rgw_admin_client(**kwargs):
        captured["client"] = kwargs
        return FakeRGWAdmin()

    monkeypatch.setattr("app.services.bucket_configuration_service.get_rgw_admin_client", fake_get_rgw_admin_client)

    service.set_bucket_quota(
        "bucket-b",
        account,
        BucketQuotaUpdate(max_size_gb=5, max_size_unit="GiB"),
    )

    assert captured["client"]["access_key"] == "endpoint-admin-ak"
    assert captured["client"]["secret_key"] == "endpoint-admin-sk"
    assert captured["client"]["access_key"] != "ceph-admin-ak"
    assert captured["quota"]["bucket"] == "bucket-b"
    assert captured["quota"]["uid"] == "RGW00000000000000009-admin"


def test_set_bucket_quota_raises_when_rgw_reports_not_found(monkeypatch):
    service = BucketConfigurationService()
    account = S3Account(
        name="quota-owner-account",
        rgw_account_id="RGW00000000000000009",
        rgw_user_uid=None,
    )

    class FakeRGWAdmin:
        def set_bucket_quota(self, **kwargs):
            return {"not_found": True}

    monkeypatch.setattr(service, "_rgw_bucket_quota_admin_for_account", lambda *_: FakeRGWAdmin())

    try:
        service.set_bucket_quota(
            "bucket-b",
            account,
            BucketQuotaUpdate(max_size_gb=5, max_size_unit="GiB"),
        )
        assert False, "Expected RuntimeError for not_found bucket quota response"
    except RuntimeError as exc:
        assert "not found" in str(exc).lower()
