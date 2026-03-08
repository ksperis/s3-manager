# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import base64
import hashlib
from io import BytesIO

import pytest

from app.db import S3Account
from app.models.browser import (
    MultipartUploadInitRequest,
    PresignPartRequest,
    PresignRequest,
    SseCustomerContext,
)
from app.services.browser_service import BrowserService


def _account() -> S3Account:
    account = S3Account(name="browser-sse-c")
    account.id = 17
    account.rgw_access_key = "access-key"
    account.rgw_secret_key = "secret-key"
    account.storage_endpoint_url = "https://s3.example.test"
    return account


def _sse_context() -> SseCustomerContext:
    raw_key = bytes(range(32))
    return SseCustomerContext(
        algorithm="AES256",
        key=base64.b64encode(raw_key).decode("ascii"),
        key_md5=base64.b64encode(hashlib.md5(raw_key).digest()).decode("ascii"),
    )


def test_presign_includes_sse_customer_params_and_response_headers(monkeypatch):
    captured: dict[str, object] = {}

    class FakeClient:
        def generate_presigned_url(self, operation_name, Params=None, ExpiresIn=None):  # noqa: N803, ANN001
            captured["operation_name"] = operation_name
            captured["params"] = Params
            captured["expires"] = ExpiresIn
            return "https://example.test/presigned"

    service = BrowserService()
    monkeypatch.setattr(service, "_client", lambda _account: FakeClient())

    result = service.presign(
        "bucket-a",
        _account(),
        PresignRequest(key="docs/report.pdf", operation="get_object", expires_in=300),
        sse_customer=_sse_context(),
    )

    assert captured["operation_name"] == "get_object"
    params = captured["params"]
    assert isinstance(params, dict)
    assert params["SSECustomerAlgorithm"] == "AES256"
    assert "SSECustomerKey" in params
    assert "SSECustomerKeyMD5" in params
    assert result.method == "GET"
    assert result.headers["x-amz-server-side-encryption-customer-algorithm"] == "AES256"
    assert "x-amz-server-side-encryption-customer-key" in result.headers
    assert "x-amz-server-side-encryption-customer-key-MD5" in result.headers


def test_presign_rejects_post_object_when_sse_customer_is_enabled(monkeypatch):
    service = BrowserService()
    monkeypatch.setattr(service, "_client", lambda _account: object())

    with pytest.raises(RuntimeError, match="SSE-C is not supported with post_object presign"):
        service.presign(
            "bucket-a",
            _account(),
            PresignRequest(key="demo.txt", operation="post_object", expires_in=300),
            sse_customer=_sse_context(),
        )


def test_initiate_multipart_upload_passes_sse_customer(monkeypatch):
    captured: dict[str, object] = {}

    class FakeClient:
        def create_multipart_upload(self, **kwargs):  # noqa: ANN001
            captured["kwargs"] = kwargs
            return {"UploadId": "upload-1"}

    service = BrowserService()
    monkeypatch.setattr(service, "_client", lambda _account: FakeClient())

    response = service.initiate_multipart_upload(
        "bucket-a",
        _account(),
        MultipartUploadInitRequest(key="large.bin"),
        sse_customer=_sse_context(),
    )

    assert response.upload_id == "upload-1"
    kwargs = captured["kwargs"]
    assert isinstance(kwargs, dict)
    assert kwargs["SSECustomerAlgorithm"] == "AES256"
    assert "SSECustomerKey" in kwargs
    assert "SSECustomerKeyMD5" in kwargs


def test_presign_part_passes_sse_customer_and_returns_required_headers(monkeypatch):
    captured: dict[str, object] = {}

    class FakeClient:
        def generate_presigned_url(self, operation_name, Params=None, ExpiresIn=None):  # noqa: N803, ANN001
            captured["operation_name"] = operation_name
            captured["params"] = Params
            captured["expires"] = ExpiresIn
            return "https://example.test/upload-part"

    service = BrowserService()
    monkeypatch.setattr(service, "_client", lambda _account: FakeClient())

    result = service.presign_part(
        "bucket-a",
        _account(),
        PresignPartRequest(key="large.bin", upload_id="upload-1", part_number=3, expires_in=900),
        sse_customer=_sse_context(),
    )

    assert captured["operation_name"] == "upload_part"
    params = captured["params"]
    assert isinstance(params, dict)
    assert params["SSECustomerAlgorithm"] == "AES256"
    assert "SSECustomerKey" in params
    assert "SSECustomerKeyMD5" in params
    assert result.headers["x-amz-server-side-encryption-customer-algorithm"] == "AES256"
    assert "x-amz-server-side-encryption-customer-key" in result.headers
    assert "x-amz-server-side-encryption-customer-key-MD5" in result.headers


def test_head_object_passes_sse_customer_headers(monkeypatch):
    captured: dict[str, object] = {}

    class FakeClient:
        def head_object(self, **kwargs):  # noqa: ANN001
            captured["kwargs"] = kwargs
            return {
                "ContentLength": 1,
                "ETag": '"abc"',
                "LastModified": None,
                "ContentType": "text/plain",
                "Metadata": {},
            }

    service = BrowserService()
    monkeypatch.setattr(service, "_client", lambda _account: FakeClient())

    service.head_object("bucket-a", _account(), "docs/report.txt", sse_customer=_sse_context())

    kwargs = captured["kwargs"]
    assert isinstance(kwargs, dict)
    assert kwargs["SSECustomerAlgorithm"] == "AES256"
    assert "SSECustomerKey" in kwargs
    assert "SSECustomerKeyMD5" in kwargs


def test_proxy_download_and_download_object_pass_sse_customer(monkeypatch):
    calls: list[dict[str, object]] = []

    class Body:
        def iter_chunks(self, chunk_size=1024):  # noqa: ANN001
            return iter([b"hello"])

    class FakeClient:
        def get_object(self, **kwargs):  # noqa: ANN001
            calls.append(kwargs)
            return {
                "Body": Body(),
                "ContentType": "text/plain",
                "ContentDisposition": 'attachment; filename="demo.txt"',
            }

    service = BrowserService()
    monkeypatch.setattr(service, "_client", lambda _account: FakeClient())

    proxy_resp = service.proxy_download("bucket-a", _account(), "docs/demo.txt", sse_customer=_sse_context())
    stream, content_type, filename = service.download_object(
        "bucket-a",
        _account(),
        "docs/demo.txt",
        sse_customer=_sse_context(),
    )

    assert proxy_resp["ContentType"] == "text/plain"
    assert content_type == "text/plain"
    assert filename == "demo.txt"
    assert next(iter(stream)) == b"hello"
    assert len(calls) == 2
    for kwargs in calls:
        assert kwargs["SSECustomerAlgorithm"] == "AES256"
        assert "SSECustomerKey" in kwargs
        assert "SSECustomerKeyMD5" in kwargs


def test_proxy_upload_passes_sse_customer(monkeypatch):
    captured: dict[str, object] = {}

    class FakeClient:
        def upload_fileobj(self, file_obj, bucket_name, key, ExtraArgs=None):  # noqa: N803, ANN001
            file_obj.read(1)
            captured["bucket_name"] = bucket_name
            captured["key"] = key
            captured["extra_args"] = ExtraArgs or {}

    service = BrowserService()
    monkeypatch.setattr(service, "_client", lambda _account: FakeClient())

    service.proxy_upload(
        "bucket-a",
        _account(),
        "docs/upload.bin",
        BytesIO(b"content"),
        "application/octet-stream",
        sse_customer=_sse_context(),
    )

    assert captured["bucket_name"] == "bucket-a"
    assert captured["key"] == "docs/upload.bin"
    extra_args = captured["extra_args"]
    assert extra_args["ContentType"] == "application/octet-stream"
    assert extra_args["SSECustomerAlgorithm"] == "AES256"
    assert "SSECustomerKey" in extra_args
    assert "SSECustomerKeyMD5" in extra_args
