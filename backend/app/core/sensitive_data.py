# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import re
from collections.abc import Mapping, Sequence

_REDACTED = "<redacted>"
_REDACTED_URL = "<redacted-url>"
_TRUNCATED = "... <truncated>"
_MAX_ERROR_DETAIL_LENGTH = 1200

_URL_RE = re.compile(r"https?://[^\s\"'<>]+", re.IGNORECASE)
_HTTP_POOL_ENDPOINT_RE = re.compile(
    r"\b(?:HTTP|HTTPS)ConnectionPool\(host=['\"][^'\"]+['\"],\s*port=\d+\)",
    re.IGNORECASE,
)
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
    r"|bind[-_]?password"
    r"|client[-_]?secret"
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
_ERROR_SENSITIVE_KEY_MARKERS = (
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
_AUDIT_SENSITIVE_EXACT_KEYS = {
    "access_key",
    "admin_secret_key",
    "authorization",
    "bind_password",
    "ceph_admin_secret_key",
    "client_secret",
    "credential",
    "password",
    "refresh_token",
    "rgw_secret_key",
    "secret",
    "secret_access_key",
    "secret_key",
    "security_token",
    "session_token",
    "supervision_secret_key",
    "token",
}
_AUDIT_SENSITIVE_KEY_FRAGMENTS = (
    "secret_access_key",
    "secret_key",
    "session_token",
    "security_token",
)
_AUDIT_PUBLIC_IDENTIFIER_KEYS = {
    "access_key_id",
}


def _normalize_key(key: object) -> str:
    return str(key or "").strip().lower().replace("-", "_")


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


def _sanitize_sensitive_text(value: str, *, redact_urls: bool, truncate: bool) -> str:
    text = str(value or "").strip()
    if not text:
        return "Upstream service error." if redact_urls else ""
    if redact_urls:
        text = _URL_RE.sub(_redact_url, text)
        text = _HTTP_POOL_ENDPOINT_RE.sub("<redacted-endpoint>", text)
    text = _AUTH_HEADER_RE.sub(r"\1: " + _REDACTED, text)
    text = _AUTH_SCHEME_RE.sub(lambda match: f"{match.group(1)} {_REDACTED}", text)
    text = _SENSITIVE_ASSIGNMENT_RE.sub(_redact_assignment, text)
    text = _AWS_ACCESS_KEY_ID_RE.sub(_REDACTED, text)
    return _truncate_error_text(text) if truncate else text


def _is_error_sensitive_key(key: object) -> bool:
    normalized = _normalize_key(key)
    return any(marker in normalized for marker in _ERROR_SENSITIVE_KEY_MARKERS)


def _is_audit_sensitive_key(key: object) -> bool:
    normalized = _normalize_key(key)
    if normalized in _AUDIT_PUBLIC_IDENTIFIER_KEYS:
        return False
    if normalized in _AUDIT_SENSITIVE_EXACT_KEYS:
        return True
    return any(fragment in normalized for fragment in _AUDIT_SENSITIVE_KEY_FRAGMENTS)


def sanitize_error_detail(value: object) -> object:
    """Redact secrets from error details before returning them to clients or logs."""
    if isinstance(value, str):
        return _sanitize_sensitive_text(value, redact_urls=True, truncate=True)
    if isinstance(value, Mapping):
        return {
            key: _REDACTED if _is_error_sensitive_key(key) else sanitize_error_detail(entry)
            for key, entry in value.items()
        }
    if isinstance(value, Sequence) and not isinstance(value, (bytes, bytearray)):
        return [sanitize_error_detail(entry) for entry in value]
    if value is None or isinstance(value, (bool, int, float)):
        return value
    return _sanitize_sensitive_text(str(value), redact_urls=True, truncate=True)


def sanitized_error_log_detail(value: object) -> str:
    detail = sanitize_error_detail(value)
    return detail if isinstance(detail, str) else str(detail)


def sanitize_audit_metadata(value: object) -> object:
    """Redact secrets from audit metadata while preserving useful public identifiers."""
    if isinstance(value, str):
        return _sanitize_sensitive_text(value, redact_urls=False, truncate=False)
    if isinstance(value, Mapping):
        sanitized = {}
        for key, entry in value.items():
            normalized_key = _normalize_key(key)
            if _is_audit_sensitive_key(key):
                sanitized[key] = _REDACTED
            elif normalized_key in _AUDIT_PUBLIC_IDENTIFIER_KEYS and (
                entry is None or isinstance(entry, (bool, int, float, str))
            ):
                sanitized[key] = entry
            else:
                sanitized[key] = sanitize_audit_metadata(entry)
        return sanitized
    if isinstance(value, Sequence) and not isinstance(value, (bytes, bytearray)):
        return [sanitize_audit_metadata(entry) for entry in value]
    if value is None or isinstance(value, (bool, int, float)):
        return value
    return _sanitize_sensitive_text(str(value), redact_urls=False, truncate=False)
