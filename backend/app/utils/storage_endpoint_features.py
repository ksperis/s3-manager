# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Optional

import yaml

from app.db import StorageEndpoint, StorageProvider
from app.utils.normalize import normalize_storage_provider


FEATURE_KEYS: tuple[str, ...] = ("admin", "account", "sts", "usage", "metrics", "static_website", "iam", "sns", "sse")

DEFAULT_FEATURES: dict[StorageProvider, dict[str, dict[str, Any]]] = {
    StorageProvider.CEPH: {
        "admin": {"enabled": False, "endpoint": None},
        "account": {"enabled": False, "endpoint": None},
        "sts": {"enabled": False, "endpoint": None},
        "usage": {"enabled": False, "endpoint": None},
        "metrics": {"enabled": False, "endpoint": None},
        "static_website": {"enabled": False, "endpoint": None},
        "iam": {"enabled": False, "endpoint": None},
        "sns": {"enabled": False, "endpoint": None},
        "sse": {"enabled": False, "endpoint": None},
    },
    StorageProvider.OTHER: {
        "admin": {"enabled": False, "endpoint": None},
        "account": {"enabled": False, "endpoint": None},
        "sts": {"enabled": False, "endpoint": None},
        "usage": {"enabled": False, "endpoint": None},
        "metrics": {"enabled": False, "endpoint": None},
        "static_website": {"enabled": False, "endpoint": None},
        "iam": {"enabled": False, "endpoint": None},
        "sns": {"enabled": False, "endpoint": None},
        "sse": {"enabled": False, "endpoint": None},
    },
}


@dataclass(frozen=True)
class EndpointFeatureFlags:
    admin_enabled: bool
    admin_endpoint: Optional[str]
    account_enabled: bool
    sts_enabled: bool
    sts_endpoint: Optional[str]
    usage_enabled: bool
    metrics_enabled: bool
    static_website_enabled: bool
    iam_enabled: bool
    sns_enabled: bool
    sse_enabled: bool


def _normalize_url(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    normalized = value.strip().rstrip("/")
    return normalized or None


def parse_features_config(raw: Optional[str]) -> dict[str, Any]:
    if not raw or not raw.strip():
        return {}
    try:
        data = yaml.safe_load(raw)
    except yaml.YAMLError as exc:
        raise ValueError("Invalid endpoint features YAML.") from exc
    if data is None:
        return {}
    if not isinstance(data, dict):
        raise ValueError("Endpoint features YAML must be a mapping.")
    features = data.get("features", data)
    if features is None:
        return {}
    if not isinstance(features, dict):
        raise ValueError("Endpoint features must be a mapping.")
    return features


def normalize_features_config(
    provider: Optional[object],
    raw: Optional[str],
) -> dict[str, dict[str, Any]]:
    normalized_provider = normalize_storage_provider(provider)
    base = DEFAULT_FEATURES.get(normalized_provider, DEFAULT_FEATURES[StorageProvider.CEPH])
    features: dict[str, dict[str, Any]] = {key: dict(value) for key, value in base.items()}
    raw_features = parse_features_config(raw)
    for key, value in raw_features.items():
        if key not in features:
            continue
        if value is None:
            continue
        if not isinstance(value, dict):
            raise ValueError(f"Feature '{key}' must be a mapping.")
        if "enabled" in value:
            enabled = value.get("enabled")
            if not isinstance(enabled, bool):
                raise ValueError(f"Feature '{key}.enabled' must be a boolean.")
            features[key]["enabled"] = enabled
        if "endpoint" in value:
            endpoint = value.get("endpoint")
            if endpoint is not None and not isinstance(endpoint, str):
                raise ValueError(f"Feature '{key}.endpoint' must be a string.")
            features[key]["endpoint"] = _normalize_url(endpoint)

    if normalized_provider == StorageProvider.CEPH and "account" not in raw_features:
        # Backward compatibility for endpoints saved before the "account" feature existed.
        features["account"]["enabled"] = bool(features.get("admin", {}).get("enabled"))

    if normalized_provider != StorageProvider.CEPH:
        for key in ("admin", "account", "usage", "metrics", "sns"):
            if features[key]["enabled"]:
                raise ValueError(
                    f"Feature '{key}' is only available for Ceph endpoints."
                )

    return features


def dump_features_config(features: dict[str, dict[str, Any]]) -> str:
    payload: dict[str, dict[str, dict[str, Any]]] = {"features": {}}
    for key in FEATURE_KEYS:
        entry: dict[str, Any] = {"enabled": bool(features.get(key, {}).get("enabled"))}
        endpoint = features.get(key, {}).get("endpoint")
        if key in {"admin", "sts"} and endpoint:
            entry["endpoint"] = endpoint
        payload["features"][key] = entry
    dumped = yaml.safe_dump(payload, sort_keys=False, default_flow_style=False)
    return dumped.strip()


def resolve_feature_flags(endpoint: StorageEndpoint) -> EndpointFeatureFlags:
    features = normalize_features_config(endpoint.provider, endpoint.features_config)
    return EndpointFeatureFlags(
        admin_enabled=bool(features["admin"]["enabled"]),
        admin_endpoint=features["admin"].get("endpoint"),
        account_enabled=bool(features.get("account", {}).get("enabled")),
        sts_enabled=bool(features["sts"]["enabled"]),
        sts_endpoint=features["sts"].get("endpoint"),
        usage_enabled=bool(features["usage"]["enabled"]),
        metrics_enabled=bool(features["metrics"]["enabled"]),
        static_website_enabled=bool(features["static_website"]["enabled"]),
        iam_enabled=bool(features.get("iam", {}).get("enabled")),
        sns_enabled=bool(features.get("sns", {}).get("enabled")),
        sse_enabled=bool(features.get("sse", {}).get("enabled")),
    )


def resolve_admin_endpoint(endpoint: StorageEndpoint) -> Optional[str]:
    flags = resolve_feature_flags(endpoint)
    if not flags.admin_enabled:
        return None
    return resolve_rgw_admin_api_endpoint(endpoint)


def resolve_rgw_admin_api_endpoint(endpoint: StorageEndpoint) -> Optional[str]:
    flags = resolve_feature_flags(endpoint)
    return flags.admin_endpoint or _normalize_url(endpoint.endpoint_url)


def resolve_sts_endpoint(endpoint: StorageEndpoint) -> Optional[str]:
    flags = resolve_feature_flags(endpoint)
    if not flags.sts_enabled:
        return None
    return flags.sts_endpoint or _normalize_url(endpoint.endpoint_url)


def features_to_capabilities(features: dict[str, dict[str, Any]]) -> dict[str, bool]:
    return {
        "admin": bool(features.get("admin", {}).get("enabled")),
        "account": bool(features.get("account", {}).get("enabled")),
        "sts": bool(features.get("sts", {}).get("enabled")),
        "usage": bool(features.get("usage", {}).get("enabled")),
        "metrics": bool(features.get("metrics", {}).get("enabled")),
        "static_website": bool(features.get("static_website", {}).get("enabled")),
        "iam": bool(features.get("iam", {}).get("enabled")),
        "sns": bool(features.get("sns", {}).get("enabled")),
        "sse": bool(features.get("sse", {}).get("enabled")),
    }
