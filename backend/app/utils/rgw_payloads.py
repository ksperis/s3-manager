# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Any

from app.utils.normalize import normalize_optional_string


def extract_bucket_list(payload: Any) -> list[dict]:
    def normalize(entries: list[Any]) -> list[dict]:
        normalized: list[dict] = []
        for entry in entries:
            if isinstance(entry, dict):
                normalized.append(entry)
            elif isinstance(entry, str):
                normalized.append({"name": entry})
        return normalized

    if isinstance(payload, list):
        return normalize(payload)
    if isinstance(payload, dict):
        buckets = payload.get("buckets")
        if isinstance(buckets, list):
            return normalize(buckets)
    return []


def extract_rgw_user_payload(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        return {}
    user_payload = raw.get("user")
    if isinstance(user_payload, dict):
        return user_payload
    return raw


def extract_rgw_user_identity(payload: Any) -> tuple[str | None, str | None]:
    if not isinstance(payload, dict):
        return None, None
    user_payload = extract_rgw_user_payload(payload)
    raw_uid = normalize_optional_string(user_payload.get("uid") or payload.get("uid"))
    tenant = normalize_optional_string(user_payload.get("tenant") or payload.get("tenant"))
    if raw_uid and "$" in raw_uid:
        embedded_tenant, uid = raw_uid.split("$", 1)
        if embedded_tenant and uid:
            return uid, tenant or embedded_tenant
    return raw_uid, tenant
