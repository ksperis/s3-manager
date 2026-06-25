# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import asyncio

from fastapi import HTTPException
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.requests import Request

from app import main
from app.routers.http_errors import (
    raise_bad_gateway_from_exception,
    raise_bad_gateway_from_runtime,
    raise_bad_request_from_value_error,
    raise_http_exception_from_exception,
    sanitize_error_detail,
)


def _request(path: str = "/api/browser/buckets/demo") -> Request:
    return Request(
        {
            "type": "http",
            "http_version": "1.1",
            "method": "GET",
            "scheme": "http",
            "path": path,
            "raw_path": path.encode("utf-8"),
            "query_string": b"",
            "headers": [],
            "server": ("testserver", 80),
            "client": ("testclient", 12345),
        }
    )


def test_raise_bad_gateway_from_runtime_preserves_safe_runtime_message():
    try:
        raise_bad_gateway_from_runtime(RuntimeError("backend timeout"))
    except HTTPException as exc:
        assert exc.status_code == 502
        assert exc.detail == "backend timeout"
    else:
        raise AssertionError("Expected HTTPException")


def test_raise_bad_gateway_from_exception_redacts_runtime_detail():
    try:
        raise_bad_gateway_from_exception(RuntimeError("upstream token=leaked at https://rgw.internal/object"))
    except HTTPException as exc:
        assert exc.status_code == 502
        assert exc.detail == "upstream token=<redacted> at <redacted-url>"
    else:
        raise AssertionError("Expected HTTPException")


def test_raise_bad_request_from_value_error_redacts_sensitive_user_input():
    try:
        raise_bad_request_from_value_error(ValueError("invalid callback secret_access_key=abc123"))
    except HTTPException as exc:
        assert exc.status_code == 400
        assert exc.detail == "invalid callback secret_access_key=<redacted>"
    else:
        raise AssertionError("Expected HTTPException")


def test_raise_http_exception_from_exception_preserves_status_and_redacts_detail():
    try:
        raise_http_exception_from_exception(404, RuntimeError("missing token=leaked"))
    except HTTPException as exc:
        assert exc.status_code == 404
        assert exc.detail == "missing token=<redacted>"
    else:
        raise AssertionError("Expected HTTPException")


def test_sanitize_error_detail_redacts_presigned_urls_and_credentials():
    detail = sanitize_error_detail(
        "S3 request failed for https://rgw.internal/demo/key?"
        "X-Amz-Credential=AKIA1234567890ABCDEF/20260619/us-east-1/s3/aws4_request&"
        "X-Amz-Signature=deadbeef&X-Amz-Security-Token=session-token "
        "secret_access_key=wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY "
        "Authorization: Bearer abcdefghijklmnopqrstuvwxyz"
    )

    assert detail == (
        "S3 request failed for <redacted-url> "
        "secret_access_key=<redacted> "
        "Authorization: <redacted>"
    )
    assert "rgw.internal" not in detail
    assert "AKIA1234567890ABCDEF" not in detail
    assert "deadbeef" not in detail
    assert "session-token" not in detail
    assert "wJalrXUtnFEMI" not in detail
    assert "abcdefghijklmnopqrstuvwxyz" not in detail


def test_sanitize_error_detail_redacts_nested_sensitive_values():
    detail = sanitize_error_detail(
        {
            "message": "Unable to fetch bucket demo-bucket",
            "access_key_id": "AKIA1234567890ABCDEF",
            "metadata": {"token": "secret-token", "error": "AccessDenied"},
        }
    )

    assert detail == {
        "message": "Unable to fetch bucket demo-bucket",
        "access_key_id": "<redacted>",
        "metadata": {"token": "<redacted>", "error": "AccessDenied"},
    }


def test_log_http_exceptions_sanitizes_5xx_response_detail():
    exc = StarletteHTTPException(
        status_code=502,
        detail=(
            "Unable to fetch https://rgw.internal/bucket/key?"
            "X-Amz-Signature=deadbeef token=leaked"
        ),
    )

    response = asyncio.run(main.log_http_exceptions(_request(), exc))

    assert response.status_code == 502
    body = response.body.decode("utf-8")
    assert "<redacted-url>" in body
    assert "token=<redacted>" in body
    assert "rgw.internal" not in body
    assert "deadbeef" not in body
    assert "token=leaked" not in body
