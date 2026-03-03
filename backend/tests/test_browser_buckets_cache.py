# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from app.db import S3Account
from app.services import browser_service


def _account() -> S3Account:
    account = S3Account(name="browser-cache-test")
    account.id = 101
    account.rgw_access_key = "access-key"
    account.rgw_secret_key = "secret-key"
    account.storage_endpoint_url = "https://s3.example.test"
    return account


def _reset_browser_caches() -> None:
    browser_service._BUCKET_LIST_CACHE.invalidate_where(lambda _key: True)
    browser_service._OBJECT_LIST_CACHE.invalidate_where(lambda _key: True)


def test_bucket_cache_reused_between_pages(monkeypatch):
    _reset_browser_caches()
    calls: list[dict] = []

    class FakeClient:
        def list_buckets(self):  # noqa: ANN001
            calls.append({"op": "list_buckets"})
            return {
                "Buckets": [
                    {"Name": "alpha"},
                    {"Name": "beta"},
                    {"Name": "gamma"},
                    {"Name": "zeta"},
                ]
            }

    service = browser_service.BrowserService()
    monkeypatch.setattr(service, "_client", lambda _account: FakeClient())

    page_one = service.search_buckets(_account(), page=1, page_size=2)
    page_two = service.search_buckets(_account(), page=2, page_size=2)

    assert [bucket.name for bucket in page_one.items] == ["alpha", "beta"]
    assert [bucket.name for bucket in page_two.items] == ["gamma", "zeta"]
    assert page_one.total == 4
    assert page_two.total == 4
    assert len(calls) == 1


def test_bucket_cache_reused_across_search_terms(monkeypatch):
    _reset_browser_caches()
    calls: list[dict] = []

    class FakeClient:
        def list_buckets(self):  # noqa: ANN001
            calls.append({"op": "list_buckets"})
            return {
                "Buckets": [
                    {"Name": "project-a"},
                    {"Name": "project-b"},
                    {"Name": "archive"},
                ]
            }

    service = browser_service.BrowserService()
    monkeypatch.setattr(service, "_client", lambda _account: FakeClient())

    first = service.search_buckets(_account(), search="project", page=1, page_size=10)
    second = service.search_buckets(_account(), search="archive", page=1, page_size=10)

    assert [bucket.name for bucket in first.items] == ["project-a", "project-b"]
    assert [bucket.name for bucket in second.items] == ["archive"]
    assert len(calls) == 1


def test_bucket_cache_invalidated_after_bucket_mutation(monkeypatch):
    _reset_browser_caches()
    calls: list[dict] = []

    class FakeClient:
        def list_buckets(self):  # noqa: ANN001
            calls.append({"op": "list_buckets"})
            return {"Buckets": [{"Name": "alpha"}]}

    service = browser_service.BrowserService()
    monkeypatch.setattr(service, "_client", lambda _account: FakeClient())
    monkeypatch.setattr(service, "_resolve_s3_credentials", lambda _account: ("ak", "sk", None))
    monkeypatch.setattr(browser_service, "s3_create_bucket", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(browser_service, "s3_set_bucket_versioning", lambda *_args, **_kwargs: None)

    service.search_buckets(_account(), page=1, page_size=10)
    service.create_bucket("new-bucket", _account(), versioning=False)
    service.search_buckets(_account(), page=1, page_size=10)

    assert len(calls) == 2
