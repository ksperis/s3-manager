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
