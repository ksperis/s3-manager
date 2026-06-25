# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from types import SimpleNamespace

from app.services.bucket_purge_service import (
    BucketPurgeOptions,
    BucketPurgeResolvedTarget,
    BucketPurgeService,
)


def test_delete_bucket_with_purge_deletes_contents_then_bucket(monkeypatch):
    class DeleteClient:
        def __init__(self):
            self.object_list_calls = 0
            self.version_list_calls = 0
            self.delete_object_calls: list[list[dict]] = []
            self.delete_bucket_calls: list[str] = []

        def list_objects_v2(self, **kwargs):
            self.object_list_calls += 1
            return {"Contents": [{"Key": "one.txt"}, {"Key": "two.txt"}]}

        def list_object_versions(self, **kwargs):
            self.version_list_calls += 1
            return {
                "Versions": [{"Key": "one.txt", "VersionId": "v1"}],
                "DeleteMarkers": [{"Key": "two.txt", "VersionId": "m1"}],
            }

        def delete_objects(self, **kwargs):
            objects = list(kwargs["Delete"]["Objects"])
            self.delete_object_calls.append(objects)
            return {"Deleted": objects}

        def delete_bucket(self, **kwargs):
            self.delete_bucket_calls.append(kwargs["Bucket"])

    client = DeleteClient()
    monkeypatch.setattr(BucketPurgeService, "_build_client", lambda self, account: client)

    result = BucketPurgeService().run_delete_bucket_with_purge(
        BucketPurgeResolvedTarget(account=SimpleNamespace(), bucket_name="bucket-a", context_id="s3u-1"),
        BucketPurgeOptions(parallelism=4, include_versions=True),
    )

    assert result.status == "completed"
    assert result.bucket_deleted is True
    assert result.deleted_objects == 2
    assert result.deleted_versions == 2
    assert client.delete_bucket_calls == ["bucket-a"]
    assert sorted(len(call) for call in client.delete_object_calls) == [2, 2]


def test_delete_bucket_with_purge_refuses_over_limit_before_deleting(monkeypatch):
    class OverLimitClient:
        def __init__(self):
            self.object_list_calls = 0
            self.delete_object_calls = 0
            self.delete_bucket_calls = 0

        def list_objects_v2(self, **kwargs):
            self.object_list_calls += 1
            page = {"Contents": [{"Key": f"object-{self.object_list_calls}-{idx}"} for idx in range(1000)]}
            if self.object_list_calls < 11:
                page["NextContinuationToken"] = f"page-{self.object_list_calls + 1}"
            return page

        def delete_objects(self, **kwargs):
            self.delete_object_calls += 1
            return {"Deleted": []}

        def delete_bucket(self, **kwargs):
            self.delete_bucket_calls += 1

    client = OverLimitClient()
    monkeypatch.setattr(BucketPurgeService, "_build_client", lambda self, account: client)

    result = BucketPurgeService().run_delete_bucket_with_purge(
        BucketPurgeResolvedTarget(account=SimpleNamespace(), bucket_name="bucket-huge", context_id="s3u-1"),
        BucketPurgeOptions(parallelism=4, include_versions=True),
    )

    assert result.status == "failed"
    assert result.bucket_deleted is False
    assert result.deleted_objects == 0
    assert result.deleted_versions == 0
    assert client.delete_object_calls == 0
    assert client.delete_bucket_calls == 0
    assert "more than 10,000 deletable entries" in result.buckets[0].failures_sample[0].message
