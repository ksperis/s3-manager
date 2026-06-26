# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from datetime import datetime, timezone

from app.db import S3Account
from app.main import app
from app.models.bucket_usage_stats import BucketUsageStatsDistributionEntry, BucketUsageStatsSnapshot
from app.models.browser import BrowserBucket, PaginatedBrowserBucketsResponse
from app.routers import browser as browser_router
from app.routers import dependencies
from app.services.bucket_usage_stats_service import BucketUsageStatsService


def _account() -> S3Account:
    account = S3Account(name="browser-search-endpoint-test")
    account.id = 77
    return account


def _usage_snapshot(bucket_name: str, *, scope_id: str = "77", bytes_value: int = 10) -> BucketUsageStatsSnapshot:
    return BucketUsageStatsSnapshot(
        scope_kind="manager",
        scope_id=scope_id,
        scope_name="Browser Search Test",
        bucket_name=bucket_name,
        scan_mode="versions",
        version_listing_available=True,
        object_version_count=1,
        current_version_count=1,
        noncurrent_version_count=0,
        delete_marker_count=0,
        total_bytes=bytes_value,
        current_bytes=bytes_value,
        noncurrent_bytes=0,
        data_type_distribution=[
            BucketUsageStatsDistributionEntry(
                key="documents",
                label="Documents",
                count=1,
                bytes=bytes_value,
                ratio_count=1,
                ratio_bytes=1,
            )
        ],
        storage_class_distribution=[
            BucketUsageStatsDistributionEntry(
                key="STANDARD",
                label="STANDARD",
                count=1,
                bytes=bytes_value,
                ratio_count=1,
                ratio_bytes=1,
            )
        ],
        size_distribution=[],
        age_distribution=[],
        current_vs_noncurrent=[
            BucketUsageStatsDistributionEntry(
                key="current",
                label="Current versions",
                count=1,
                bytes=bytes_value,
                ratio_count=1,
                ratio_bytes=1,
            ),
            BucketUsageStatsDistributionEntry(
                key="noncurrent",
                label="Non-current versions",
                count=0,
                bytes=0,
                ratio_count=0,
                ratio_bytes=0,
            ),
        ],
        warnings=[],
        calculated_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
    )


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
            {"name": "alpha"},
            {"name": "alpine"},
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


def test_browser_bucket_search_endpoint_returns_enriched_display_fields(client):
    class FakeService:
        def search_buckets(self, account, *, search=None, exact=False, page=1, page_size=50):  # noqa: ANN001
            return PaginatedBrowserBucketsResponse(
                items=[
                    BrowserBucket(
                        name="internal-alpha",
                        display_name="Alpha Space",
                        workspace_label="Storage Space",
                        used_bytes=4096,
                        object_count=8,
                        quota_max_size_bytes=8192,
                        status="active",
                        role="Owner",
                        internal_bucket_name="internal-alpha",
                    )
                ],
                total=1,
                page=1,
                page_size=50,
                has_next=False,
            )

    app.dependency_overrides[dependencies.get_account_context] = _account
    app.dependency_overrides[browser_router.get_browser_service] = lambda: FakeService()

    response = client.get("/api/browser/buckets/search", params={"search": "alpha"})
    assert response.status_code == 200
    assert response.json()["items"] == [
        {
            "name": "internal-alpha",
            "display_name": "Alpha Space",
            "workspace_label": "Storage Space",
            "used_bytes": 4096,
            "object_count": 8,
            "quota_max_size_bytes": 8192,
            "status": "active",
            "role": "Owner",
            "internal_bucket_name": "internal-alpha",
        }
    ]


def test_browser_bucket_search_endpoint_maps_service_error(client):
    class FakeService:
        def search_buckets(self, account, *, search=None, exact=False, page=1, page_size=50):  # noqa: ANN001
            raise RuntimeError("bucket search failed")

    app.dependency_overrides[dependencies.get_account_context] = _account
    app.dependency_overrides[browser_router.get_browser_service] = lambda: FakeService()

    response = client.get("/api/browser/buckets/search")
    assert response.status_code == 502
    assert "bucket search failed" in response.json()["detail"]


def test_browser_usage_summary_aggregates_complete_account_snapshots(client, db_session):
    BucketUsageStatsService().upsert_snapshot(db_session, _usage_snapshot("alpha", bytes_value=20))
    BucketUsageStatsService().upsert_snapshot(db_session, _usage_snapshot("beta", bytes_value=30))

    class FakeService:
        def list_buckets(self, account):  # noqa: ANN001
            return [BrowserBucket(name="alpha"), BrowserBucket(name="beta")]

    app.dependency_overrides[dependencies.get_account_context] = _account
    app.dependency_overrides[browser_router.get_browser_service] = lambda: FakeService()

    response = client.get("/api/browser/usage-summary")

    assert response.status_code == 200
    assert response.json() == {
        "available": True,
        "source": "account",
        "label": "Account",
        "used_bytes": 50,
        "object_count": 2,
    }


def test_browser_usage_summary_hides_partial_account_snapshots(client, db_session):
    BucketUsageStatsService().upsert_snapshot(db_session, _usage_snapshot("alpha", bytes_value=20))

    class FakeService:
        def list_buckets(self, account):  # noqa: ANN001
            return [BrowserBucket(name="alpha"), BrowserBucket(name="beta")]

    app.dependency_overrides[dependencies.get_account_context] = _account
    app.dependency_overrides[browser_router.get_browser_service] = lambda: FakeService()

    response = client.get("/api/browser/usage-summary")

    assert response.status_code == 200
    assert response.json() == {
        "available": False,
        "source": "account",
        "label": "Account",
    }


def test_browser_usage_summary_hides_connection_usage_without_bucket_listing(client):
    account = S3Account(name="browser-connection")
    account.id = 77
    account.s3_connection_id = 9

    class FakeService:
        def list_buckets(self, account):  # noqa: ANN001
            raise AssertionError("connection usage summary should not list buckets")

    app.dependency_overrides[dependencies.get_account_context] = lambda: account
    app.dependency_overrides[browser_router.get_browser_service] = lambda: FakeService()

    response = client.get("/api/browser/usage-summary")

    assert response.status_code == 200
    assert response.json() == {
        "available": False,
        "source": "connection",
        "label": "Connection",
    }
