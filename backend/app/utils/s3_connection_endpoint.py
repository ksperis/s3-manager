# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Optional, Tuple


def parse_custom_endpoint_config(value: Optional[str]) -> dict[str, Any]:
    if not value:
        return {}
    try:
        parsed = json.loads(value)
    except Exception:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def build_custom_endpoint_config(
    endpoint_url: Optional[str],
    region: Optional[str],
    force_path_style: bool,
    verify_tls: bool,
    provider: Optional[str] = None,
) -> str:
    return json.dumps(
        {
            "endpoint_url": endpoint_url or None,
            "region": region or None,
            "force_path_style": bool(force_path_style),
            "verify_tls": bool(verify_tls),
            "provider": provider or None,
        }
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
        endpoint_url = getattr(endpoint, "endpoint_url", None)
        region = getattr(endpoint, "region", None)
        provider = getattr(endpoint, "provider", None)
        endpoint_name = getattr(endpoint, "name", None)
        force_path_style = bool(getattr(endpoint, "force_path_style", False))
        return ConnectionEndpointDetails(endpoint_url, region, force_path_style, True, provider, endpoint_name)
    cfg = parse_custom_endpoint_config(getattr(conn, "custom_endpoint_config", None))
    endpoint_url = cfg.get("endpoint_url") or getattr(conn, "endpoint_url", None)
    region = cfg["region"] if "region" in cfg else getattr(conn, "region", None)
    if "force_path_style" in cfg:
        force_path_style = bool(cfg.get("force_path_style"))
    else:
        force_path_style = bool(getattr(conn, "force_path_style", False))
    if "verify_tls" in cfg:
        verify_tls = bool(cfg.get("verify_tls"))
    else:
        verify_tls = bool(getattr(conn, "verify_tls", True))
    provider = cfg.get("provider") or cfg.get("provider_hint") or getattr(conn, "provider_hint", None)
    return ConnectionEndpointDetails(endpoint_url, region, force_path_style, verify_tls, provider, None)


def resolve_connection_endpoint(conn: object) -> Tuple[Optional[str], Optional[str], bool, bool]:
    details = resolve_connection_details(conn)
    return details.endpoint_url, details.region, details.force_path_style, details.verify_tls
