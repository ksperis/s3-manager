# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from datetime import datetime, timedelta, timezone

from app.db import S3Account
from app.models.browser import CleanupObjectVersionsPayload
from app.services import browser_service
from app.services.browser import versions as browser_versions


def _account() -> S3Account:
    return S3Account(name="cleanup-test")


def test_cleanup_keep_last_never_deletes_current_version(monkeypatch):
    captured_deletions: list[dict] = []
    profiles: list[str] = []

    class FakeClient:
        def list_object_versions(self, **_kwargs):  # noqa: ANN001
            return {
                "Versions": [
                    {
                        "Key": "docs/report.txt",
                        "VersionId": "v3",
                        "LastModified": datetime(2026, 1, 3, tzinfo=timezone.utc),
                        "IsLatest": True,
                    },
                    {
                        "Key": "docs/report.txt",
                        "VersionId": "v2",
                        "LastModified": datetime(2026, 1, 2, tzinfo=timezone.utc),
                        "IsLatest": False,
                    },
                    {
                        "Key": "docs/report.txt",
                        "VersionId": "v1",
                        "LastModified": datetime(2026, 1, 1, tzinfo=timezone.utc),
                        "IsLatest": False,
                    },
                ],
                "DeleteMarkers": [],
                "NextKeyMarker": None,
                "NextVersionIdMarker": None,
            }

    def fake_delete_objects(_client, _bucket, items):  # noqa: ANN001
        captured_deletions.extend(items)

    service = browser_service.BrowserService()
    monkeypatch.setattr(
        service,
        "_client",
        lambda _account, request_profile="interactive": profiles.append(request_profile) or FakeClient(),
    )
    monkeypatch.setattr(browser_versions, "_delete_objects", fake_delete_objects)

    result = service.cleanup_object_versions(
        "bucket-a",
        _account(),
        CleanupObjectVersionsPayload(prefix="docs/", keep_last_n=1),
    )

    assert result.deleted_versions == 2
    assert {"Key": "docs/report.txt", "VersionId": "v3"} not in captured_deletions
    assert captured_deletions == [
        {"Key": "docs/report.txt", "VersionId": "v2"},
        {"Key": "docs/report.txt", "VersionId": "v1"},
    ]
    assert profiles == ["long_running"]


def test_cleanup_older_than_never_deletes_current_version(monkeypatch):
    captured_deletions: list[dict] = []
    now = datetime.now(tz=timezone.utc)

    class FakeClient:
        def list_object_versions(self, **_kwargs):  # noqa: ANN001
            return {
                "Versions": [
                    {
                        "Key": "docs/archive.zip",
                        "VersionId": "latest-old",
                        "LastModified": now - timedelta(days=120),
                        "IsLatest": True,
                    },
                    {
                        "Key": "docs/archive.zip",
                        "VersionId": "old",
                        "LastModified": now - timedelta(days=200),
                        "IsLatest": False,
                    },
                    {
                        "Key": "docs/archive.zip",
                        "VersionId": "recent",
                        "LastModified": now - timedelta(days=5),
                        "IsLatest": False,
                    },
                ],
                "DeleteMarkers": [],
                "NextKeyMarker": None,
                "NextVersionIdMarker": None,
            }

    def fake_delete_objects(_client, _bucket, items):  # noqa: ANN001
        captured_deletions.extend(items)

    service = browser_service.BrowserService()
    monkeypatch.setattr(service, "_client", lambda _account, request_profile="interactive": FakeClient())
    monkeypatch.setattr(browser_versions, "_delete_objects", fake_delete_objects)

    result = service.cleanup_object_versions(
        "bucket-a",
        _account(),
        CleanupObjectVersionsPayload(prefix="docs/", older_than_days=30),
    )

    assert result.deleted_versions == 1
    assert {"Key": "docs/archive.zip", "VersionId": "latest-old"} not in captured_deletions
    assert captured_deletions == [{"Key": "docs/archive.zip", "VersionId": "old"}]


def test_cleanup_batches_large_version_deletions_and_orphan_markers(monkeypatch):
    now = datetime.now(tz=timezone.utc)
    old = now - timedelta(days=90)
    version_rows = [
        {
            "Key": f"docs/file-{index:04d}.txt",
            "VersionId": f"old-{index:04d}",
            "LastModified": old,
            "IsLatest": False,
        }
        for index in range(1002)
    ]
    version_rows.append(
        {
            "Key": "docs/marker-only.txt",
            "VersionId": "old-marker-source",
            "LastModified": old,
            "IsLatest": False,
        }
    )
    pages = [
        {
            "Versions": version_rows[:800],
            "DeleteMarkers": [],
            "NextKeyMarker": "page-2",
            "NextVersionIdMarker": "version-page-2",
        },
        {
            "Versions": version_rows[800:],
            "DeleteMarkers": [{"Key": "docs/marker-only.txt", "VersionId": "delete-marker"}],
            "NextKeyMarker": None,
            "NextVersionIdMarker": None,
        },
    ]
    list_calls: list[dict] = []
    delete_batches: list[list[dict]] = []

    class FakeClient:
        def list_object_versions(self, **kwargs):  # noqa: ANN001
            list_calls.append(kwargs)
            return pages[len(list_calls) - 1]

    def fake_delete_objects(_client, _bucket, items):  # noqa: ANN001
        delete_batches.append(list(items))

    service = browser_service.BrowserService()
    monkeypatch.setattr(service, "_client", lambda _account, request_profile="interactive": FakeClient())
    monkeypatch.setattr(browser_versions, "_delete_objects", fake_delete_objects)

    result = service.cleanup_object_versions(
        "bucket-a",
        _account(),
        CleanupObjectVersionsPayload(prefix="docs/", older_than_days=30, delete_orphan_markers=True),
    )

    assert result.scanned_versions == 1003
    assert result.scanned_delete_markers == 1
    assert result.deleted_versions == 1003
    assert result.deleted_delete_markers == 1
    assert [len(batch) for batch in delete_batches] == [1000, 3, 1]
    assert delete_batches[-1] == [{"Key": "docs/marker-only.txt", "VersionId": "delete-marker"}]
    assert len(list_calls) == 2
    assert list_calls[1]["KeyMarker"] == "page-2"
    assert list_calls[1]["VersionIdMarker"] == "version-page-2"
