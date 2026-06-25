# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import base64
import binascii
import hashlib
from typing import Optional

from fastapi import Header, HTTPException, status

from app.models.browser import SseCustomerContext

def get_optional_sse_customer_context(
    sse_customer_key: Optional[str] = Header(default=None, alias="X-S3-SSE-C-Key"),
    sse_customer_algorithm: Optional[str] = Header(default=None, alias="X-S3-SSE-C-Algorithm"),
) -> Optional[SseCustomerContext]:
    key_raw = sse_customer_key.strip() if isinstance(sse_customer_key, str) else ""
    algo_raw = sse_customer_algorithm.strip() if isinstance(sse_customer_algorithm, str) else ""
    if not key_raw:
        if algo_raw:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="X-S3-SSE-C-Algorithm requires X-S3-SSE-C-Key",
            )
        return None
    if algo_raw and algo_raw != "AES256":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="X-S3-SSE-C-Algorithm must be AES256",
        )
    try:
        key_bytes = base64.b64decode(key_raw, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="X-S3-SSE-C-Key must be valid base64",
        ) from exc
    if len(key_bytes) != 32:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="X-S3-SSE-C-Key must decode to exactly 32 bytes",
        )
    normalized_key = base64.b64encode(key_bytes).decode("ascii")
    key_md5 = base64.b64encode(hashlib.md5(key_bytes).digest()).decode("ascii")
    return SseCustomerContext(algorithm="AES256", key=normalized_key, key_md5=key_md5)
