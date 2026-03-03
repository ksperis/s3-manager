# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Callable, Iterable, TypeVar

import pytest

from .clients import BackendAPIError

T = TypeVar("T")

DEFAULT_UNSUPPORTED_MARKERS = (
    "not supported",
    "not implemented",
    "not available",
    "disabled for this endpoint",
    "usage logs are disabled",
    "storage metrics are disabled",
    "unsupported",
    "unavailable",
    "invalidargument",
    "invalid request",
    "invalid target bucket",
    "malformedxml",
    "invalidbucketstate",
    "methodnotallowed",
    "accountalreadyexists",
    "useralreadyexists",
    "not authorized for this account",
    "cannot delete the rgw tenant",
)


def backend_error_detail(exc: BackendAPIError) -> str:
    payload = exc.payload
    if isinstance(payload, dict):
        detail = payload.get("detail")
        if isinstance(detail, str):
            return detail
        if detail is not None:
            return str(detail)
    if isinstance(payload, str):
        return payload
    if payload is None:
        return ""
    return str(payload)


def looks_unsupported(
    exc: BackendAPIError,
    *,
    markers: Iterable[str] = DEFAULT_UNSUPPORTED_MARKERS,
    allowed_statuses: set[int] | None = None,
) -> bool:
    status = exc.status_code or 0
    supported_statuses = allowed_statuses or {400, 403, 404, 409, 422, 500, 501, 502, 503}
    if status not in supported_statuses:
        return False
    detail = backend_error_detail(exc).lower()
    if not detail:
        return status in {501, 503}
    return any(marker.lower() in detail for marker in markers)


def run_or_skip(
    action: str,
    fn: Callable[[], T],
    *,
    markers: Iterable[str] = DEFAULT_UNSUPPORTED_MARKERS,
    allowed_statuses: set[int] | None = None,
) -> T:
    try:
        return fn()
    except BackendAPIError as exc:
        if looks_unsupported(exc, markers=markers, allowed_statuses=allowed_statuses):
            detail = backend_error_detail(exc).strip()
            reason = detail or f"status={exc.status_code}"
            pytest.skip(f"{action} unavailable on this cluster: {reason}")
        raise


__all__ = [
    "backend_error_detail",
    "looks_unsupported",
    "run_or_skip",
]
