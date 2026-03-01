# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from typing import Optional
from urllib.parse import urlsplit, urlunsplit

from app.core.config import get_settings

settings = get_settings()


def normalize_s3_endpoint(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    normalized = value.strip().rstrip("/")
    return normalized or None


def validate_custom_login_s3_endpoint(value: str) -> str:
    normalized = normalize_s3_endpoint(value)
    if not normalized:
        raise ValueError("Custom endpoint URL is required")
    parsed = urlsplit(normalized)
    scheme = (parsed.scheme or "").lower()
    if scheme not in {"http", "https"}:
        raise ValueError("Custom endpoint URL must use http or https")
    if parsed.query or parsed.fragment:
        raise ValueError("Custom endpoint URL must not include query parameters or fragments")
    if parsed.username or parsed.password:
        raise ValueError("Custom endpoint URL must not include credentials")
    hostname = parsed.hostname
    if not hostname:
        raise ValueError("Custom endpoint URL must include a hostname")
    try:
        port = parsed.port
    except ValueError as exc:
        raise ValueError("Custom endpoint URL has an invalid port") from exc
    host = hostname.lower()
    if ":" in host and not host.startswith("["):
        host = f"[{host}]"
    netloc = f"{host}:{port}" if port is not None else host
    cleaned = urlunsplit((scheme, netloc, parsed.path or "", "", "")).rstrip("/")
    if not cleaned:
        raise ValueError("Custom endpoint URL is invalid")
    return cleaned


def configured_s3_endpoint() -> Optional[str]:
    if "seed_s3_endpoint" not in settings.model_fields_set:
        return None
    return normalize_s3_endpoint(settings.seed_s3_endpoint)


def resolve_s3_endpoint(account: object) -> Optional[str]:
    override = getattr(account, "_session_endpoint", None)
    if override:
        return override
    endpoint = getattr(account, "storage_endpoint", None)
    if endpoint:
        endpoint_url = getattr(endpoint, "endpoint_url", None)
        if endpoint_url:
            return endpoint_url
    endpoint_url = getattr(account, "storage_endpoint_url", None)
    if endpoint_url:
        return endpoint_url
    return None


def resolve_s3_client_options(account: object) -> tuple[Optional[str], Optional[str], bool, bool]:
    """Resolve S3 client options (endpoint, region, force_path_style, verify_tls)."""
    endpoint = resolve_s3_endpoint(account)
    region = getattr(account, "_session_region", None)
    if region is None:
        endpoint_obj = getattr(account, "storage_endpoint", None)
        if endpoint_obj is not None:
            region = getattr(endpoint_obj, "region", None)
    force_path_style = bool(getattr(account, "_session_force_path_style", False))
    verify_tls = bool(getattr(account, "_session_verify_tls", True))
    return endpoint, region, force_path_style, verify_tls
