# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from datetime import datetime, timezone
import shutil

import pytest
from botocore.exceptions import ClientError

from app.db import S3Account
from app.models.bucket import (
    BucketLoggingConfiguration,
    BucketProperties,
    BucketTag,
    BucketObjectLock,
    BucketPublicAccessBlock,
    LifecycleRule,
)
from app.services import bucket_compare_remediation, object_listing_temp_store
from app.services import buckets_service as buckets_service_module
from app.services.bucket_content_comparison import BucketCompareObjectEntry
from app.services.buckets_service import BucketsService


def _build_account(name: str) -> S3Account:
    return S3Account(
        name=name,
        rgw_account_id="RGW00000000000000001",
        rgw_access_key="AKIA_TEST",
        rgw_secret_key="SECRET_TEST",
    )


def _payload_entries(payload: dict[str, dict[str, object]]):
    for key, entry in payload.items():
        last_modified = entry.get("last_modified")
        storage_class = entry.get("storage_class")
        yield BucketCompareObjectEntry(
            key=key,
            size=int(entry.get("size") or 0),
            etag=entry.get("etag") if isinstance(entry.get("etag"), str) else None,
            last_modified=last_modified if isinstance(last_modified, datetime) else None,
            storage_class=storage_class if isinstance(storage_class, str) else None,
        )


def test_bucket_compare_types_are_owned_by_dedicated_module():
    assert not hasattr(buckets_service_module, "_BucketCompareObjectEntry")
    assert not hasattr(buckets_service_module, "_BucketCompareObjectIndex")
    assert not hasattr(buckets_service_module, "BucketCompareRemediationResult")


def test_compare_bucket_content_uses_md5_then_size_fallback(monkeypatch):
    service = BucketsService()
    source = _build_account("source")
    target = _build_account("target")
    older = datetime(2026, 3, 1, 10, 0, tzinfo=timezone.utc)
    payloads = {
        "source-bucket": {
            "same-md5": {"size": 10, "etag": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},
            "fallback-size": {"size": 20, "etag": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb-2"},
            "only-source": {
                "size": 30,
                "etag": "cccccccccccccccccccccccccccccccc",
                "last_modified": older,
                "storage_class": "STANDARD",
            },
        },
        "target-bucket": {
            "same-md5": {"size": 10, "etag": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},
            "fallback-size": {"size": 20, "etag": "dddddddddddddddddddddddddddddddd-3"},
            "only-target": {
                "size": 40,
                "etag": "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
                "last_modified": older,
                "storage_class": "GLACIER",
            },
        },
    }

    monkeypatch.setattr(
        service,
        "_list_bucket_objects_for_compare",
        lambda bucket_name, _account: _payload_entries(payloads[bucket_name]),
    )

    diff = service.compare_bucket_content("source-bucket", source, "target-bucket", target)

    assert diff.source_count == 3
    assert diff.target_count == 3
    assert diff.matched_count == 2
    assert diff.different_count == 0
    assert diff.only_source_count == 1
    assert diff.only_target_count == 1
    assert diff.only_source_sample == ["only-source"]
    assert diff.only_target_sample == ["only-target"]
    assert diff.only_source_details[0].key == "only-source"
    assert diff.only_source_details[0].size == 30
    assert diff.only_source_details[0].last_modified == older
    assert diff.only_source_details[0].storage_class == "STANDARD"
    assert diff.only_target_details[0].storage_class == "GLACIER"


def test_compare_bucket_content_detects_md5_mismatch(monkeypatch):
    service = BucketsService()
    source = _build_account("source")
    target = _build_account("target")
    payloads = {
        "source-bucket": {
            "object-a": {"size": 1024, "etag": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},
        },
        "target-bucket": {
            "object-a": {"size": 1024, "etag": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"},
        },
    }
    monkeypatch.setattr(
        service,
        "_list_bucket_objects_for_compare",
        lambda bucket_name, _account: _payload_entries(payloads[bucket_name]),
    )

    diff = service.compare_bucket_content("source-bucket", source, "target-bucket", target)

    assert diff.matched_count == 0
    assert diff.different_count == 1
    assert diff.only_source_count == 0
    assert diff.only_target_count == 0
    assert len(diff.different_sample) == 1
    assert diff.different_sample[0].compare_by == "md5"


def test_compare_bucket_content_reports_different_sample(monkeypatch):
    service = BucketsService()
    source = _build_account("source")
    target = _build_account("target")
    older = datetime(2026, 3, 1, 10, 0, tzinfo=timezone.utc)
    payloads = {
        "source-bucket": {
            "object-a": {
                "size": 1024,
                "etag": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-2",
                "last_modified": older,
                "storage_class": "STANDARD",
            },
        },
        "target-bucket": {
            "object-a": {
                "size": 2048,
                "etag": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb-2",
                "last_modified": older,
                "storage_class": "STANDARD_IA",
            },
        },
    }
    monkeypatch.setattr(
        service,
        "_list_bucket_objects_for_compare",
        lambda bucket_name, _account: _payload_entries(payloads[bucket_name]),
    )

    diff = service.compare_bucket_content("source-bucket", source, "target-bucket", target)

    assert diff.different_count == 1
    assert len(diff.different_sample) == 1
    assert diff.different_sample[0].key == "object-a"
    assert diff.different_sample[0].compare_by == "size"
    assert diff.different_sample[0].source_last_modified == older
    assert diff.different_sample[0].target_last_modified == older
    assert diff.different_sample[0].source_storage_class == "STANDARD"
    assert diff.different_sample[0].target_storage_class == "STANDARD_IA"


def test_compare_bucket_content_limits_display_rows_but_keeps_totals(monkeypatch):
    service = BucketsService()
    source = _build_account("source")
    target = _build_account("target")

    def large_listing(bucket_name, _account):
        if bucket_name == "source-bucket":
            for index in range(1005):
                yield BucketCompareObjectEntry(key=f"source-only-{index:04d}", size=index)
            for index in range(1007):
                yield BucketCompareObjectEntry(key=f"different-{index:04d}", size=index)
            return

        for index in range(1003):
            yield BucketCompareObjectEntry(key=f"target-only-{index:04d}", size=index)
        for index in range(1007):
            yield BucketCompareObjectEntry(key=f"different-{index:04d}", size=index + 1)

    monkeypatch.setattr(
        service,
        "_list_bucket_objects_for_compare",
        large_listing,
    )

    diff = service.compare_bucket_content("source-bucket", source, "target-bucket", target)

    assert diff.only_source_count == 1005
    assert diff.only_target_count == 1003
    assert diff.different_count == 1007
    assert diff.display_limit == 200
    assert diff.only_source_hidden_count == 805
    assert diff.only_target_hidden_count == 803
    assert diff.different_hidden_count == 807
    assert len(diff.only_source_sample) == 200
    assert len(diff.only_target_sample) == 200
    assert len(diff.only_source_details) == 200
    assert len(diff.only_target_details) == 200
    assert len(diff.different_sample) == 200
    assert diff.only_source_sample[0] == "source-only-0000"
    assert diff.only_source_sample[-1] == "source-only-0199"
    assert diff.different_sample[-1].key == "different-0199"


def test_compare_bucket_content_excludes_entire_key_after_cutoff(monkeypatch):
    service = BucketsService()
    source = _build_account("source")
    target = _build_account("target")
    older = datetime(2026, 3, 1, 10, 0, tzinfo=timezone.utc)
    newer = datetime(2026, 3, 3, 10, 0, tzinfo=timezone.utc)
    cutoff = datetime(2026, 3, 2, 10, 0, tzinfo=timezone.utc)
    payloads = {
        "source-bucket": {
            "old-only-source": {"size": 1, "etag": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "last_modified": older},
            "new-only-source": {"size": 1, "etag": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "last_modified": newer},
            "new-common": {"size": 1, "etag": "cccccccccccccccccccccccccccccccc", "last_modified": newer},
        },
        "target-bucket": {
            "new-common": {"size": 2, "etag": "dddddddddddddddddddddddddddddddd", "last_modified": older},
            "new-only-target": {"size": 1, "etag": "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee", "last_modified": newer},
        },
    }
    monkeypatch.setattr(
        service,
        "_list_bucket_objects_for_compare",
        lambda bucket_name, _account: _payload_entries(payloads[bucket_name]),
    )

    diff = service.compare_bucket_content(
        "source-bucket",
        source,
        "target-bucket",
        target,
        ignore_modified_after=cutoff,
    )

    assert diff.source_count == 1
    assert diff.target_count == 0
    assert diff.only_source_sample == ["old-only-source"]
    assert diff.only_target_sample == []
    assert diff.different_count == 0
    assert diff.ignored_after_cutoff_count == 3


def test_compare_bucket_content_wraps_list_objects_client_error(monkeypatch):
    service = BucketsService()
    source = _build_account("source")
    target = _build_account("target")

    class DeniedClient:
        def list_objects_v2(self, **_kwargs):
            raise ClientError(
                {"Error": {"Code": "AccessDenied", "Message": None}},
                "ListObjectsV2",
            )

    monkeypatch.setattr(service, "_compare_client", lambda _account: DeniedClient())

    with pytest.raises(RuntimeError) as exc:
        service.compare_bucket_content(
            "source-bucket",
            source,
            "target-bucket",
            target,
        )

    message = str(exc.value)
    assert "Unable to list objects in bucket 'source-bucket'" in message
    assert "ListObjectsV2 failed with AccessDenied" in message


def test_compare_bucket_content_cleans_temp_store_when_listing_fails(monkeypatch, tmp_path):
    service = BucketsService()
    source = _build_account("source")
    target = _build_account("target")
    created_paths = []

    class RecordingTemporaryDirectory:
        def __init__(self, prefix):
            self.path = tmp_path / f"{prefix}recorded"
            self.path.mkdir()
            created_paths.append(self.path)
            self.name = str(self.path)

        def cleanup(self):
            shutil.rmtree(self.path, ignore_errors=True)

    def list_or_fail(bucket_name, _account):
        if bucket_name == "source-bucket":
            yield BucketCompareObjectEntry(key="source-only", size=1)
            return
        raise RuntimeError("target listing failed")

    monkeypatch.setattr(object_listing_temp_store.tempfile, "TemporaryDirectory", RecordingTemporaryDirectory)
    monkeypatch.setattr(service, "_list_bucket_objects_for_compare", list_or_fail)

    with pytest.raises(RuntimeError, match="target listing failed"):
        service.compare_bucket_content("source-bucket", source, "target-bucket", target)

    assert created_paths
    assert all(not path.exists() for path in created_paths)


def test_compare_remediation_uses_requested_object_keys(monkeypatch):
    service = BucketsService()
    source = _build_account("source")
    target = _build_account("target")
    requested_keys: list[str] = []
    monkeypatch.setattr(
        service,
        "_list_bucket_objects_for_compare",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("remediation must not re-list objects")),
    )
    monkeypatch.setattr(service, "_compare_client", lambda _account: object())
    monkeypatch.setattr(service, "_accounts_share_storage_endpoint", lambda _source, _target: True)

    def fake_remediate(**kwargs):
        requested_keys.extend(kwargs["object_keys"])
        return bucket_compare_remediation.BucketCompareRemediationResult(
            action=kwargs["action"],
            planned_count=len(kwargs["object_keys"]),
            succeeded_count=len(kwargs["object_keys"]),
            failed_count=0,
            failed_keys_sample=[],
        )

    monkeypatch.setattr(bucket_compare_remediation, "remediate_bucket_content", fake_remediate)

    result = service.run_compare_content_remediation(
        "source-bucket",
        source,
        "target-bucket",
        target,
        action="sync_source_only",
        object_keys=["old-only-source"],
    )

    assert result.planned_count == 1
    assert result.succeeded_count == 1
    assert requested_keys == ["old-only-source"]


def test_bucket_compare_remediation_copies_requested_objects():
    copied_keys: list[str] = []

    class TargetClient:
        def copy_object(self, *, Bucket, Key, CopySource):
            assert Bucket == "target-bucket"
            assert CopySource == {"Bucket": "source-bucket", "Key": Key}
            copied_keys.append(Key)

    result = bucket_compare_remediation.remediate_bucket_content(
        source_client=object(),
        target_client=TargetClient(),
        source_bucket="source-bucket",
        target_bucket="target-bucket",
        action="sync_source_only",
        object_keys=["object-b", "object-a"],
        same_endpoint=True,
        parallelism=1,
    )

    assert result.planned_count == 2
    assert result.succeeded_count == 2
    assert result.failed_count == 0
    assert copied_keys == ["object-b", "object-a"]


def test_compare_bucket_configuration_detects_changes(monkeypatch):
    service = BucketsService()
    source = _build_account("source")
    target = _build_account("target")

    properties = {
        "source-bucket": BucketProperties(
            versioning_status="Enabled",
            object_lock_enabled=True,
            object_lock=BucketObjectLock(enabled=True, mode="GOVERNANCE", days=1, years=None),
            public_access_block=BucketPublicAccessBlock(
                block_public_acls=True,
                ignore_public_acls=True,
                block_public_policy=True,
                restrict_public_buckets=True,
            ),
            lifecycle_rules=[LifecycleRule(id="rule-a", status="Enabled", prefix="logs/")],
            cors_rules=[{"AllowedOrigins": ["*"], "AllowedMethods": ["GET"]}],
        ),
        "target-bucket": BucketProperties(
            versioning_status="Suspended",
            object_lock_enabled=False,
            object_lock=BucketObjectLock(enabled=False, mode=None, days=None, years=None),
            public_access_block=BucketPublicAccessBlock(
                block_public_acls=False,
                ignore_public_acls=False,
                block_public_policy=False,
                restrict_public_buckets=False,
            ),
            lifecycle_rules=[],
            cors_rules=[],
        ),
    }

    monkeypatch.setattr(service, "get_bucket_properties", lambda bucket_name, _account: properties[bucket_name])
    monkeypatch.setattr(
        service,
        "get_policy",
        lambda bucket_name, _account: {"Statement": [{"Sid": "A"}]} if bucket_name == "source-bucket" else None,
    )
    monkeypatch.setattr(
        service,
        "get_bucket_logging",
        lambda bucket_name, _account: BucketLoggingConfiguration(
            enabled=bucket_name == "source-bucket",
            target_bucket="logs" if bucket_name == "source-bucket" else None,
            target_prefix="source/" if bucket_name == "source-bucket" else None,
        ),
    )
    monkeypatch.setattr(
        service,
        "get_bucket_tags",
        lambda bucket_name, _account: [BucketTag(key="env", value="prod")] if bucket_name == "source-bucket" else [],
    )

    diff = service.compare_bucket_configuration("source-bucket", source, "target-bucket", target)

    assert diff.changed is True
    section_by_key = {section.key: section for section in diff.sections}
    assert section_by_key["versioning_status"].changed is True
    assert section_by_key["bucket_policy"].changed is True
    assert section_by_key["tags"].changed is True


def test_compare_bucket_configuration_filters_selected_sections(monkeypatch):
    service = BucketsService()
    source = _build_account("source")
    target = _build_account("target")
    call_counts = {"properties": 0, "policy": 0, "logging": 0, "tags": 0}

    def fake_properties(_bucket_name, _account):
        call_counts["properties"] += 1
        return BucketProperties(
            versioning_status="Enabled",
            object_lock_enabled=True,
            object_lock=BucketObjectLock(enabled=True, mode="GOVERNANCE", days=1, years=None),
            public_access_block=BucketPublicAccessBlock(
                block_public_acls=True,
                ignore_public_acls=True,
                block_public_policy=True,
                restrict_public_buckets=True,
            ),
            lifecycle_rules=[LifecycleRule(id="rule-a", status="Enabled", prefix="logs/")],
            cors_rules=[{"AllowedOrigins": ["*"], "AllowedMethods": ["GET"]}],
        )

    def fake_policy(_bucket_name, _account):
        call_counts["policy"] += 1
        return {"Statement": [{"Sid": "A"}]}

    def fake_logging(_bucket_name, _account):
        call_counts["logging"] += 1
        return BucketLoggingConfiguration(enabled=True, target_bucket="logs", target_prefix="source/")

    def fake_tags(bucket_name, _account):
        call_counts["tags"] += 1
        if bucket_name == "source-bucket":
            return [BucketTag(key="env", value="prod")]
        return [BucketTag(key="env", value="stage")]

    monkeypatch.setattr(service, "get_bucket_properties", fake_properties)
    monkeypatch.setattr(service, "get_policy", fake_policy)
    monkeypatch.setattr(service, "get_bucket_logging", fake_logging)
    monkeypatch.setattr(service, "get_bucket_tags", fake_tags)

    diff = service.compare_bucket_configuration(
        "source-bucket",
        source,
        "target-bucket",
        target,
        include_sections={"tags"},
    )

    assert diff.changed is True
    assert [section.key for section in diff.sections] == ["tags"]
    assert call_counts["properties"] == 0
    assert call_counts["policy"] == 0
    assert call_counts["logging"] == 0
    assert call_counts["tags"] == 2
