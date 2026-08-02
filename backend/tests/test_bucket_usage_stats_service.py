# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from botocore.exceptions import ClientError

from app.db.bucket_usage_stats import BucketUsageStatsSnapshot as BucketUsageStatsSnapshotRow
from app.services.bucket_usage_stats_service import (
    BucketUsageStatsAggregateTarget,
    BucketUsageStatsResolvedTarget,
    BucketUsageStatsService,
    _load_distribution_entries,
    _load_warnings,
    classify_data_type,
)


class FakePaginator:
    def __init__(self, pages=None, error: Exception | None = None):
        self.pages = pages or []
        self.error = error
        self.calls: list[dict] = []

    def paginate(self, **kwargs):
        self.calls.append(kwargs)
        if self.error:
            raise self.error
        yield from self.pages


class FakeS3Client:
    def __init__(self, paginators: dict[str, FakePaginator]):
        self.paginators = paginators

    def get_paginator(self, name: str) -> FakePaginator:
        return self.paginators[name]


class FakeUsageStatsService(BucketUsageStatsService):
    def __init__(self, client: FakeS3Client):
        super().__init__()
        self.client = client

    def _build_client(self, account):
        return self.client


def _target(bucket_name: str = "bucket-a") -> BucketUsageStatsResolvedTarget:
    return BucketUsageStatsResolvedTarget(
        account=SimpleNamespace(),
        bucket_name=bucket_name,
        scope_kind="manager",
        scope_id="ctx-1",
        scope_name="Context 1",
        context_id="ctx-1",
        context_name="Context 1",
    )


def _client_error(code: str, message: str, operation: str = "ListObjectVersions") -> ClientError:
    return ClientError({"Error": {"Code": code, "Message": message}}, operation)


def _dist(snapshot, key: str, distribution: str = "data_type_distribution"):
    entries = getattr(snapshot, distribution)
    return next(entry for entry in entries if entry.key == key)


def test_classify_data_type_prefers_backup_names_over_archives():
    assert classify_data_type("exports/monthly-backup.zip") == "backups"
    assert classify_data_type("exports/archive.zip") == "archives"
    assert classify_data_type("docs/report.pdf") == "documents"
    assert classify_data_type("dataset/sample.parquet") == "scientific_data"
    assert classify_data_type("src/app.ts") == "source_code"
    assert classify_data_type("README") == "unknown"


def test_persisted_usage_stats_json_uses_strict_list_contracts():
    assert _load_distribution_entries("[]") == []
    assert _load_warnings(None) == []
    assert _load_warnings('["partial"]') == ["partial"]
    for raw in ("{", "{}", '["invalid"]'):
        with pytest.raises((ValueError, TypeError)):
            _load_distribution_entries(raw)
    for raw in ("{", "{}", '["partial",42]'):
        with pytest.raises(ValueError):
            _load_warnings(raw)


def test_usage_stats_calculates_versions_current_noncurrent_and_delete_markers():
    client = FakeS3Client(
        {
            "list_object_versions": FakePaginator(
                [
                    {
                        "Versions": [
                            {
                                "Key": "reports/final.pdf",
                                "VersionId": "v2",
                                "IsLatest": True,
                                "Size": 100,
                                "StorageClass": "STANDARD",
                                "LastModified": datetime(2026, 1, 10, tzinfo=timezone.utc),
                            },
                            {
                                "Key": "reports/final.pdf",
                                "VersionId": "v1",
                                "IsLatest": False,
                                "Size": 40,
                                "StorageClass": "GLACIER",
                                "LastModified": datetime(2025, 12, 10, tzinfo=timezone.utc),
                            },
                            {
                                "Key": "exports/monthly-backup.zip",
                                "VersionId": "v9",
                                "IsLatest": True,
                                "Size": 60,
                                "LastModified": datetime(2026, 1, 11, tzinfo=timezone.utc),
                            },
                        ],
                        "DeleteMarkers": [
                            {"Key": "old/deleted.txt", "VersionId": "d1", "IsLatest": True},
                        ],
                    }
                ]
            )
        }
    )
    service = FakeUsageStatsService(client)

    snapshot = service.calculate_bucket(_target())

    assert snapshot.scan_mode == "versions"
    assert snapshot.version_listing_available is True
    assert snapshot.object_version_count == 3
    assert snapshot.current_version_count == 2
    assert snapshot.noncurrent_version_count == 1
    assert snapshot.delete_marker_count == 1
    assert snapshot.total_bytes == 200
    assert snapshot.current_bytes == 160
    assert snapshot.noncurrent_bytes == 40
    assert _dist(snapshot, "documents").bytes == 140
    assert _dist(snapshot, "backups").bytes == 60
    assert _dist(snapshot, "STANDARD", "storage_class_distribution").bytes == 160
    assert _dist(snapshot, "GLACIER", "storage_class_distribution").bytes == 40
    current = _dist(snapshot, "current", "current_vs_noncurrent")
    noncurrent = _dist(snapshot, "noncurrent", "current_vs_noncurrent")
    assert current.bytes == 160
    assert current.ratio_bytes == pytest.approx(0.8)
    assert noncurrent.bytes == 40
    assert noncurrent.ratio_bytes == pytest.approx(0.2)


def test_usage_stats_falls_back_to_current_objects_when_versions_are_unsupported():
    client = FakeS3Client(
        {
            "list_object_versions": FakePaginator(error=_client_error("NotImplemented", "not implemented")),
            "list_objects_v2": FakePaginator(
                [
                    {
                        "Contents": [
                            {
                                "Key": "images/logo.png",
                                "Size": 10,
                                "StorageClass": "STANDARD",
                                "LastModified": datetime(2026, 1, 10, tzinfo=timezone.utc),
                            }
                        ]
                    }
                ]
            ),
        }
    )
    service = FakeUsageStatsService(client)

    snapshot = service.calculate_bucket(_target())

    assert snapshot.scan_mode == "current_only"
    assert snapshot.version_listing_available is False
    assert snapshot.object_version_count == 1
    assert snapshot.current_version_count == 1
    assert snapshot.noncurrent_version_count == 0
    assert snapshot.total_bytes == 10
    assert snapshot.current_vs_noncurrent == []
    assert snapshot.warnings
    assert _dist(snapshot, "images").bytes == 10


def test_usage_stats_does_not_fallback_on_access_denied():
    client = FakeS3Client(
        {
            "list_object_versions": FakePaginator(error=_client_error("AccessDenied", "denied")),
        }
    )
    service = FakeUsageStatsService(client)

    with pytest.raises(RuntimeError) as exc:
        service.calculate_bucket(_target())

    assert "unable to list object versions" in str(exc.value).lower()
    assert "AccessDenied" in str(exc.value)


def test_usage_stats_upsert_replaces_latest_snapshot_without_history(db_session):
    service = BucketUsageStatsService()
    first = FakeUsageStatsService(
        FakeS3Client({"list_object_versions": FakePaginator([{"Versions": [{"Key": "a.txt", "IsLatest": True, "Size": 1}]}])})
    ).calculate_bucket(_target())
    second = first.model_copy(update={"total_bytes": 42, "current_bytes": 42})

    service.upsert_snapshot(db_session, first)
    persisted = service.upsert_snapshot(db_session, second)

    assert db_session.query(BucketUsageStatsSnapshotRow).count() == 1
    assert persisted.total_bytes == 42
    assert service.get_latest(db_session, scope_kind="manager", scope_id="ctx-1", bucket_name="bucket-a").total_bytes == 42


def test_usage_stats_aggregate_recalculates_ratios_and_reports_coverage(db_session):
    service = BucketUsageStatsService()
    first = FakeUsageStatsService(
        FakeS3Client(
            {
                "list_object_versions": FakePaginator(
                    [
                        {
                            "Versions": [
                                {"Key": "docs/a.pdf", "IsLatest": True, "Size": 80},
                                {"Key": "docs/a.pdf", "IsLatest": False, "Size": 20},
                            ],
                        }
                    ]
                )
            }
        )
    ).calculate_bucket(_target("bucket-a"))
    second = FakeUsageStatsService(
        FakeS3Client(
            {
                "list_object_versions": FakePaginator(
                    [
                        {
                            "Versions": [
                                {"Key": "images/b.png", "IsLatest": True, "Size": 100},
                            ],
                        }
                    ]
                )
            }
        )
    ).calculate_bucket(_target("bucket-b"))

    service.upsert_snapshot(db_session, first)
    service.upsert_snapshot(db_session, second)

    aggregate = service.get_aggregate(
        db_session,
        scope_kind="manager",
        scope_id="ctx-1",
        scope_name="Context 1",
        bucket_names=["bucket-a", "bucket-b", "bucket-c"],
    )

    assert aggregate.bucket_count == 3
    assert aggregate.buckets_with_snapshot == 2
    assert aggregate.missing_bucket_count == 1
    assert aggregate.total_bytes == 200
    assert aggregate.current_bytes == 180
    assert aggregate.noncurrent_bytes == 20
    assert aggregate.current_vs_noncurrent[0].key == "current"
    assert aggregate.current_vs_noncurrent[0].ratio_bytes == pytest.approx(0.9)


def test_usage_stats_aggregate_for_targets_merges_manager_scopes(db_session):
    service = BucketUsageStatsService()
    first = FakeUsageStatsService(
        FakeS3Client(
            {
                "list_object_versions": FakePaginator(
                    [{"Versions": [{"Key": "docs/a.pdf", "IsLatest": True, "Size": 90}]}]
                )
            }
        )
    ).calculate_bucket(_target("bucket-a"))
    second = FakeUsageStatsService(
        FakeS3Client(
            {
                "list_object_versions": FakePaginator(
                    [{"Versions": [{"Key": "images/b.png", "IsLatest": True, "Size": 30}]}]
                )
            }
        )
    ).calculate_bucket(_target("bucket-b"))

    service.upsert_snapshot(db_session, first.model_copy(update={"scope_id": "1", "scope_name": "Account 1"}))
    service.upsert_snapshot(db_session, second.model_copy(update={"scope_id": "2", "scope_name": "Account 2"}))

    aggregate = service.get_aggregate_for_targets(
        db_session,
        scope_kind="admin_managed",
        scope_id="7",
        scope_name="Ceph main",
        targets=[
            BucketUsageStatsAggregateTarget(scope_kind="manager", scope_id="1", bucket_name="bucket-a"),
            BucketUsageStatsAggregateTarget(scope_kind="manager", scope_id="2", bucket_name="bucket-b"),
            BucketUsageStatsAggregateTarget(scope_kind="manager", scope_id="2", bucket_name="missing-bucket"),
        ],
        warnings=["1 managed account(s) could not be scanned for bucket usage stats."],
        managed_account_count=3,
        accounts_with_listed_buckets=2,
        skipped_account_count=1,
    )

    assert aggregate.scope_kind == "admin_managed"
    assert aggregate.scope_id == "7"
    assert aggregate.bucket_count == 3
    assert aggregate.buckets_with_snapshot == 2
    assert aggregate.missing_bucket_count == 1
    assert aggregate.managed_account_count == 3
    assert aggregate.accounts_with_listed_buckets == 2
    assert aggregate.skipped_account_count == 1
    assert aggregate.total_bytes == 120
    assert next(entry for entry in aggregate.data_type_distribution if entry.key == "documents").ratio_bytes == pytest.approx(0.75)
    assert "1 managed account(s) could not be scanned for bucket usage stats." in aggregate.warnings


def test_usage_stats_aggregate_includes_current_only_snapshots_with_partial_warning(db_session):
    service = BucketUsageStatsService()
    snapshot = FakeUsageStatsService(
        FakeS3Client(
            {
                "list_object_versions": FakePaginator(error=_client_error("NotImplemented", "not implemented")),
                "list_objects_v2": FakePaginator([{"Contents": [{"Key": "archive.zip", "Size": 10}]}]),
            }
        )
    ).calculate_bucket(_target("bucket-a"))

    service.upsert_snapshot(db_session, snapshot)

    aggregate = service.get_aggregate(
        db_session,
        scope_kind="manager",
        scope_id="ctx-1",
        bucket_names=["bucket-a"],
    )

    assert aggregate.bucket_count == 1
    assert aggregate.buckets_with_snapshot == 1
    assert aggregate.partial_scan_count == 1
    assert aggregate.total_bytes == 10
    assert aggregate.current_vs_noncurrent[0].bytes == 10
    assert any("current-object listings only" in warning for warning in aggregate.warnings)
