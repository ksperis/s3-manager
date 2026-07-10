# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from types import SimpleNamespace

from app.services import bucket_purge_service
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


def test_delete_bucket_with_purge_deletes_large_bucket_without_entry_limit(monkeypatch):
    class LargeBucketClient:
        def __init__(self):
            self.object_list_calls = 0
            self.delete_object_calls: list[list[dict]] = []
            self.delete_bucket_calls: list[str] = []

        def list_objects_v2(self, **kwargs):
            self.object_list_calls += 1
            page = {"Contents": [{"Key": f"object-{self.object_list_calls}-{idx}"} for idx in range(1000)]}
            if self.object_list_calls < 11:
                page["NextContinuationToken"] = f"page-{self.object_list_calls + 1}"
            return page

        def list_object_versions(self, **kwargs):
            return {}

        def delete_objects(self, **kwargs):
            objects = list(kwargs["Delete"]["Objects"])
            self.delete_object_calls.append(objects)
            return {"Deleted": objects}

        def delete_bucket(self, **kwargs):
            self.delete_bucket_calls.append(kwargs["Bucket"])

    client = LargeBucketClient()
    monkeypatch.setattr(BucketPurgeService, "_build_client", lambda self, account: client)

    result = BucketPurgeService().run_delete_bucket_with_purge(
        BucketPurgeResolvedTarget(account=SimpleNamespace(), bucket_name="bucket-huge", context_id="s3u-1"),
        BucketPurgeOptions(parallelism=4, include_versions=True),
    )

    assert result.status == "completed"
    assert result.bucket_deleted is True
    assert result.listed_objects == 11000
    assert result.deleted_objects == 11000
    assert result.deleted_versions == 0
    assert sum(len(call) for call in client.delete_object_calls) == 11000
    assert client.delete_bucket_calls == ["bucket-huge"]


def test_purge_progress_uses_rgw_stats_entry_estimate_before_listing(monkeypatch):
    class EstimateBucketsService:
        def list_buckets(self, account, *, with_stats=True):
            assert with_stats is True
            return [SimpleNamespace(name="bucket-a", object_count=5)]

    class PurgeClient:
        def list_objects_v2(self, **kwargs):
            return {"Contents": [{"Key": "one.txt"}, {"Key": "two.txt"}]}

        def list_object_versions(self, **kwargs):
            return {}

        def delete_objects(self, **kwargs):
            objects = list(kwargs["Delete"]["Objects"])
            return {"Deleted": objects}

    monkeypatch.setattr(bucket_purge_service, "BucketsService", EstimateBucketsService)
    monkeypatch.setattr(BucketPurgeService, "_build_client", lambda self, account: PurgeClient())
    progress_events = []

    result = BucketPurgeService().run(
        [BucketPurgeResolvedTarget(account=SimpleNamespace(), bucket_name="bucket-a", context_id="s3u-1")],
        BucketPurgeOptions(parallelism=4, include_versions=True),
        progress_callback=progress_events.append,
    )

    assert result.status == "completed"
    assert progress_events[0].stage == "prepare"
    assert progress_events[0].total_entries_estimate == 5
    assert progress_events[0].total_entries_final is False
    list_progress = next(event for event in progress_events if event.stage == "list" and event.listed_objects == 2)
    assert list_progress.total_entries_estimate == 5
    assert list_progress.total_entries_final is False
    assert progress_events[-1].stage == "completed"
    assert progress_events[-1].total_entries_estimate == 2
    assert progress_events[-1].total_entries_final is True


def test_purge_progress_continues_when_rgw_stats_are_unavailable(monkeypatch):
    class BrokenBucketsService:
        def list_buckets(self, account, *, with_stats=True):
            raise RuntimeError("stats unavailable")

    class PurgeClient:
        def list_objects_v2(self, **kwargs):
            return {"Contents": [{"Key": "one.txt"}]}

        def list_object_versions(self, **kwargs):
            return {}

        def delete_objects(self, **kwargs):
            objects = list(kwargs["Delete"]["Objects"])
            return {"Deleted": objects}

    monkeypatch.setattr(bucket_purge_service, "BucketsService", BrokenBucketsService)
    monkeypatch.setattr(BucketPurgeService, "_build_client", lambda self, account: PurgeClient())
    progress_events = []

    result = BucketPurgeService().run(
        [BucketPurgeResolvedTarget(account=SimpleNamespace(), bucket_name="bucket-a", context_id="s3u-1")],
        BucketPurgeOptions(parallelism=4, include_versions=True),
        progress_callback=progress_events.append,
    )

    assert result.status == "completed"
    assert progress_events[0].stage == "prepare"
    assert progress_events[0].total_entries_estimate is None
    assert progress_events[-1].stage == "completed"
    assert progress_events[-1].total_entries_estimate == 1
    assert progress_events[-1].total_entries_final is True


def test_purge_service_forwards_individual_delete_strategy(monkeypatch):
    class NoStatsBucketsService:
        def list_buckets(self, account, *, with_stats=True):
            return []

    captured: dict[str, object] = {}

    def fake_purge_bucket_contents(client, bucket_name, **kwargs):
        captured["client"] = client
        captured["bucket_name"] = bucket_name
        captured.update(kwargs)
        return bucket_purge_service.s3_client.BucketContentPurgeResult(bucket_name=bucket_name)

    client = SimpleNamespace()
    monkeypatch.setattr(bucket_purge_service, "BucketsService", NoStatsBucketsService)
    monkeypatch.setattr(BucketPurgeService, "_build_client", lambda self, account: client)
    monkeypatch.setattr(bucket_purge_service.s3_client, "purge_bucket_contents", fake_purge_bucket_contents)

    result = BucketPurgeService().run(
        [BucketPurgeResolvedTarget(account=SimpleNamespace(), bucket_name="bucket-a", context_id="ceph-admin-7")],
        BucketPurgeOptions(parallelism=4, include_versions=True, individual_deletes=True),
    )

    assert result.status == "completed"
    assert captured["client"] is client
    assert captured["bucket_name"] == "bucket-a"
    assert captured["parallelism"] == 4
    assert captured["include_versions"] is True
    assert captured["individual_deletes"] is True
