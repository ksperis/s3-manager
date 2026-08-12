# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from types import SimpleNamespace

from app.db import S3Account
from app.models.bucket import (
    Bucket,
    BucketLifecycleConfig,
    BucketLoggingConfiguration,
    BucketObjectLock,
    BucketPublicAccessBlock,
    BucketTag,
)
from app.models.bucket_config_backup import (
    BucketConfigBackupRequest,
    BucketConfigBackupSource,
)
from app.routers.ceph_admin import bucket_tools as buckets_router
from app.services.bucket_config_backup_service import BucketConfigBackupService
from app.services.s3_execution_context import S3ExecutionContext


class FakeBucketsService:
    def get_bucket_stats(self, bucket_name, account, with_stats=True):  # noqa: ANN001
        assert bucket_name == "bucket-a"
        assert account.name == "account-a"
        assert with_stats is True
        return Bucket(name=bucket_name, quota_max_size_bytes=1024, quota_max_objects=7)

    def get_bucket_versioning_status(self, bucket_name, account):  # noqa: ANN001
        return "Enabled"

    def get_object_lock(self, bucket_name, account):  # noqa: ANN001
        return BucketObjectLock(enabled=True, mode="GOVERNANCE", days=30)

    def get_public_access_block(self, bucket_name, account):  # noqa: ANN001
        return BucketPublicAccessBlock(block_public_policy=True, restrict_public_buckets=True)

    def get_lifecycle(self, bucket_name, account):  # noqa: ANN001
        return BucketLifecycleConfig(rules=[{"ID": "expire-old", "Status": "Enabled"}])

    def get_bucket_cors(self, bucket_name, account):  # noqa: ANN001
        return [{"AllowedMethods": ["GET"], "AllowedOrigins": ["*"]}]

    def get_policy(self, bucket_name, account):  # noqa: ANN001
        return {"Version": "2012-10-17", "Statement": []}

    def get_bucket_logging(self, bucket_name, account):  # noqa: ANN001
        return BucketLoggingConfiguration(enabled=True, target_bucket="logs", target_prefix="bucket-a/")

    def get_bucket_tags(self, bucket_name, account):  # noqa: ANN001
        return [BucketTag(key="env", value="prod")]


def test_bucket_config_backup_request_normalizes_duplicates():
    payload = BucketConfigBackupRequest(
        buckets=[" bucket-a ", "bucket-a", "bucket-b"],
        features=["tags", "tags", "policy"],
    )

    assert payload.buckets == ["bucket-a", "bucket-b"]
    assert payload.features == ["tags", "policy"]


def test_bucket_config_backup_collects_selected_features_without_secrets():
    account = S3ExecutionContext(
        context_id="account-a",
        context_kind="account",
        name="account-a",
        access_key="AKIA_TEST",
        secret_key="SECRET_TEST",
    )
    service = BucketConfigBackupService(FakeBucketsService())

    backup = service.build_backup(
        account=account,
        bucket_names=["bucket-a"],
        features=[
            "quota",
            "versioning",
            "object_lock",
            "public_access_block",
            "lifecycle",
            "cors",
            "policy",
            "access_logging",
            "tags",
        ],
        source=BucketConfigBackupSource(surface="ceph-admin", endpoint_id=7, endpoint_name="Archive"),
    )

    bucket = backup.buckets[0]
    assert backup.kind == "ceph-admin.bucket-config-backup"
    assert backup.version == 1
    assert backup.source.endpoint_id == 7
    assert bucket.name == "bucket-a"
    assert bucket.errors == {}
    assert bucket.configuration["quota"] == {"max_size_bytes": 1024, "max_objects": 7}
    assert bucket.configuration["versioning"] == {"status": "Enabled", "enabled": True}
    assert bucket.configuration["lifecycle"] == {"rules": [{"ID": "expire-old", "Status": "Enabled"}]}
    assert bucket.configuration["policy"] == {"policy": {"Version": "2012-10-17", "Statement": []}}
    assert bucket.configuration["tags"] == {"tags": [{"key": "env", "value": "prod"}]}
    dumped = backup.model_dump_json()
    assert "SECRET_TEST" not in dumped
    assert "AKIA_TEST" not in dumped


def test_bucket_config_backup_captures_feature_errors():
    class FailingPolicyService(FakeBucketsService):
        def get_policy(self, bucket_name, account):  # noqa: ANN001
            raise RuntimeError("policy denied")

    service = BucketConfigBackupService(FailingPolicyService())

    backup = service.build_backup(
        account=S3Account(name="account-a"),
        bucket_names=["bucket-a"],
        features=["policy", "tags"],
        source=BucketConfigBackupSource(surface="ceph-admin", endpoint_id=7, endpoint_name="Archive"),
    )

    bucket = backup.buckets[0]
    assert "policy" not in bucket.configuration
    assert bucket.errors == {"policy": "policy denied"}
    assert bucket.configuration["tags"] == {"tags": [{"key": "env", "value": "prod"}]}


def test_ceph_admin_backup_route_uses_endpoint_quota_loader(monkeypatch):
    class RouteBucketsService(FakeBucketsService):
        def get_bucket_versioning_status(self, bucket_name, account):  # noqa: ANN001
            assert account.name == "ceph-admin:7"
            return "Suspended"

    class FakeRGWAdmin:
        def get_bucket_info(self, bucket_name, stats=True, allow_not_found=True):  # noqa: ANN001
            assert bucket_name == "bucket-a"
            assert stats is True
            assert allow_not_found is True
            return {"bucket": "bucket-a", "bucket_quota": {"max_size": 2048, "max_objects": 3}}

    monkeypatch.setattr(buckets_router, "BucketsService", lambda: RouteBucketsService())
    ctx = SimpleNamespace(
        endpoint=SimpleNamespace(id=7, name="Archive"),
        rgw_admin=FakeRGWAdmin(),
        access_key="AKIA_TEST",
        secret_key="SECRET_TEST",
    )

    backup = buckets_router.backup_bucket_configs(
        payload=BucketConfigBackupRequest(buckets=["bucket-a"], features=["quota", "versioning"]),
        ctx=ctx,
    )

    assert backup.source.surface == "ceph-admin"
    assert backup.source.endpoint_id == 7
    assert backup.buckets[0].configuration["quota"] == {"max_size_bytes": 2048, "max_objects": 3}
    assert backup.buckets[0].configuration["versioning"] == {"status": "Suspended", "enabled": False}
