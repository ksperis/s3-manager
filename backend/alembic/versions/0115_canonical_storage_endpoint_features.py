# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Canonicalize persisted Storage Endpoint feature configuration.

Revision ID: 0115_canonical_storage_endpoint_features
Revises: 0114_scale_bucket_ui_tags
Create Date: 2026-08-23
"""

from typing import Any, Optional

from alembic import op
import sqlalchemy as sa
import yaml


revision = "0115_canonical_storage_endpoint_features"
down_revision = "0114_scale_bucket_ui_tags"
branch_labels = None
depends_on = None


FEATURE_KEYS = (
    "admin",
    "account",
    "sts",
    "usage",
    "metrics",
    "static_website",
    "iam",
    "sns",
    "sse",
    "replication",
    "healthcheck",
)
ENDPOINT_FEATURE_KEYS = {"admin", "iam", "sts"}

storage_endpoints = sa.table(
    "storage_endpoints",
    sa.column("id", sa.Integer()),
    sa.column("features_config", sa.Text()),
)


def _normalize_url(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    normalized = value.strip().rstrip("/")
    return normalized or None


def _load_features(endpoint_id: int, raw: str) -> dict[str, Any]:
    try:
        document = yaml.safe_load(raw)
    except yaml.YAMLError as exc:
        raise ValueError(
            f"Storage Endpoint {endpoint_id} has invalid features YAML."
        ) from exc
    if document is None:
        return {}
    if not isinstance(document, dict):
        raise ValueError(
            f"Storage Endpoint {endpoint_id} features YAML must be a mapping."
        )
    features = document.get("features", document)
    if features is None:
        return {}
    if not isinstance(features, dict):
        raise ValueError(
            f"Storage Endpoint {endpoint_id} features must be a mapping."
        )
    return features


def _optional_string(
    endpoint_id: int,
    feature_key: str,
    field: str,
    value: object,
) -> Optional[str]:
    if value is not None and not isinstance(value, str):
        raise ValueError(
            f"Storage Endpoint {endpoint_id} feature "
            f"'{feature_key}.{field}' must be a string."
        )
    return _normalize_url(value)


def _canonical_feature(
    endpoint_id: int,
    key: str,
    value: object,
) -> Optional[dict[str, Any]]:
    if value is None:
        return None
    if not isinstance(value, dict):
        raise ValueError(
            f"Storage Endpoint {endpoint_id} feature '{key}' must be a mapping."
        )

    canonical: dict[str, Any] = {}
    if "enabled" in value:
        enabled = value["enabled"]
        if not isinstance(enabled, bool):
            raise ValueError(
                f"Storage Endpoint {endpoint_id} feature "
                f"'{key}.enabled' must be a boolean."
            )
        canonical["enabled"] = enabled

    if key in ENDPOINT_FEATURE_KEYS and "endpoint" in value:
        endpoint = _optional_string(
            endpoint_id,
            key,
            "endpoint",
            value["endpoint"],
        )
        if endpoint:
            canonical["endpoint"] = endpoint

    if key == "healthcheck":
        if "mode" in value:
            mode = value["mode"]
            if not isinstance(mode, str) or mode.strip().lower() not in {
                "http",
                "s3",
            }:
                raise ValueError(
                    f"Storage Endpoint {endpoint_id} feature "
                    "'healthcheck.mode' must be 'http' or 's3'."
                )
            canonical["mode"] = mode.strip().lower()
        for candidate in ("healthcheck_url", "url", "endpoint"):
            if candidate not in value:
                continue
            healthcheck_url = _optional_string(
                endpoint_id,
                key,
                candidate,
                value[candidate],
            )
            if healthcheck_url:
                canonical["healthcheck_url"] = healthcheck_url
            break
    return canonical


def _canonical_features_config(endpoint_id: int, raw: str) -> str:
    source = _load_features(endpoint_id, raw)
    features: dict[str, dict[str, Any]] = {}
    for key in FEATURE_KEYS:
        if key not in source:
            continue
        canonical = _canonical_feature(endpoint_id, key, source[key])
        if canonical is not None:
            features[key] = canonical
    return yaml.safe_dump(
        {"features": features},
        sort_keys=False,
        default_flow_style=False,
    ).strip()


def upgrade() -> None:
    bind = op.get_bind()
    rows = bind.execute(
        sa.select(storage_endpoints.c.id, storage_endpoints.c.features_config)
    ).all()
    for row in rows:
        raw = row.features_config
        if not raw or not raw.strip():
            continue
        bind.execute(
            storage_endpoints.update()
            .where(storage_endpoints.c.id == row.id)
            .values(features_config=_canonical_features_config(row.id, raw))
        )


def downgrade() -> None:
    # Canonical YAML remains valid for older releases; discarded inert keys and
    # aliases cannot be reconstructed.
    pass
