# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import json
from typing import Any

from fastapi import HTTPException, status
from pydantic import ValidationError

from app.db import S3Account
from app.models.ceph_admin import CephAdminBucketFilterQuery, CephAdminBucketFilterRule, CephAdminBucketSummary
from app.services.buckets_service import BucketsService


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


def _format_sse_event(event: str, payload: dict[str, object]) -> str:
    return f"event: {event}\ndata: {json.dumps(payload, separators=(',', ':'))}\n\n"


def _is_advanced_filter_stream_payload(raw_advanced_filter: str | None) -> bool:
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


def _parse_filter(raw: str | None) -> tuple[str | None, CephAdminBucketFilterQuery | None]:
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
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return text, None


def _filter_requires_stats(query: CephAdminBucketFilterQuery | None) -> bool:
    if not query:
        return False
    for rule in query.rules:
        if rule.field in {
            "used_bytes",
            "object_count",
            "quota_max_size_bytes",
            "quota_max_objects",
            "owner_used_bytes",
            "owner_object_count",
            "owner_quota_usage_size_percent",
            "owner_quota_usage_object_percent",
        }:
            return True
    return False


def _match_field_rule(bucket: CephAdminBucketSummary, rule: CephAdminBucketFilterRule) -> bool:
    # Reused logic currently implemented in ceph_admin buckets router.
    from app.routers.ceph_admin import buckets as ceph_buckets

    return ceph_buckets._match_field_rule(bucket, rule)


def _match_feature_rule(bucket: CephAdminBucketSummary, rule: CephAdminBucketFilterRule) -> bool:
    # Reused logic currently implemented in ceph_admin buckets router.
    from app.routers.ceph_admin import buckets as ceph_buckets

    return ceph_buckets._match_feature_rule(bucket, rule)


def _match_feature_param_rules(
    rules: list[CephAdminBucketFilterRule],
    match_mode: str,
    snapshot: dict[str, object],
) -> bool:
    # Reused logic currently implemented in ceph_admin buckets router.
    from app.routers.ceph_admin import buckets as ceph_buckets

    return ceph_buckets._match_feature_param_rules(rules, match_mode, snapshot)


def _load_feature_param_snapshots(
    buckets: list[CephAdminBucketSummary],
    rules: list[CephAdminBucketFilterRule],
    service: BucketsService,
    account: S3Account,
) -> tuple[dict[str, dict[str, object]], set[str]]:
    # Reused logic currently implemented in ceph_admin buckets router.
    from app.routers.ceph_admin import buckets as ceph_buckets

    return ceph_buckets._load_feature_param_snapshots(buckets, rules, service, account)


def _enrich_buckets(
    buckets: list[CephAdminBucketSummary],
    requested: set[str],
    include_tags: bool,
    service: BucketsService,
    account: S3Account,
) -> list[CephAdminBucketSummary]:
    # Reused logic currently implemented in ceph_admin buckets router.
    from app.routers.ceph_admin import buckets as ceph_buckets

    return ceph_buckets._enrich_buckets(buckets, requested, include_tags, service, account)
