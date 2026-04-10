# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from app.db import S3Account
from app.main import app
from app.models.browser import ObjectColumnValues, ObjectColumnsResponse
from app.routers import browser as browser_router
from app.routers import dependencies


def _account() -> S3Account:
    account = S3Account(name="columns-test")
    account.id = 78
    return account


def test_browser_get_object_columns_passes_keys_and_columns(client):
    captured: dict[str, object] = {}

    class FakeService:
        def get_object_columns(
            self,
            bucket_name,
            account,
            *,
            keys,
            columns,
            sse_customer=None,
        ):  # noqa: ANN001
            captured["bucket_name"] = bucket_name
            captured["account_id"] = account.id
            captured["keys"] = keys
            captured["columns"] = columns
            captured["sse_customer"] = sse_customer
            return ObjectColumnsResponse(
                items=[
                    ObjectColumnValues(
                        key="folder/demo.txt",
                        content_type="text/plain",
                        tags_count=2,
                        metadata_count=1,
                        metadata_status="ready",
                        tags_status="ready",
                    )
                ]
            )

    app.dependency_overrides[dependencies.get_account_context] = _account
    app.dependency_overrides[browser_router.get_browser_service] = lambda: FakeService()

    response = client.post(
        "/api/browser/buckets/my-bucket/objects/columns?account_id=s3u-1",
        json={
            "keys": ["folder/demo.txt"],
            "columns": ["content_type", "tags_count"],
        },
    )

    assert response.status_code == 200
    assert response.json() == {
        "items": [
            {
                "key": "folder/demo.txt",
                "content_type": "text/plain",
                "tags_count": 2,
                "metadata_count": 1,
                "cache_control": None,
                "expires": None,
                "restore_status": None,
                "metadata_status": "ready",
                "tags_status": "ready",
            }
        ]
    }
    assert captured["bucket_name"] == "my-bucket"
    assert captured["account_id"] == 78
    assert captured["keys"] == ["folder/demo.txt"]
    assert captured["columns"] == {"content_type", "tags_count"}
    assert captured["sse_customer"] is None

    app.dependency_overrides.pop(dependencies.get_account_context, None)
    app.dependency_overrides.pop(browser_router.get_browser_service, None)


def test_browser_get_object_columns_maps_runtime_error_to_bad_gateway(client):
    class FakeService:
        def get_object_columns(self, *args, **kwargs):  # noqa: ANN002, ANN003
            raise RuntimeError("S3 head_object failed")

    app.dependency_overrides[dependencies.get_account_context] = _account
    app.dependency_overrides[browser_router.get_browser_service] = lambda: FakeService()

    response = client.post(
        "/api/browser/buckets/my-bucket/objects/columns?account_id=s3u-1",
        json={
            "keys": ["folder/demo.txt"],
            "columns": ["content_type"],
        },
    )

    assert response.status_code == 502
    assert "S3 head_object failed" in response.json()["detail"]

    app.dependency_overrides.pop(dependencies.get_account_context, None)
    app.dependency_overrides.pop(browser_router.get_browser_service, None)
