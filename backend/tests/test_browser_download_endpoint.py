# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from app.db import S3Account
from app.main import app
from app.routers import dependencies
from app.routers import browser as browser_router


def _account() -> S3Account:
    account = S3Account(name="download-test")
    account.id = 42
    return account


def test_browser_download_returns_stream(client):
    captured: dict[str, object] = {}

    class FakeService:
        def download_object(self, bucket_name, account, key, version_id=None):  # noqa: ANN001
            captured["bucket_name"] = bucket_name
            captured["account_id"] = account.id
            captured["key"] = key
            captured["version_id"] = version_id
            return iter([b"file-bytes"]), "text/plain", "demo.txt"

    app.dependency_overrides[dependencies.get_account_context] = _account
    app.dependency_overrides[browser_router.get_browser_service] = lambda: FakeService()

    response = client.get("/api/browser/buckets/my-bucket/download?key=folder/demo.txt&version_id=v1")
    assert response.status_code == 200
    assert response.content == b"file-bytes"
    assert response.headers["content-type"].startswith("text/plain")
    assert response.headers["content-disposition"] == 'attachment; filename="demo.txt"'
    assert captured == {
        "bucket_name": "my-bucket",
        "account_id": 42,
        "key": "folder/demo.txt",
        "version_id": "v1",
    }


def test_browser_download_rejects_missing_key(client):
    class FakeService:
        def download_object(self, bucket_name, account, key, version_id=None):  # noqa: ANN001
            raise AssertionError("download_object should not be called when key is empty")

    app.dependency_overrides[dependencies.get_account_context] = _account
    app.dependency_overrides[browser_router.get_browser_service] = lambda: FakeService()

    response = client.get("/api/browser/buckets/my-bucket/download?key=")
    assert response.status_code == 400
    assert response.json()["detail"] == "Missing key"


def test_browser_download_maps_service_error_to_bad_gateway(client):
    class FakeService:
        def download_object(self, bucket_name, account, key, version_id=None):  # noqa: ANN001
            raise RuntimeError("S3 get_object failed")

    app.dependency_overrides[dependencies.get_account_context] = _account
    app.dependency_overrides[browser_router.get_browser_service] = lambda: FakeService()

    response = client.get("/api/browser/buckets/my-bucket/download?key=demo.txt")
    assert response.status_code == 502
    assert "S3 get_object failed" in response.json()["detail"]
