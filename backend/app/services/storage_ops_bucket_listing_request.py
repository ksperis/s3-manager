# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from dataclasses import dataclass

from app.models.ceph_admin import CephAdminBucketFilterQuery
from app.services.bucket_listing_enrichment import BUCKET_LISTING_INCLUDES
from app.services.bucket_listing_owner_metadata import (
    OWNER_QUOTA_FIELDS,
    OWNER_USAGE_FIELDS,
    OWNER_USAGE_PERCENT_FIELDS,
)
from app.services.bucket_listing_shared import filter_requires_stats, parse_filter, parse_includes
from app.utils.normalize import normalize_text


@dataclass(frozen=True)
class StorageOpsBucketListingRequest:
    parsed_filter: CephAdminBucketFilterQuery | None
    normalized_search: str
    requested_features: set[str]
    include_tags: bool
    needs_stats: bool
    filter_requires_owner_name: bool
    filter_requires_owner_suspended: bool
    filter_requires_owner_quota: bool
    owner_usage_required: bool
    wants_owner_name: bool
    wants_owner_suspended: bool
    wants_owner_quota: bool
    wants_owner_quota_usage: bool


def _collect_filter_fields(parsed_filter: CephAdminBucketFilterQuery | None) -> set[str]:
    if not parsed_filter or not parsed_filter.rules:
        return set()
    return {rule.field for rule in parsed_filter.rules if rule.field}


def prepare_storage_ops_bucket_listing_request(
    *,
    filter: str | None,
    advanced_filter: str | None,
    include: list[str],
    with_stats: bool,
    sort_by: str,
) -> StorageOpsBucketListingRequest:
    simple_filter: str | None = None
    parsed_filter: CephAdminBucketFilterQuery | None = None
    if advanced_filter:
        simple_filter, parsed_filter = parse_filter(advanced_filter)
    elif filter:
        simple_filter, parsed_filter = parse_filter(filter)

    include_set = parse_includes(include)
    filter_fields = _collect_filter_fields(parsed_filter)
    wants_owner_quota_usage = "owner_quota_usage" in include_set
    rules = parsed_filter.rules if parsed_filter and parsed_filter.rules else []
    required_feature_include = {
        rule.feature
        for rule in rules
        if rule.feature and rule.state is not None
    }
    include_tags = "tags" in include_set or any(
        rule.field == "tag" for rule in rules
    )
    requested_features = (include_set | required_feature_include) & BUCKET_LISTING_INCLUDES
    needs_stats = bool(
        with_stats
        or filter_requires_stats(parsed_filter)
        or sort_by in {"used_bytes", "object_count"}
    )
    owner_usage_required = bool(
        needs_stats
        and (
            bool(filter_fields & (OWNER_USAGE_FIELDS | OWNER_USAGE_PERCENT_FIELDS))
            or wants_owner_quota_usage
        )
    )
    return StorageOpsBucketListingRequest(
        parsed_filter=parsed_filter,
        normalized_search=normalize_text(simple_filter or ""),
        requested_features=requested_features,
        include_tags=include_tags,
        needs_stats=needs_stats,
        filter_requires_owner_name="owner_name" in filter_fields,
        filter_requires_owner_suspended="owner_suspended" in filter_fields,
        filter_requires_owner_quota=bool(
            filter_fields & (OWNER_QUOTA_FIELDS | OWNER_USAGE_PERCENT_FIELDS)
        ),
        owner_usage_required=owner_usage_required,
        wants_owner_name="owner_name" in include_set,
        wants_owner_suspended="owner_suspended" in include_set,
        wants_owner_quota="owner_quota" in include_set,
        wants_owner_quota_usage=wants_owner_quota_usage,
    )
