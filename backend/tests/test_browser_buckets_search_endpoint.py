# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from app.db import S3Account, S3User, StorageEndpoint, StorageProvider
from app.main import app
from app.models.browser import BrowserBucket, PaginatedBrowserBucketsResponse
from app.routers import browser as browser_router
from app.routers import dependencies
from app.services.s3_execution_context import S3ExecutionContext


def _account() -> S3Account:
    account = S3Account(name="browser-search-endpoint-test")
    account.id = 77
    return account


def _s3_user_endpoint(db_session, *, name: str) -> StorageEndpoint:
    endpoint = StorageEndpoint(
        name=name,
        endpoint_url=f"https://{name}.example.test",
        provider=StorageProvider.CEPH.value,
        is_default=True,
    )
    db_session.add(endpoint)
    db_session.flush()
    return endpoint


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
                        description="Research datasets",
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
            "description": "Research datasets",
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


def test_browser_usage_summary_uses_live_account_usage(client, db_session, monkeypatch):
    account = _account()

    class FakeS3AccountsService:
        def __init__(self, db):  # noqa: ANN001
            assert db is db_session

        def get_account_usage(self, received):  # noqa: ANN001
            assert received is account
            return 50, 2, 2

        def get_account_quota(self, received):  # noqa: ANN001
            assert received is account
            return 2.0, 200

    monkeypatch.setattr(browser_router, "S3AccountsService", FakeS3AccountsService)
    app.dependency_overrides[dependencies.get_account_context] = lambda: account

    response = client.get("/api/browser/usage-summary")

    assert response.status_code == 200
    assert response.json() == {
        "available": True,
        "source": "account",
        "label": "Account",
        "used_bytes": 50,
        "object_count": 2,
        "quota_max_size_bytes": 2 * 1024**3,
        "quota_max_objects": 200,
    }


def test_browser_usage_summary_hides_account_when_live_usage_is_unavailable(client, db_session, monkeypatch):
    account = _account()

    class FakeS3AccountsService:
        def __init__(self, db):  # noqa: ANN001
            assert db is db_session

        def get_account_usage(self, received):  # noqa: ANN001
            assert received is account
            return None, None, None

        def get_account_quota(self, received):  # noqa: ANN001
            raise AssertionError("quota should not be fetched when live usage is unavailable")

    monkeypatch.setattr(browser_router, "S3AccountsService", FakeS3AccountsService)
    app.dependency_overrides[dependencies.get_account_context] = lambda: account

    response = client.get("/api/browser/usage-summary")

    assert response.status_code == 200
    assert response.json() == {
        "available": False,
        "source": "account",
        "label": "Account",
    }


def test_browser_usage_summary_uses_live_s3_user_usage(client, db_session, monkeypatch):
    endpoint = _s3_user_endpoint(db_session, name="browser-summary-ceph")
    s3_user = S3User(
        name="browser-s3-user-summary",
        rgw_user_uid="browser-summary-user",
        rgw_access_key="access",
        rgw_secret_key="secret",
        storage_endpoint_id=endpoint.id,
    )
    db_session.add(s3_user)
    db_session.flush()
    account = S3ExecutionContext.from_legacy_user(s3_user)

    class FakeS3UsersService:
        def __init__(self, db):  # noqa: ANN001
            assert db is db_session

        def get_user_usage(self, received):  # noqa: ANN001
            assert received.id == s3_user.id
            return 40, 4, 1

        def get_user_quota(self, received):  # noqa: ANN001
            assert received.id == s3_user.id
            return 1.0, 100

    monkeypatch.setattr(browser_router, "S3UsersService", FakeS3UsersService)
    app.dependency_overrides[dependencies.get_account_context] = lambda: account

    response = client.get("/api/browser/usage-summary")

    assert response.status_code == 200
    assert response.json() == {
        "available": True,
        "source": "s3_user",
        "label": "S3 User",
        "used_bytes": 40,
        "object_count": 4,
        "quota_max_size_bytes": 1024**3,
        "quota_max_objects": 100,
    }


def test_browser_usage_summary_hides_s3_user_when_live_usage_is_unavailable(client, db_session, monkeypatch):
    endpoint = _s3_user_endpoint(db_session, name="browser-summary-empty-ceph")
    s3_user = S3User(
        name="browser-s3-user-summary-empty",
        rgw_user_uid="browser-summary-user-empty",
        rgw_access_key="access",
        rgw_secret_key="secret",
        storage_endpoint_id=endpoint.id,
    )
    db_session.add(s3_user)
    db_session.flush()
    account = S3ExecutionContext.from_legacy_user(s3_user)

    class FakeS3UsersService:
        def __init__(self, db):  # noqa: ANN001
            assert db is db_session

        def get_user_usage(self, received):  # noqa: ANN001
            assert received.id == s3_user.id
            return None, None, None

        def get_user_quota(self, received):  # noqa: ANN001
            raise AssertionError("quota should not be fetched when live usage is unavailable")

    monkeypatch.setattr(browser_router, "S3UsersService", FakeS3UsersService)
    app.dependency_overrides[dependencies.get_account_context] = lambda: account

    response = client.get("/api/browser/usage-summary")

    assert response.status_code == 200
    assert response.json() == {
        "available": False,
        "source": "s3_user",
        "label": "S3 User",
    }


def test_browser_usage_summary_uses_live_account_usage_for_portal_context(client, db_session, monkeypatch):
    persisted_account = S3Account(name="portal-browser-summary")
    persisted_account.id = 77
    account = S3ExecutionContext.from_account(persisted_account, context_kind="portal_account")
    account.portal_browser_role = "portal_manager"

    class FakeS3AccountsService:
        def __init__(self, db):  # noqa: ANN001
            assert db is db_session

        def get_account_usage(self, received):  # noqa: ANN001
            assert received is account
            return 900, 90, 4

        def get_account_quota(self, received):  # noqa: ANN001
            assert received is account
            return 5.0, 500

    monkeypatch.setattr(browser_router, "S3AccountsService", FakeS3AccountsService)
    app.dependency_overrides[dependencies.get_account_context] = lambda: account

    response = client.get("/api/browser/usage-summary")

    assert response.status_code == 200
    assert response.json() == {
        "available": True,
        "source": "portal",
        "label": "Storage Spaces",
        "used_bytes": 900,
        "object_count": 90,
        "quota_max_size_bytes": 5 * 1024**3,
        "quota_max_objects": 500,
    }


def test_browser_usage_summary_does_not_fallback_to_portal_storage_space_rows(client, db_session, monkeypatch):
    persisted_account = S3Account(name="portal-browser-summary")
    persisted_account.id = 77
    account = S3ExecutionContext.from_account(persisted_account, context_kind="portal_account")
    account.portal_browser_role = "portal_manager"
    account.portal_storage_spaces = [
        BrowserBucket(name="space-a", display_name="Space A", used_bytes=900, object_count=90),
    ]

    class FakeS3AccountsService:
        def __init__(self, db):  # noqa: ANN001
            assert db is db_session

        def get_account_usage(self, received):  # noqa: ANN001
            assert received is account
            return None, None, None

        def get_account_quota(self, received):  # noqa: ANN001
            raise AssertionError("quota should not be fetched when live usage is unavailable")

    monkeypatch.setattr(browser_router, "S3AccountsService", FakeS3AccountsService)
    app.dependency_overrides[dependencies.get_account_context] = lambda: account

    response = client.get("/api/browser/usage-summary")

    assert response.status_code == 200
    assert response.json() == {
        "available": False,
        "source": "portal",
        "label": "Storage Spaces",
    }


def test_browser_usage_summary_hides_connection_usage_without_bucket_listing(client):
    account = S3ExecutionContext(
        context_id="conn-9",
        context_kind="connection",
        name="browser-connection",
        access_key="access",
        secret_key="secret",
        s3_connection_id=9,
    )

    app.dependency_overrides[dependencies.get_account_context] = lambda: account

    response = client.get("/api/browser/usage-summary")

    assert response.status_code == 200
    assert response.json() == {
        "available": False,
        "source": "connection",
        "label": "Connection",
    }
