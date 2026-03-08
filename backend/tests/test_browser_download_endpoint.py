# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import base64
import hashlib

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
        def download_object(self, bucket_name, account, key, version_id=None, sse_customer=None):  # noqa: ANN001
            captured["bucket_name"] = bucket_name
            captured["account_id"] = account.id
            captured["key"] = key
            captured["version_id"] = version_id
            captured["sse_customer"] = sse_customer
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
        "sse_customer": None,
    }


def test_browser_download_rejects_missing_key(client):
    class FakeService:
        def download_object(self, bucket_name, account, key, version_id=None, sse_customer=None):  # noqa: ANN001
            raise AssertionError("download_object should not be called when key is empty")

    app.dependency_overrides[dependencies.get_account_context] = _account
    app.dependency_overrides[browser_router.get_browser_service] = lambda: FakeService()

    response = client.get("/api/browser/buckets/my-bucket/download?key=")
    assert response.status_code == 400
    assert response.json()["detail"] == "Missing key"


def test_browser_download_maps_service_error_to_bad_gateway(client):
    class FakeService:
        def download_object(self, bucket_name, account, key, version_id=None, sse_customer=None):  # noqa: ANN001
            raise RuntimeError("S3 get_object failed")

    app.dependency_overrides[dependencies.get_account_context] = _account
    app.dependency_overrides[browser_router.get_browser_service] = lambda: FakeService()

    response = client.get("/api/browser/buckets/my-bucket/download?key=demo.txt")
    assert response.status_code == 502
    assert "S3 get_object failed" in response.json()["detail"]


def test_browser_download_passes_sse_customer_context_to_service(client):
    captured: dict[str, object] = {}
    raw_key = bytes(range(32))
    key_b64 = base64.b64encode(raw_key).decode("ascii")
    expected_md5 = base64.b64encode(hashlib.md5(raw_key).digest()).decode("ascii")

    class FakeService:
        def download_object(self, bucket_name, account, key, version_id=None, sse_customer=None):  # noqa: ANN001
            captured["bucket_name"] = bucket_name
            captured["key"] = key
            captured["sse_customer"] = sse_customer
            return iter([b"ok"]), "application/octet-stream", "demo.bin"

    app.dependency_overrides[dependencies.get_account_context] = _account
    app.dependency_overrides[browser_router.get_browser_service] = lambda: FakeService()

    response = client.get(
        "/api/browser/buckets/my-bucket/download?key=demo.txt",
        headers={
            "X-S3-SSE-C-Key": key_b64,
            "X-S3-SSE-C-Algorithm": "AES256",
        },
    )
    assert response.status_code == 200
    sse_customer = captured["sse_customer"]
    assert sse_customer is not None
    assert sse_customer.algorithm == "AES256"
    assert sse_customer.key == key_b64
    assert sse_customer.key_md5 == expected_md5


def test_browser_download_rejects_invalid_sse_customer_key(client):
    class FakeService:
        def download_object(self, bucket_name, account, key, version_id=None, sse_customer=None):  # noqa: ANN001
            raise AssertionError("download_object should not be called for invalid SSE-C key")

    app.dependency_overrides[dependencies.get_account_context] = _account
    app.dependency_overrides[browser_router.get_browser_service] = lambda: FakeService()

    response = client.get(
        "/api/browser/buckets/my-bucket/download?key=demo.txt",
        headers={"X-S3-SSE-C-Key": "invalid"},
    )
    assert response.status_code == 400
    assert response.json()["detail"] == "X-S3-SSE-C-Key must be valid base64"
