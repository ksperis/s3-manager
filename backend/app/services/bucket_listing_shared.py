# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import json

from pydantic import ValidationError
from pydantic import BaseModel

from app.models.ceph_admin import CephAdminBucketFilterQuery
from app.core.sensitive_data import sanitize_error_detail


class BucketListingFilterError(ValueError):
    pass


def parse_includes(include: list[str]) -> set[str]:
    include_set: set[str] = set()
    for item in include:
        if not isinstance(item, str):
            continue
        for part in item.split(","):
            normalized = part.strip()
            if normalized:
                include_set.add(normalized)
    return include_set


def serialize_filter(query: BaseModel | None) -> str | None:
    if not query:
        return None
    payload = query.model_dump(mode="json")
    return json.dumps(payload, separators=(",", ":"), sort_keys=True)


def is_advanced_filter_stream_payload(raw_advanced_filter: str | None) -> bool:
    if not isinstance(raw_advanced_filter, str):
        return False
    text = raw_advanced_filter.strip()
    if not text or not text.startswith("{"):
        return False
    try:
        payload = json.loads(text)
    except json.JSONDecodeError:
        return False
    if not isinstance(payload, dict):
        return False
    return "rules" in payload or "match" in payload


def parse_filter(raw: str | None) -> tuple[str | None, CephAdminBucketFilterQuery | None]:
    if raw is None:
        return None, None
    text = raw.strip()
    if not text:
        return None, None
    if text.startswith("{"):
        try:
            parsed = json.loads(text)
        except json.JSONDecodeError:
            return text, None
        if isinstance(parsed, dict) and ("rules" in parsed or "match" in parsed):
            try:
                return None, CephAdminBucketFilterQuery.model_validate(parsed)
            except ValidationError as exc:
                raise BucketListingFilterError(str(sanitize_error_detail(str(exc)))) from exc
    return text, None


def filter_requires_stats(query: CephAdminBucketFilterQuery | None) -> bool:
    if not query:
        return False
    for rule in query.rules:
        if rule.field in {
            "used_bytes",
            "object_count",
            "quota_max_size_bytes",
            "quota_max_objects",
            "quota_usage_size_percent",
            "quota_usage_object_percent",
            "owner_used_bytes",
            "owner_object_count",
            "owner_quota_usage_size_percent",
            "owner_quota_usage_object_percent",
        }:
            return True
    return False
