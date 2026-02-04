# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from typing import Optional

from app.core.config import get_settings

settings = get_settings()


def normalize_s3_endpoint(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    normalized = value.strip().rstrip("/")
    return normalized or None


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
