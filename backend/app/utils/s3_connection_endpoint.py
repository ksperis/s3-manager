# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Optional, Tuple


_CUSTOM_ENDPOINT_FIELDS = {
    "endpoint_url",
    "region",
    "force_path_style",
    "verify_tls",
    "provider",
}


@dataclass(frozen=True)
class CustomEndpointConfig:
    endpoint_url: Optional[str]
    region: Optional[str]
    force_path_style: bool
    verify_tls: bool
    provider: Optional[str]


def _optional_string(value: object, *, field: str) -> Optional[str]:
    if value is None:
        return None
    if not isinstance(value, str) or value != value.strip() or not value:
        raise ValueError(f"Persisted custom endpoint {field} must be a normalized string or null")
    return value


def parse_custom_endpoint_config(value: str) -> CustomEndpointConfig:
    parsed = json.loads(value)
    if not isinstance(parsed, dict) or set(parsed) != _CUSTOM_ENDPOINT_FIELDS:
        raise ValueError("Persisted custom endpoint configuration has a non-canonical shape")

    endpoint_url = parsed["endpoint_url"]
    if (
        not isinstance(endpoint_url, str)
        or not endpoint_url
        or endpoint_url != endpoint_url.strip().rstrip("/")
    ):
        raise ValueError("Persisted custom endpoint URL must be normalized")
    force_path_style = parsed["force_path_style"]
    verify_tls = parsed["verify_tls"]
    if not isinstance(force_path_style, bool) or not isinstance(verify_tls, bool):
        raise ValueError("Persisted custom endpoint flags must be booleans")
    return CustomEndpointConfig(
        endpoint_url=endpoint_url,
        region=_optional_string(parsed["region"], field="region"),
        force_path_style=force_path_style,
        verify_tls=verify_tls,
        provider=_optional_string(parsed["provider"], field="provider"),
    )


def custom_endpoint_update_base(value: Optional[str]) -> CustomEndpointConfig:
    if value is not None:
        return parse_custom_endpoint_config(value)
    return CustomEndpointConfig(
        endpoint_url=None,
        region=None,
        force_path_style=False,
        verify_tls=True,
        provider=None,
    )


def build_custom_endpoint_config(
    endpoint_url: str,
    region: Optional[str],
    force_path_style: bool,
    verify_tls: bool,
    provider: Optional[str] = None,
) -> str:
    normalized_endpoint_url = endpoint_url.strip().rstrip("/")
    if not normalized_endpoint_url:
        raise ValueError("Endpoint URL is required for manual connections")
    return json.dumps(
        {
            "endpoint_url": normalized_endpoint_url,
            "region": region.strip() if region and region.strip() else None,
            "force_path_style": bool(force_path_style),
            "verify_tls": bool(verify_tls),
            "provider": provider.strip() if provider and provider.strip() else None,
        },
        separators=(",", ":"),
        sort_keys=True,
    )


@dataclass
class ConnectionEndpointDetails:
    endpoint_url: Optional[str]
    region: Optional[str]
    force_path_style: bool
    verify_tls: bool
    provider: Optional[str]
    endpoint_name: Optional[str]


def resolve_connection_details(conn: object) -> ConnectionEndpointDetails:
    endpoint = getattr(conn, "storage_endpoint", None)
    if endpoint:
        return ConnectionEndpointDetails(
            endpoint.endpoint_url,
            endpoint.region,
            bool(endpoint.force_path_style),
            bool(endpoint.verify_tls),
            endpoint.provider,
            endpoint.name,
        )
    raw_config = getattr(conn, "custom_endpoint_config", None)
    if raw_config is None:
        raise ValueError("Manual S3 connection is missing its endpoint configuration")
    config = parse_custom_endpoint_config(raw_config)
    return ConnectionEndpointDetails(
        config.endpoint_url,
        config.region,
        config.force_path_style,
        config.verify_tls,
        config.provider,
        None,
    )


def resolve_connection_endpoint(conn: object) -> Tuple[Optional[str], Optional[str], bool, bool]:
    details = resolve_connection_details(conn)
    return details.endpoint_url, details.region, details.force_path_style, details.verify_tls
