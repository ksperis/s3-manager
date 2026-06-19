# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import re
from collections.abc import Mapping, Sequence
from typing import NoReturn

from fastapi import HTTPException, status

_REDACTED = "<redacted>"
_REDACTED_URL = "<redacted-url>"
_TRUNCATED = "... <truncated>"
_MAX_ERROR_DETAIL_LENGTH = 1200

_URL_RE = re.compile(r"https?://[^\s\"'<>]+", re.IGNORECASE)
_AUTH_HEADER_RE = re.compile(
    r"\b(authorization)\s*[:=]\s*(?:bearer|basic|aws4-hmac-sha256|aws)\s+[^,\n\r;]+",
    re.IGNORECASE,
)
_AUTH_SCHEME_RE = re.compile(
    r"\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}",
    re.IGNORECASE,
)
_SENSITIVE_ASSIGNMENT_RE = re.compile(
    r"\b(?P<key>"
    r"(?:x-amz-)?(?:credential|signature|security-token|session-token)"
    r"|awsaccesskeyid"
    r"|access[-_]?key(?:[-_]?id)?"
    r"|secret[-_]?access[-_]?key"
    r"|secret[-_]?key"
    r"|session[-_]?token"
    r"|authorization"
    r"|password"
    r"|token"
    r")\b"
    r"(?P<separator>\s*[:=]\s*)"
    r"(?P<quote>[\"']?)"
    r"(?P<value>[^\"'\s,;&]+)"
    r"(?P=quote)",
    re.IGNORECASE,
)
_AWS_ACCESS_KEY_ID_RE = re.compile(
    r"\b(?:AKIA|ASIA|AGPA|AIDA|AROA|ANPA)[A-Z0-9]{12,}\b"
)
_SENSITIVE_KEY_MARKERS = (
    "authorization",
    "credential",
    "password",
    "secret",
    "signature",
    "token",
    "access_key",
    "access-key",
    "awsaccesskeyid",
)


def _truncate_error_text(text: str) -> str:
    if len(text) <= _MAX_ERROR_DETAIL_LENGTH:
        return text
    return f"{text[: _MAX_ERROR_DETAIL_LENGTH - len(_TRUNCATED)].rstrip()}{_TRUNCATED}"


def _redact_url(match: re.Match[str]) -> str:
    raw_url = match.group(0)
    suffix = ""
    while raw_url and raw_url[-1] in ".,;)":
        suffix = f"{raw_url[-1]}{suffix}"
        raw_url = raw_url[:-1]
    if not raw_url:
        return suffix
    return f"{_REDACTED_URL}{suffix}"


def _redact_assignment(match: re.Match[str]) -> str:
    return f"{match.group('key')}{match.group('separator')}{_REDACTED}"


def _sanitize_error_text(value: str) -> str:
    text = str(value or "").strip()
    if not text:
        return "Upstream service error."
    text = _URL_RE.sub(_redact_url, text)
    text = _AUTH_HEADER_RE.sub(r"\1: " + _REDACTED, text)
    text = _AUTH_SCHEME_RE.sub(lambda match: f"{match.group(1)} {_REDACTED}", text)
    text = _SENSITIVE_ASSIGNMENT_RE.sub(_redact_assignment, text)
    text = _AWS_ACCESS_KEY_ID_RE.sub(_REDACTED, text)
    return _truncate_error_text(text)


def _is_sensitive_key(key: object) -> bool:
    normalized = str(key or "").strip().lower()
    return any(marker in normalized for marker in _SENSITIVE_KEY_MARKERS)


def sanitize_error_detail(value: object) -> object:
    """Redact secrets from error details before returning them to clients or logs."""
    if isinstance(value, str):
        return _sanitize_error_text(value)
    if isinstance(value, Mapping):
        return {
            key: _REDACTED if _is_sensitive_key(key) else sanitize_error_detail(entry)
            for key, entry in value.items()
        }
    if isinstance(value, Sequence) and not isinstance(value, (bytes, bytearray)):
        return [sanitize_error_detail(entry) for entry in value]
    if value is None or isinstance(value, (bool, int, float)):
        return value
    return _sanitize_error_text(str(value))


def sanitized_error_log_detail(value: object) -> str:
    detail = sanitize_error_detail(value)
    return detail if isinstance(detail, str) else str(detail)


def raise_bad_gateway_from_runtime(exc: RuntimeError) -> NoReturn:
    raise HTTPException(
        status_code=status.HTTP_502_BAD_GATEWAY,
        detail=sanitize_error_detail(str(exc)),
    ) from exc
