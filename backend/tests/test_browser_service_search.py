# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import pytest

from app.db import S3Account
from app.services import browser_service
from app.services.browser_service import BrowserService


def _account() -> S3Account:
    account = S3Account(name="search-test")
    account.id = 11
    account.rgw_access_key = "access-key"
    account.rgw_secret_key = "secret-key"
    account.storage_endpoint_url = "https://s3.example.test"
    return account


@pytest.fixture(autouse=True)
def _clear_browser_caches():
    browser_service._OBJECT_LIST_CACHE.invalidate_where(lambda _key: True)
    browser_service._BUCKET_LIST_CACHE.invalidate_where(lambda _key: True)


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


def test_list_objects_filtered_pagination_keeps_token_chain_without_duplicates(monkeypatch):
    calls: list[dict] = []

    class FakeClient:
        def list_objects_v2(self, **kwargs):  # noqa: ANN001
            calls.append(kwargs)
            token = kwargs.get("ContinuationToken")
            if token == "t1":
                return {
                    "Contents": [
                        {"Key": "docs/notes.txt", "Size": 10},
                        {"Key": "docs/report-2.csv", "Size": 30},
                    ],
                    "IsTruncated": True,
                    "NextContinuationToken": "t2",
                }
            if token == "t2":
                return {
                    "Contents": [
                        {"Key": "docs/report-3.csv", "Size": 40},
                        {"Key": "docs/tmp.txt", "Size": 1},
                    ],
                    "IsTruncated": False,
                    "NextContinuationToken": None,
                }
            return {
                "Contents": [
                    {"Key": "docs/a.txt", "Size": 10},
                    {"Key": "docs/report-1.csv", "Size": 20},
                ],
                "IsTruncated": True,
                "NextContinuationToken": "t1",
            }

    service = BrowserService()
    monkeypatch.setattr(service, "_client", lambda _account: FakeClient())

    first_page = service.list_objects(
        "bucket-a",
        _account(),
        prefix="docs/",
        query="report",
        item_type="file",
        max_keys=2,
    )
    second_page = service.list_objects(
        "bucket-a",
        _account(),
        prefix="docs/",
        continuation_token=first_page.next_continuation_token,
        query="report",
        item_type="file",
        max_keys=2,
    )

    assert [obj.key for obj in first_page.objects] == ["docs/report-1.csv", "docs/report-2.csv"]
    assert first_page.next_continuation_token == "t2"
    assert first_page.is_truncated is True
    assert [obj.key for obj in second_page.objects] == ["docs/report-3.csv"]
    assert second_page.next_continuation_token is None
    assert second_page.is_truncated is False
    all_keys = [obj.key for obj in [*first_page.objects, *second_page.objects]]
    assert all_keys == ["docs/report-1.csv", "docs/report-2.csv", "docs/report-3.csv"]
    assert calls[0]["MaxKeys"] == 2
    assert calls[1]["MaxKeys"] == 1


def test_list_objects_filtered_respects_exact_case_type_and_recursive(monkeypatch):
    class FakeClient:
        def list_objects_v2(self, **_kwargs):  # noqa: ANN001
            return {
                "Contents": [
                    {"Key": "docs/Readme.txt", "Size": 10, "StorageClass": "STANDARD"},
                    {"Key": "docs/readme.txt", "Size": 11, "StorageClass": "STANDARD"},
                    {"Key": "docs/archives/README.txt", "Size": 12, "StorageClass": "STANDARD_IA"},
                    {"Key": "docs/archives/", "Size": 0, "StorageClass": "STANDARD"},
                ],
                "IsTruncated": False,
                "NextContinuationToken": None,
            }

    service = BrowserService()
    monkeypatch.setattr(service, "_client", lambda _account: FakeClient())

    files = service.list_objects(
        "bucket-a",
        _account(),
        prefix="docs/",
        recursive=True,
        item_type="file",
        query="Readme.txt",
        query_exact=True,
        query_case_sensitive=True,
    )
    folders = service.list_objects(
        "bucket-a",
        _account(),
        prefix="docs/",
        recursive=True,
        item_type="folder",
        query="archives",
        query_exact=False,
    )

    assert [obj.key for obj in files.objects] == ["docs/Readme.txt"]
    assert files.prefixes == []
    assert folders.objects == []
    assert folders.prefixes == ["docs/archives/"]
