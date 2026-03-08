# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import base64
import hashlib

import pytest
from fastapi import HTTPException

from app.routers.dependencies import get_optional_sse_customer_context


def test_sse_customer_dependency_returns_none_without_headers():
    assert get_optional_sse_customer_context() is None


def test_sse_customer_dependency_rejects_algorithm_without_key():
    with pytest.raises(HTTPException) as exc_info:
        get_optional_sse_customer_context(sse_customer_algorithm="AES256")
    assert exc_info.value.status_code == 400
    assert exc_info.value.detail == "X-S3-SSE-C-Algorithm requires X-S3-SSE-C-Key"


def test_sse_customer_dependency_rejects_invalid_algorithm():
    key = base64.b64encode(bytes(range(32))).decode("ascii")
    with pytest.raises(HTTPException) as exc_info:
        get_optional_sse_customer_context(sse_customer_key=key, sse_customer_algorithm="aws:kms")
    assert exc_info.value.status_code == 400
    assert exc_info.value.detail == "X-S3-SSE-C-Algorithm must be AES256"


def test_sse_customer_dependency_rejects_invalid_base64_key():
    with pytest.raises(HTTPException) as exc_info:
        get_optional_sse_customer_context(sse_customer_key="not-base64")
    assert exc_info.value.status_code == 400
    assert exc_info.value.detail == "X-S3-SSE-C-Key must be valid base64"


def test_sse_customer_dependency_rejects_non_32_byte_key():
    short_key = base64.b64encode(b"short-key").decode("ascii")
    with pytest.raises(HTTPException) as exc_info:
        get_optional_sse_customer_context(sse_customer_key=short_key)
    assert exc_info.value.status_code == 400
    assert exc_info.value.detail == "X-S3-SSE-C-Key must decode to exactly 32 bytes"


def test_sse_customer_dependency_returns_normalized_context_for_valid_key():
    raw_key = bytes(range(32))
    key = base64.b64encode(raw_key).decode("ascii")
    expected_md5 = base64.b64encode(hashlib.md5(raw_key).digest()).decode("ascii")

    context = get_optional_sse_customer_context(sse_customer_key=key)

    assert context is not None
    assert context.algorithm == "AES256"
    assert context.key == key
    assert context.key_md5 == expected_md5
