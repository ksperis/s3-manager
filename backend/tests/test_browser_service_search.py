# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from app.db import S3Account
from app.services.browser_service import BrowserService


def _account() -> S3Account:
    return S3Account(name="search-test")


def test_list_objects_recursive_folder_filter_builds_prefixes(monkeypatch):
    captured: dict[str, object] = {}

    class FakeClient:
        def list_objects_v2(self, **kwargs):  # noqa: ANN001
            captured["kwargs"] = kwargs
            return {
                "Contents": [
                    {"Key": "docs/readme.txt", "Size": 10},
                    {"Key": "docs/archive/2025/report.csv", "Size": 20},
                    {"Key": "images/logo.png", "Size": 5},
                ],
                "IsTruncated": False,
                "NextContinuationToken": None,
            }

    service = BrowserService()
    monkeypatch.setattr(service, "_client", lambda _account: FakeClient())

    result = service.list_objects("bucket-a", _account(), recursive=True, item_type="folder")

    assert result.objects == []
    assert result.prefixes == ["docs/", "docs/archive/", "docs/archive/2025/", "images/"]
    assert result.is_truncated is False
    assert "Delimiter" not in captured["kwargs"]


def test_list_objects_recursive_skips_folder_markers_in_object_results(monkeypatch):
    class FakeClient:
        def list_objects_v2(self, **_kwargs):  # noqa: ANN001
            return {
                "Contents": [
                    {"Key": "docs/", "Size": 0},
                    {"Key": "docs/readme.txt", "Size": 12, "StorageClass": "STANDARD"},
                    {"Key": "docs/manual.pdf", "Size": 24, "StorageClass": "STANDARD_IA"},
                ],
                "IsTruncated": False,
                "NextContinuationToken": None,
            }

    service = BrowserService()
    monkeypatch.setattr(service, "_client", lambda _account: FakeClient())

    result = service.list_objects("bucket-a", _account(), recursive=True, item_type="all")

    assert [obj.key for obj in result.objects] == ["docs/readme.txt", "docs/manual.pdf"]
    assert result.prefixes == ["docs/"]


def test_list_objects_recursive_folder_query_filters_prefixes(monkeypatch):
    class FakeClient:
        def list_objects_v2(self, **_kwargs):  # noqa: ANN001
            return {
                "Contents": [
                    {"Key": "docs/readme.txt", "Size": 10},
                    {"Key": "docs/archive/2025/report.csv", "Size": 20},
                    {"Key": "docs/archive/2024/report.csv", "Size": 20},
                ],
                "IsTruncated": False,
                "NextContinuationToken": None,
            }

    service = BrowserService()
    monkeypatch.setattr(service, "_client", lambda _account: FakeClient())

    result = service.list_objects(
        "bucket-a",
        _account(),
        recursive=True,
        item_type="folder",
        query="archive/2025",
    )

    assert result.prefixes == ["docs/archive/2025/"]


def test_list_objects_exact_query_is_case_insensitive_by_default(monkeypatch):
    class FakeClient:
        def list_objects_v2(self, **_kwargs):  # noqa: ANN001
            return {
                "Contents": [
                    {"Key": "docs/Readme.txt", "Size": 10},
                    {"Key": "docs/readme.md", "Size": 10},
                ],
                "IsTruncated": False,
                "NextContinuationToken": None,
            }

    service = BrowserService()
    monkeypatch.setattr(service, "_client", lambda _account: FakeClient())

    result = service.list_objects(
        "bucket-a",
        _account(),
        prefix="docs/",
        query="readme.txt",
        query_exact=True,
    )

    assert [obj.key for obj in result.objects] == ["docs/Readme.txt"]


def test_list_objects_case_sensitive_query_filters_by_case(monkeypatch):
    class FakeClient:
        def list_objects_v2(self, **_kwargs):  # noqa: ANN001
            return {
                "Contents": [
                    {"Key": "docs/Readme.txt", "Size": 10},
                    {"Key": "docs/readme.txt", "Size": 10},
                ],
                "IsTruncated": False,
                "NextContinuationToken": None,
            }

    service = BrowserService()
    monkeypatch.setattr(service, "_client", lambda _account: FakeClient())

    result = service.list_objects(
        "bucket-a",
        _account(),
        prefix="docs/",
        query="Readme",
        query_case_sensitive=True,
    )

    assert [obj.key for obj in result.objects] == ["docs/Readme.txt"]
