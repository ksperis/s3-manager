# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from dataclasses import dataclass

from app.models.ceph_admin import CephAdminBucketFilterQuery, CephAdminBucketFilterRule
from app.services.bucket_listing_enrichment import BUCKET_FEATURE_INCLUDES, COLUMN_DETAIL_KEYS
from app.services.bucket_listing_owner_metadata import (
    OWNER_QUOTA_FIELDS,
    OWNER_STATUS_FIELDS,
    OWNER_USAGE_FIELDS,
    OWNER_USAGE_PERCENT_FIELDS,
    filter_requires_owner_usage,
    request_requires_owner_metadata,
    request_requires_tenant_metadata,
)
from app.services.bucket_listing_rule_matching import (
    EXPENSIVE_FIELD_RULES,
    request_requires_bucket_stats,
)
from app.services.bucket_listing_shared import parse_filter, parse_includes, serialize_filter
from app.services.ceph_admin_bucket_listing_cache import CephAdminBucketListCacheKey


@dataclass(frozen=True)
class CephAdminBucketListingRequest:
    simple_filter: str | None
    advanced_filter: CephAdminBucketFilterQuery | None
    sort_by: str
    sort_dir: str
    with_stats: bool
    stats_required: bool
    wants_owner_name: bool
    wants_owner_suspended: bool
    wants_owner_quota: bool
    wants_owner_quota_usage: bool
    owner_usage_required: bool
    needs_owner_metadata: bool
    needs_tenant_metadata: bool
    requested_features: frozenset[str]
    requested_detail_fields: frozenset[str]
    include_tags: bool
    ui_tag_ids: tuple[int, ...]
    ui_tag_match: str

    @classmethod
    def parse(
        cls,
        *,
        raw_filter: str | None,
        raw_advanced_filter: str | None,
        sort_by: str,
        sort_dir: str,
        include: list[str],
        with_stats: bool,
        ui_tag_ids: list[int] | None = None,
        ui_tag_match: str = "any",
        with_ui_tags: bool = False,
    ) -> CephAdminBucketListingRequest:
        if raw_advanced_filter:
            simple_filter = (
                raw_filter.strip()
                if isinstance(raw_filter, str) and raw_filter.strip()
                else None
            )
            _, advanced_filter = parse_filter(raw_advanced_filter)
        else:
            simple_filter, advanced_filter = parse_filter(raw_filter)
        simple_filter = (
            simple_filter.strip()
            if isinstance(simple_filter, str) and simple_filter.strip()
            else None
        )
        stats_required = request_requires_bucket_stats(advanced_filter, sort_by)
        include_set = parse_includes(include)
        wants_owner_name = "owner_name" in include_set
        wants_owner_suspended = "owner_suspended" in include_set
        wants_owner_quota = "owner_quota" in include_set
        wants_owner_quota_usage = "owner_quota_usage" in include_set
        owner_usage_required = wants_owner_quota_usage or filter_requires_owner_usage(advanced_filter)
        return cls(
            simple_filter=simple_filter,
            advanced_filter=advanced_filter,
            sort_by=sort_by,
            sort_dir=sort_dir,
            with_stats=with_stats or stats_required,
            stats_required=stats_required,
            wants_owner_name=wants_owner_name,
            wants_owner_suspended=wants_owner_suspended,
            wants_owner_quota=wants_owner_quota,
            wants_owner_quota_usage=wants_owner_quota_usage,
            owner_usage_required=owner_usage_required,
            needs_owner_metadata=request_requires_owner_metadata(
                advanced_filter,
                sort_by,
                simple_filter if not advanced_filter else None,
            ) or with_ui_tags,
            needs_tenant_metadata=request_requires_tenant_metadata(
                advanced_filter,
                sort_by,
                simple_filter if not advanced_filter else None,
            ) or with_ui_tags,
            requested_features=frozenset(include_set & BUCKET_FEATURE_INCLUDES),
            requested_detail_fields=frozenset(include_set & COLUMN_DETAIL_KEYS),
            include_tags="tags" in include_set,
            ui_tag_ids=tuple(dict.fromkeys(int(item) for item in (ui_tag_ids or []) if int(item) > 0)),
            ui_tag_match="all" if ui_tag_match == "all" else "any",
        )

    def cache_key(self, endpoint_id: int) -> CephAdminBucketListCacheKey:
        return CephAdminBucketListCacheKey(
            endpoint_id=endpoint_id,
            advanced_filter=serialize_filter(self.advanced_filter),
            sort_by=self.sort_by,
            sort_dir=self.sort_dir,
            with_stats=self.with_stats,
            with_owner_metadata=self.needs_owner_metadata,
            with_owner_usage=self.owner_usage_required,
        )


@dataclass(frozen=True)
class CephAdminAdvancedFilterPlan:
    query: CephAdminBucketFilterQuery
    field_rules: list[CephAdminBucketFilterRule]
    feature_state_rules: list[CephAdminBucketFilterRule]
    feature_param_rules: list[CephAdminBucketFilterRule]
    expensive_field_rules: list[CephAdminBucketFilterRule]
    cheap_field_rules: list[CephAdminBucketFilterRule]
    filter_features: set[str]
    requires_tag_lookup: bool
    requires_owner_name_lookup: bool
    requires_owner_suspended_lookup: bool
    requires_owner_quota_lookup: bool
    requires_owner_usage_lookup: bool

    @classmethod
    def from_query(cls, query: CephAdminBucketFilterQuery) -> CephAdminAdvancedFilterPlan:
        field_rules = [rule for rule in query.rules if rule.field]
        feature_state_rules = [rule for rule in query.rules if rule.feature and rule.state is not None]
        feature_param_rules = [rule for rule in query.rules if rule.feature and rule.param is not None]
        expensive_field_rules = [rule for rule in field_rules if rule.field in EXPENSIVE_FIELD_RULES]
        cheap_field_rules = [rule for rule in field_rules if rule.field not in EXPENSIVE_FIELD_RULES]
        return cls(
            query=query,
            field_rules=field_rules,
            feature_state_rules=feature_state_rules,
            feature_param_rules=feature_param_rules,
            expensive_field_rules=expensive_field_rules,
            cheap_field_rules=cheap_field_rules,
            filter_features={rule.feature for rule in feature_state_rules if rule.feature},
            requires_tag_lookup=any(rule.field == "tag" for rule in expensive_field_rules),
            requires_owner_name_lookup=any(rule.field == "owner_name" for rule in expensive_field_rules),
            requires_owner_suspended_lookup=any(
                rule.field in OWNER_STATUS_FIELDS for rule in expensive_field_rules
            ),
            requires_owner_quota_lookup=any(
                rule.field in (OWNER_QUOTA_FIELDS | OWNER_USAGE_PERCENT_FIELDS)
                for rule in expensive_field_rules
            ),
            requires_owner_usage_lookup=any(
                rule.field in (OWNER_USAGE_FIELDS | OWNER_USAGE_PERCENT_FIELDS)
                for rule in expensive_field_rules
            ),
        )

    @property
    def has_expensive_rules(self) -> bool:
        return bool(self.expensive_field_rules or self.feature_state_rules or self.feature_param_rules)
