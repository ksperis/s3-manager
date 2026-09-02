# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from app.models.bucket_filter import BucketFilterQuery, BucketFilterRule
from app.models.ceph_admin import CephAdminBucketSummary
from app.services.bucket_listing_owner_metadata import (
    OWNER_DETAIL_FIELDS,
    normalize_owner_kind,
    normalize_owner_kind_scalar,
)
from app.services.bucket_listing_shared import (
    coerce_filter_bool,
    coerce_filter_number,
    filter_requires_stats,
)
from app.services.listing_rule_matching import (
    match_boolean_rule,
    match_numeric_rule,
    match_text_rule,
)
from app.services.rgw_bucket_metadata import owner_kind_from_owner
from app.utils.usage_stats import compute_usage_ratio_percent

EXPENSIVE_FIELD_RULES = {"tag"} | OWNER_DETAIL_FIELDS


def extract_name_candidates(query: BucketFilterQuery | None) -> list[str] | None:
    if not query:
        return None
    candidates: set[str] | None = None
    saw_name_rule = False
    for rule in query.rules:
        if rule.field != "name":
            continue
        saw_name_rule = True
        names: set[str] = set()
        if rule.op == "in" and isinstance(rule.value, list):
            for item in rule.value:
                value = str(item or "").strip()
                if value:
                    names.add(value)
        elif rule.op == "eq" and rule.value is not None:
            value = str(rule.value).strip()
            if value:
                names.add(value)
        if candidates is None:
            candidates = names
        elif query.match == "all":
            candidates = candidates & names
        else:
            candidates = candidates | names
    if not saw_name_rule:
        return None
    if not candidates:
        return []
    return sorted(candidates)


def _match_tag_expression(tag_key: str, tag_value: str, expression: str, op: str) -> bool:
    expr = expression.strip().lower()
    if not expr:
        return False
    key = tag_key.strip().lower()
    value = tag_value.strip().lower()
    sep = "=" if "=" in expr else (":" if ":" in expr else None)
    if sep:
        expr_key, expr_value = expr.split(sep, 1)
        expr_key = expr_key.strip()
        expr_value = expr_value.strip()
        if op == "contains":
            return (expr_key in key) and (expr_value in value)
        if op == "starts_with":
            return key.startswith(expr_key) and value.startswith(expr_value)
        if op == "ends_with":
            return key.endswith(expr_key) and value.endswith(expr_value)
        return key == expr_key and value == expr_value

    if op == "contains":
        return expr in key or expr in value
    if op == "starts_with":
        return key.startswith(expr) or value.startswith(expr)
    if op == "ends_with":
        return key.endswith(expr) or value.endswith(expr)
    return key == expr or value == expr


def _match_tag_rule(bucket: CephAdminBucketSummary, rule: BucketFilterRule) -> bool:
    tags = bucket.tags or []
    if not tags:
        return False
    op = rule.op or "contains"
    allowed_ops = {"eq", "neq", "contains", "starts_with", "ends_with", "in", "not_in"}
    if op not in allowed_ops:
        return False
    if op in {"in", "not_in"}:
        if not isinstance(rule.value, list):
            return False
        expressions = [str(item or "").strip() for item in rule.value]
        expressions = [expr for expr in expressions if expr]
        if not expressions:
            return False
        matched = any(
            _match_tag_expression(tag.key, tag.value, expr, "eq")
            for tag in tags
            for expr in expressions
        )
        return matched if op == "in" else not matched

    expression = str(rule.value or "").strip()
    if not expression:
        return False
    matched = any(_match_tag_expression(tag.key, tag.value, expression, op) for tag in tags)
    if op == "neq":
        return not matched
    return matched


def match_bucket_field_rule(bucket: CephAdminBucketSummary, rule: BucketFilterRule) -> bool:
    field = rule.field
    op = rule.op
    if not field or not op:
        return False
    if field == "tag":
        return _match_tag_rule(bucket, rule)
    if field == "owner_kind":
        value = owner_kind_from_owner(bucket.owner)
    elif field == "quota_usage_size_percent":
        value = compute_usage_ratio_percent(bucket.used_bytes, bucket.quota_max_size_bytes)
    elif field == "quota_usage_object_percent":
        value = compute_usage_ratio_percent(bucket.object_count, bucket.quota_max_objects)
    elif field == "owner_quota_usage_size_percent":
        value = compute_usage_ratio_percent(bucket.owner_used_bytes, bucket.owner_quota_max_size_bytes)
    elif field == "owner_quota_usage_object_percent":
        value = compute_usage_ratio_percent(bucket.owner_object_count, bucket.owner_quota_max_objects)
    else:
        value = getattr(bucket, field, None)
    if op == "is_null":
        return value is None
    if op == "not_null":
        return value is not None
    if field == "owner_suspended":
        return match_boolean_rule(
            value,
            op,
            rule.value,
            coerce=coerce_filter_bool,
            default_if_none=False,
        )
    if value is None:
        return False

    string_fields = {
        "name",
        "tenant",
        "owner",
        "owner_name",
        "owner_kind",
        "context_id",
        "context_name",
        "context_kind",
        "endpoint_name",
        "bucket_identity",
    }
    if field in string_fields:
        if field == "owner_kind":
            return match_text_rule(
                value,
                op,
                rule.value,
                scalar_normalizer=normalize_owner_kind_scalar,
                candidate_normalizer=normalize_owner_kind,
                require_candidates=True,
            )
        return match_text_rule(value, op, rule.value)

    return match_numeric_rule(
        value,
        op,
        rule.value,
        coerce=coerce_filter_number,
    )


def match_bucket_feature_rule(bucket: CephAdminBucketSummary, rule: BucketFilterRule) -> bool:
    feature = rule.feature
    desired = (rule.state or "").strip().lower()
    if not feature or not desired:
        return False
    status = (bucket.features or {}).get(feature)
    if status is None:
        return desired in {"unknown", "unavailable"}
    state_norm = status.state.strip().lower().replace(" ", "_")
    if desired in {"enabled", "active"}:
        if status.tone == "active":
            return True
        if state_norm == "suspended":
            return False
        return False
    if desired in {"disabled", "inactive"}:
        if feature == "versioning":
            # Keep disabled distinct from suspended for versioning filters.
            return state_norm == "disabled" or (status.tone == "inactive" and state_norm != "suspended")
        if status.tone == "inactive":
            return True
        if state_norm == "suspended":
            return True
        return False
    if desired == "disabled_or_suspended":
        if feature == "versioning":
            return state_norm in {"disabled", "suspended"} or status.tone == "inactive"
        return status.tone == "inactive" or state_norm == "suspended"
    if desired == "unknown":
        return status.tone == "unknown"
    if desired == "partial":
        return state_norm == "partial"
    if desired == "suspended":
        return state_norm == "suspended"
    if desired == "configured":
        return state_norm == "configured"
    if desired == "not_set":
        return state_norm == "not_set"
    if desired == "unavailable":
        return state_norm == "unavailable"
    return False


def request_requires_bucket_stats(query: BucketFilterQuery | None, sort_by: str) -> bool:
    return sort_by in {"used_bytes", "object_count"} or filter_requires_stats(query)
