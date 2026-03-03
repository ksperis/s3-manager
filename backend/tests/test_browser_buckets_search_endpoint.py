# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from app.db import S3Account
from app.main import app
from app.models.browser import BrowserBucket, PaginatedBrowserBucketsResponse
from app.routers import browser as browser_router
from app.routers import dependencies


def _account() -> S3Account:
    account = S3Account(name="browser-search-endpoint-test")
    account.id = 77
    return account


def test_browser_bucket_search_endpoint_contract(client):
    captured: dict[str, object] = {}

    class FakeService:
        def search_buckets(self, account, *, search=None, exact=False, page=1, page_size=50):  # noqa: ANN001
            captured["account_id"] = account.id
            captured["search"] = search
            captured["exact"] = exact
            captured["page"] = page
            captured["page_size"] = page_size
            return PaginatedBrowserBucketsResponse(
                items=[BrowserBucket(name="alpha"), BrowserBucket(name="alpine")],
                total=5,
                page=2,
                page_size=2,
                has_next=True,
            )

    app.dependency_overrides[dependencies.get_account_context] = _account
    app.dependency_overrides[browser_router.get_browser_service] = lambda: FakeService()

    response = client.get(
        "/api/browser/buckets/search",
        params={"search": "al", "exact": "true", "page": 2, "page_size": 2, "account_id": "conn-9"},
    )

    assert response.status_code == 200
    assert response.json() == {
        "items": [
            {"name": "alpha", "creation_date": None},
            {"name": "alpine", "creation_date": None},
        ],
        "total": 5,
        "page": 2,
        "page_size": 2,
        "has_next": True,
    }
    assert captured == {
        "account_id": 77,
        "search": "al",
        "exact": True,
        "page": 2,
        "page_size": 2,
    }


def test_browser_bucket_search_endpoint_paginates_results(client):
    class FakeService:
        buckets = [
            BrowserBucket(name="alpha"),
            BrowserBucket(name="alpine"),
            BrowserBucket(name="archive"),
            BrowserBucket(name="beta"),
        ]

        def search_buckets(self, account, *, search=None, exact=False, page=1, page_size=50):  # noqa: ANN001
            query = (search or "").strip().lower()
            if exact and query:
                filtered = [bucket for bucket in self.buckets if bucket.name.lower() == query]
            elif query:
                filtered = [bucket for bucket in self.buckets if query in bucket.name.lower()]
            else:
                filtered = list(self.buckets)
            start = (page - 1) * page_size
            end = start + page_size
            items = filtered[start:end]
            return PaginatedBrowserBucketsResponse(
                items=items,
                total=len(filtered),
                page=page,
                page_size=page_size,
                has_next=end < len(filtered),
            )

    app.dependency_overrides[dependencies.get_account_context] = _account
    app.dependency_overrides[browser_router.get_browser_service] = lambda: FakeService()

    response = client.get("/api/browser/buckets/search", params={"search": "a", "page": 2, "page_size": 2})
    assert response.status_code == 200
    payload = response.json()
    assert payload["total"] == 4
    assert payload["page"] == 2
    assert payload["page_size"] == 2
    assert payload["has_next"] is False
    assert [item["name"] for item in payload["items"]] == ["archive", "beta"]


def test_browser_bucket_search_endpoint_maps_service_error(client):
    class FakeService:
        def search_buckets(self, account, *, search=None, exact=False, page=1, page_size=50):  # noqa: ANN001
            raise RuntimeError("bucket search failed")

    app.dependency_overrides[dependencies.get_account_context] = _account
    app.dependency_overrides[browser_router.get_browser_service] = lambda: FakeService()

    response = client.get("/api/browser/buckets/search")
    assert response.status_code == 502
    assert "bucket search failed" in response.json()["detail"]
