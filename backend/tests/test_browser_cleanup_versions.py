# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from datetime import datetime, timedelta, timezone

from app.db import S3Account
from app.models.browser import CleanupObjectVersionsPayload
from app.services import browser_service


def _account() -> S3Account:
    return S3Account(name="cleanup-test")


def test_cleanup_keep_last_never_deletes_current_version(monkeypatch):
    captured_deletions: list[dict] = []

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
    monkeypatch.setattr(service, "_client", lambda _account: FakeClient())
    monkeypatch.setattr(browser_service, "_delete_objects", fake_delete_objects)

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
    monkeypatch.setattr(service, "_client", lambda _account: FakeClient())
    monkeypatch.setattr(browser_service, "_delete_objects", fake_delete_objects)

    result = service.cleanup_object_versions(
        "bucket-a",
        _account(),
        CleanupObjectVersionsPayload(prefix="docs/", older_than_days=30),
    )

    assert result.deleted_versions == 1
    assert {"Key": "docs/archive.zip", "VersionId": "latest-old"} not in captured_deletions
    assert captured_deletions == [{"Key": "docs/archive.zip", "VersionId": "old"}]
