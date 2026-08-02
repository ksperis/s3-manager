# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, Callable, Literal

from app.db import S3Account
from app.models.bucket import (
    BucketEncryptionConfiguration,
    BucketFeatureStatus,
    BucketLoggingConfiguration,
    BucketProperties,
    BucketTag,
    BucketWebsiteConfiguration,
)
from app.models.ceph_admin import (
    CephAdminBucketFilterQuery,
    CephAdminBucketFilterRule,
    CephAdminBucketSummary,
)
from app.routers.ceph_admin.dependencies import CephAdminContext
from app.routers.ceph_admin.listing_common import (
    ListingProgressEmitter as _BucketListingProgressEmitter,
    interpolate_progress_percent as _common_interpolate_progress_percent,
    invoke_cancel_check as _invoke_cancel_check,
    normalize_optional_str as _common_normalize_optional_str,
    normalize_text as _common_normalize_text,
)
from app.services.bucket_listing_shared import _filter_requires_stats as _shared_filter_requires_stats
from app.services.bucket_notification_state import (
    account_sns_feature_enabled,
    is_bucket_notification_configuration_configured,
)
from app.services.bucket_owner_enrichment import BucketOwnerMetadataService, BucketOwnerUsage
from app.services.buckets_service import BucketsService
from app.services.rgw_admin import RGWAdminError
from app.utils.rgw import is_rgw_account_id
from app.utils.storage_endpoint_features import resolve_feature_flags
from app.utils.usage_stats import compute_usage_ratio_percent, extract_usage_stats

BUCKET_ENRICH_MAX_WORKERS = 6
BUCKET_OWNER_LOOKUP_MAX_WORKERS = 6

_FEATURE_PARAM_UNAVAILABLE = object()
_FEATURE_PARAM_SOURCE_BY_PARAM: dict[str, str] = {
    "lifecycle_rule_id": "lifecycle",
    "lifecycle_rule_status": "lifecycle",
    "lifecycle_rule_type": "lifecycle",
    "lifecycle_expiration_days": "lifecycle",
    "lifecycle_noncurrent_expiration_days": "lifecycle",
    "lifecycle_transition_days": "lifecycle",
    "lifecycle_abort_multipart_present": "lifecycle",
    "lifecycle_abort_multipart_days": "lifecycle",
    "object_lock_mode": "props",
    "object_lock_retention_days": "props",
    "object_lock_retention_years": "props",
    "bpa_block_public_acls": "props",
    "bpa_ignore_public_acls": "props",
    "bpa_block_public_policy": "props",
    "bpa_restrict_public_buckets": "props",
    "cors_allowed_method": "props",
    "cors_allowed_origin": "props",
    "logging_enabled": "logging",
    "logging_target_bucket": "logging",
    "logging_target_prefix": "logging",
    "website_index_present": "website",
    "website_index_document": "website",
    "website_error_document": "website",
    "website_redirect_host_present": "website",
    "website_redirect_host": "website",
    "website_routing_rule_count": "website",
    "policy_statement_count": "policy",
    "policy_has_conditions": "policy",
    "notification_rule_id": "notifications",
    "notification_rule_type": "notifications",
    "notification_topic_name": "notifications",
    "notification_event": "notifications",
    "notification_filter_prefix": "notifications",
    "notification_filter_suffix": "notifications",
    "notification_eventbridge_present": "notifications",
    "sse_algorithm": "encryption",
    "sse_kms_key_id": "encryption",
}
_COLUMN_DETAIL_LIFECYCLE_KEYS = {
    "lifecycle_expiration_days",
    "lifecycle_noncurrent_expiration_days",
    "lifecycle_transition_days",
    "lifecycle_abort_multipart_days",
}
_COLUMN_DETAIL_OBJECT_LOCK_KEYS = {
    "object_lock_mode",
    "object_lock_retention_days",
    "object_lock_retention_years",
}
_COLUMN_DETAIL_BPA_KEYS = {
    "bpa_block_public_acls",
    "bpa_ignore_public_acls",
    "bpa_block_public_policy",
    "bpa_restrict_public_buckets",
}
_COLUMN_DETAIL_CORS_KEYS = {"cors_allowed_methods", "cors_allowed_origins"}
_COLUMN_DETAIL_LOGGING_KEYS = {"logging_target_bucket", "logging_target_prefix"}
_COLUMN_DETAIL_WEBSITE_KEYS = {
    "website_index_document",
    "website_error_document",
    "website_redirect_host",
    "website_routing_rule_count",
}
_COLUMN_DETAIL_POLICY_KEYS = {"policy_statement_count", "policy_has_conditions"}
_COLUMN_DETAIL_NOTIFICATION_KEYS = {"notification_topic_names"}
_COLUMN_DETAIL_SSE_KEYS = {"sse_algorithms", "sse_kms_key_ids"}
_COLUMN_DETAIL_PROPS_KEYS = _COLUMN_DETAIL_OBJECT_LOCK_KEYS | _COLUMN_DETAIL_BPA_KEYS | _COLUMN_DETAIL_CORS_KEYS
_COLUMN_DETAIL_KEYS = (
    _COLUMN_DETAIL_LIFECYCLE_KEYS
    | _COLUMN_DETAIL_OBJECT_LOCK_KEYS
    | _COLUMN_DETAIL_BPA_KEYS
    | _COLUMN_DETAIL_CORS_KEYS
    | _COLUMN_DETAIL_LOGGING_KEYS
    | _COLUMN_DETAIL_WEBSITE_KEYS
    | _COLUMN_DETAIL_POLICY_KEYS
    | _COLUMN_DETAIL_NOTIFICATION_KEYS
    | _COLUMN_DETAIL_SSE_KEYS
)
_NOTIFICATION_CONFIGURATION_SPECS = (
    ("topic", "TopicConfigurations", "TopicArn"),
    ("queue", "QueueConfigurations", "QueueArn"),
    ("lambda", "LambdaFunctionConfigurations", "LambdaFunctionArn"),
)
_OWNER_QUOTA_FIELDS = {"owner_quota_max_size_bytes", "owner_quota_max_objects"}
_OWNER_STATUS_FIELDS = {"owner_suspended"}
_OWNER_USAGE_FIELDS = {"owner_used_bytes", "owner_object_count"}
_OWNER_USAGE_PERCENT_FIELDS = {"owner_quota_usage_size_percent", "owner_quota_usage_object_percent"}
_OWNER_ENRICHED_FIELDS = _OWNER_STATUS_FIELDS | _OWNER_QUOTA_FIELDS | _OWNER_USAGE_FIELDS | _OWNER_USAGE_PERCENT_FIELDS
_EXPENSIVE_FIELD_RULES = {"owner_name", "tag"} | _OWNER_ENRICHED_FIELDS


def _split_tenant_uid(value: str) -> tuple[str | None, str]:
    if "$" in value:
        tenant, uid = value.split("$", 1)
        return (tenant.strip() or None), uid.strip()
    return None, value.strip()


def _normalize_optional_str(value: object) -> str | None:
    return _common_normalize_optional_str(value)


def _owner_kind_from_owner(owner_id: str | None) -> Literal["account", "user"] | None:
    if not owner_id:
        return None
    return "account" if is_rgw_account_id(owner_id) else "user"


def _normalize_owner_kind(raw: object) -> Literal["account", "user"] | None:
    if not isinstance(raw, str):
        return None
    value = raw.strip().lower().replace("-", "_")
    if value in {"account", "accounts", "acct"}:
        return "account"
    if value in {"user", "users"}:
        return "user"
    return None


def _determine_owner_name_lookup_scope(query: CephAdminBucketFilterQuery | None) -> Literal["any", "account", "user"]:
    if not query or query.match != "all":
        return "any"
    allowed: set[Literal["account", "user"]] = {"account", "user"}
    saw_owner_kind_rule = False
    for rule in query.rules:
        if rule.field != "owner_kind":
            continue
        saw_owner_kind_rule = True
        if rule.op == "eq":
            value = _normalize_owner_kind(rule.value)
            if value:
                allowed &= {value}
        elif rule.op == "neq":
            value = _normalize_owner_kind(rule.value)
            if value:
                allowed.discard(value)
        elif rule.op == "in" and isinstance(rule.value, list):
            values = {_normalize_owner_kind(item) for item in rule.value}
            values = {item for item in values if item is not None}
            if values:
                allowed &= values
        elif rule.op == "not_in" and isinstance(rule.value, list):
            values = {_normalize_owner_kind(item) for item in rule.value}
            values = {item for item in values if item is not None}
            if values:
                allowed -= values
    if not saw_owner_kind_rule:
        return "any"
    if len(allowed) == 1:
        return next(iter(allowed))
    return "any"


def _extract_bucket_owner_scope(entry: dict) -> tuple[str | None, str | None]:
    if not isinstance(entry, dict):
        return None, None
    tenant = _normalize_optional_str(entry.get("tenant"))
    owner = _normalize_optional_str(entry.get("owner"))
    if owner and "$" in owner:
        split_tenant, split_uid = _split_tenant_uid(owner)
        if split_tenant:
            tenant = split_tenant
        owner = split_uid or None
    return tenant, owner


def _resolve_bucket_owner_identity(entry: dict) -> tuple[str | None, str | None]:
    tenant, owner = _extract_bucket_owner_scope(entry)
    if not owner:
        return None, None
    if is_rgw_account_id(owner):
        return owner, None
    if tenant:
        return None, f"{tenant}${owner}"
    return None, owner


def _build_bucket_summary(entry: dict) -> CephAdminBucketSummary | None:
    if not isinstance(entry, dict):
        return None
    bucket_name = _extract_bucket_name(entry)
    if not bucket_name:
        return None
    tenant = _normalize_optional_str(entry.get("tenant"))
    owner = _normalize_optional_str(entry.get("owner"))
    usage_bytes, objects = extract_usage_stats(entry.get("usage"))
    quota_size = None
    quota_objects = None
    quota = entry.get("bucket_quota") or entry.get("quota")
    if isinstance(quota, dict):
        try:
            # RGW may return both max_size (bytes) and max_size_kb (KiB).
            # max_size has priority and must not be scaled again.
            if quota.get("max_size") is not None:
                quota_size = int(quota.get("max_size"))
            elif quota.get("max_size_kb") is not None:
                quota_size = int(quota.get("max_size_kb")) * 1024
        except (TypeError, ValueError):
            quota_size = None
        try:
            if quota.get("max_objects") is not None:
                quota_objects = int(quota.get("max_objects"))
        except (TypeError, ValueError):
            quota_objects = None
    return CephAdminBucketSummary(
        name=bucket_name,
        tenant=tenant,
        owner=owner,
        used_bytes=usage_bytes,
        object_count=objects,
        quota_max_size_bytes=quota_size,
        quota_max_objects=quota_objects,
    )


def _extract_bucket_name(entry: dict) -> str | None:
    if not isinstance(entry, dict):
        return None
    name = entry.get("name")
    if not name and isinstance(entry.get("bucket"), str):
        name = entry.get("bucket")
    bucket_name = str(name or "").strip()
    return bucket_name or None


def _extract_name_candidates(query: CephAdminBucketFilterQuery | None) -> list[str] | None:
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


def _resolve_owner_name(
    ctx: CephAdminContext,
    owner_id: str | None,
    tenant: str | None,
    cache: dict[str, str | None],
    owner_scope: Literal["any", "account", "user"] = "any",
) -> str | None:
    if not owner_id:
        return None
    owner_key = f"{tenant or ''}:{owner_id}"
    if owner_key in cache:
        return cache[owner_key]

    owner_kind = _owner_kind_from_owner(owner_id)
    if owner_scope != "any" and owner_kind != owner_scope:
        cache[owner_key] = None
        return None

    name: str | None = None
    account_lookup_enabled: bool | None
    try:
        account_lookup_enabled = resolve_feature_flags(ctx.endpoint).account_enabled
    except Exception:
        account_lookup_enabled = None

    if owner_scope in {"any", "account"} and account_lookup_enabled is not False:
        try:
            account_payload = ctx.rgw_admin.get_account(
                owner_id,
                allow_not_found=True,
                allow_not_implemented=True,
            )
        except RGWAdminError:
            account_payload = None
        if isinstance(account_payload, dict) and not account_payload.get("not_found"):
            # Strict account owner-name resolution: only RGW account "name" is accepted.
            name = _normalize_optional_str(account_payload.get("name"))
            cache[owner_key] = name
            return name

    if owner_scope == "account":
        cache[owner_key] = None
        return None

    tenant_hint = tenant
    uid = owner_id
    split_tenant, split_uid = _split_tenant_uid(owner_id)
    if split_tenant:
        tenant_hint = split_tenant
        uid = split_uid
    try:
        user_payload = ctx.rgw_admin.get_user(uid, tenant=tenant_hint, allow_not_found=True)
    except RGWAdminError:
        user_payload = None
    if isinstance(user_payload, dict) and not user_payload.get("not_found"):
        # Strict user owner-name resolution: only RGW "display_name" is accepted.
        name = _normalize_optional_str(user_payload.get("display_name"))
    cache[owner_key] = name
    return name


def _resolve_owner_names_for_buckets(
    ctx: CephAdminContext,
    buckets: list[CephAdminBucketSummary],
    owner_scope: Literal["any", "account", "user"] = "any",
) -> dict[str, str | None]:
    owner_targets: dict[str, tuple[str | None, str]] = {}
    for bucket in buckets:
        if not bucket.owner:
            continue
        if owner_scope != "any":
            bucket_owner_kind = _owner_kind_from_owner(bucket.owner)
            if bucket_owner_kind != owner_scope:
                continue
        owner_key = f"{bucket.tenant or ''}:{bucket.owner}"
        if owner_key not in owner_targets:
            owner_targets[owner_key] = (bucket.tenant, bucket.owner)

    if not owner_targets:
        return {}

    if len(owner_targets) <= 1:
        owner_key, (tenant, owner) = next(iter(owner_targets.items()))
        return {owner_key: _resolve_owner_name(ctx, owner, tenant, {}, owner_scope=owner_scope)}

    max_workers = min(BUCKET_OWNER_LOOKUP_MAX_WORKERS, len(owner_targets))

    def resolve_owner_target(item: tuple[str, tuple[str | None, str]]) -> tuple[str, str | None]:
        key, (tenant, owner) = item
        return key, _resolve_owner_name(ctx, owner, tenant, {}, owner_scope=owner_scope)

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        return dict(executor.map(resolve_owner_target, owner_targets.items()))


def _normalize_text(value: str) -> str:
    return _common_normalize_text(value)


def _coerce_number(value: object) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value.strip())
        except ValueError:
            return None
    return None


def _apply_owner_enrichment(
    ctx: CephAdminContext,
    buckets: list[CephAdminBucketSummary],
    *,
    include_suspended: bool = False,
    include_quota: bool = False,
    include_usage: bool = False,
    usage_by_key: dict[str, BucketOwnerUsage] | None = None,
) -> list[CephAdminBucketSummary]:
    if not buckets or (not include_suspended and not include_quota and not include_usage):
        return buckets
    service = BucketOwnerMetadataService(
        endpoint_id=int(getattr(ctx.endpoint, "id", 0) or 0),
        endpoint=ctx.endpoint,
        rgw_admin=ctx.rgw_admin,
    )
    kwargs: dict[str, Any] = {
        "include_quota": include_quota,
        "include_usage": include_usage,
        "usage_by_key": usage_by_key,
    }
    if include_suspended:
        kwargs["include_suspended"] = True
    return service.enrich_buckets(buckets, **kwargs)


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


def _match_tag_rule(bucket: CephAdminBucketSummary, rule: CephAdminBucketFilterRule) -> bool:
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


def _match_field_rule(bucket: CephAdminBucketSummary, rule: CephAdminBucketFilterRule) -> bool:
    field = rule.field
    op = rule.op
    if not field or not op:
        return False
    if field == "tag":
        return _match_tag_rule(bucket, rule)
    if field == "owner_kind":
        value = _owner_kind_from_owner(bucket.owner)
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
        left_bool = _coerce_bool(value)
        if left_bool is None:
            left_bool = False
        if op in ("eq", "neq"):
            right_bool = _coerce_bool(rule.value)
            if right_bool is None:
                return False
            return left_bool == right_bool if op == "eq" else left_bool != right_bool
        if op in ("in", "not_in"):
            if not isinstance(rule.value, list):
                return False
            candidates = {_coerce_bool(item) for item in rule.value}
            candidates = {item for item in candidates if item is not None}
            result = left_bool in candidates
            return result if op == "in" else not result
        return False
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
        left = _normalize_text(str(value))
        if field == "owner_kind":
            normalized_kind = _normalize_owner_kind(rule.value)
            right = normalized_kind if normalized_kind else _normalize_text(str(rule.value or ""))
            if not right:
                return False
        else:
            right = _normalize_text(str(rule.value or ""))
        if op == "contains":
            return right in left
        if op == "starts_with":
            return left.startswith(right)
        if op == "ends_with":
            return left.endswith(right)
        if op == "eq":
            return left == right
        if op == "neq":
            return left != right
        if op in ("in", "not_in"):
            if not isinstance(rule.value, list):
                return False
            if field == "owner_kind":
                candidates = {_normalize_owner_kind(item) for item in rule.value}
                candidates = {item for item in candidates if item is not None}
                if not candidates:
                    return False
            else:
                candidates = {_normalize_text(str(item)) for item in rule.value}
            result = left in candidates
            return result if op == "in" else not result
        return False

    left_num = _coerce_number(value)
    if left_num is None:
        return False
    if op in ("eq", "neq", "gt", "gte", "lt", "lte"):
        right_num = _coerce_number(rule.value)
        if right_num is None:
            return False
        if op == "eq":
            return left_num == right_num
        if op == "neq":
            return left_num != right_num
        if op == "gt":
            return left_num > right_num
        if op == "gte":
            return left_num >= right_num
        if op == "lt":
            return left_num < right_num
        if op == "lte":
            return left_num <= right_num
    if op in ("in", "not_in"):
        if not isinstance(rule.value, list):
            return False
        candidates = {_coerce_number(item) for item in rule.value}
        candidates = {item for item in candidates if item is not None}
        result = left_num in candidates
        return result if op == "in" else not result
    return False


def _match_feature_rule(bucket: CephAdminBucketSummary, rule: CephAdminBucketFilterRule) -> bool:
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


def _bucket_identity_key(bucket: CephAdminBucketSummary) -> str:
    return f"{bucket.tenant or ''}:{bucket.name}"


def _coerce_bool(value: object) -> bool | None:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"true", "1", "yes", "on"}:
            return True
        if normalized in {"false", "0", "no", "off"}:
            return False
    if isinstance(value, (int, float)) and value in {0, 1}:
        return bool(value)
    return None


def _match_text_value(left: str | None, op: str, right_raw: object) -> bool:
    if left is None:
        return False
    right = _normalize_text(str(right_raw or ""))
    if not right:
        return False
    left_norm = _normalize_text(left)
    if op == "eq":
        return left_norm == right
    if op == "neq":
        return left_norm != right
    if op == "contains":
        return right in left_norm
    if op == "starts_with":
        return left_norm.startswith(right)
    if op == "ends_with":
        return left_norm.endswith(right)
    return False


def _match_numeric_value(left: float | None, op: str, right_raw: object) -> bool:
    if left is None:
        return False
    right = _coerce_number(right_raw)
    if right is None:
        return False
    if op == "eq":
        return left == right
    if op == "neq":
        return left != right
    if op == "gt":
        return left > right
    if op == "gte":
        return left >= right
    if op == "lt":
        return left < right
    if op == "lte":
        return left <= right
    return False


def _match_bool_value(left: bool | None, op: str, right_raw: object) -> bool:
    if left is None:
        return False
    right = _coerce_bool(right_raw)
    if right is None:
        return False
    if op == "eq":
        return left is right
    if op == "neq":
        return left is not right
    return False


def _extract_lifecycle_rule_id(rule_entry: dict) -> str | None:
    raw = rule_entry.get("ID")
    if raw is None:
        raw = rule_entry.get("Id")
    if raw is None:
        raw = rule_entry.get("id")
    if raw is None:
        return None
    value = str(raw).strip()
    return value or None


def _extract_lifecycle_rule_status(rule_entry: dict) -> str | None:
    raw = rule_entry.get("Status")
    if raw is None:
        raw = rule_entry.get("status")
    if raw is None:
        return None
    value = str(raw).strip()
    return value or None


def _extract_lifecycle_abort_days(rule_entry: dict) -> float | None:
    raw = rule_entry.get("AbortIncompleteMultipartUpload")
    if not isinstance(raw, dict):
        return None
    return _coerce_number(raw.get("DaysAfterInitiation"))


def _extract_lifecycle_expiration_days(rule_entry: dict) -> float | None:
    expiration = rule_entry.get("Expiration")
    if not isinstance(expiration, dict):
        return None
    return _coerce_number(expiration.get("Days"))


def _extract_lifecycle_noncurrent_expiration_days(rule_entry: dict) -> float | None:
    noncurrent_expiration = rule_entry.get("NoncurrentVersionExpiration")
    if not isinstance(noncurrent_expiration, dict):
        return None
    return _coerce_number(noncurrent_expiration.get("NoncurrentDays"))


def _extract_lifecycle_transition_days(rule_entry: dict) -> list[float]:
    values: list[float] = []
    transitions = rule_entry.get("Transitions")
    if isinstance(transitions, list):
        candidates = transitions
    elif isinstance(rule_entry.get("Transition"), dict):
        candidates = [rule_entry.get("Transition")]
    else:
        candidates = []
    for item in candidates:
        if not isinstance(item, dict):
            continue
        days = _coerce_number(item.get("Days"))
        if days is not None:
            values.append(days)
    return values


def _dedupe_sorted_day_values(values: list[float]) -> list[int]:
    normalized: list[int] = []
    seen: set[int] = set()
    for raw in values:
        if raw is None:
            continue
        value = int(raw)
        if value in seen:
            continue
        seen.add(value)
        normalized.append(value)
    normalized.sort()
    return normalized


def _extract_lifecycle_rule_types(rule_entry: dict) -> list[str]:
    types: list[str] = []

    expiration = rule_entry.get("Expiration")
    if isinstance(expiration, dict):
        if expiration.get("Days") is not None or expiration.get("Date") is not None:
            types.append("expiration")
        if expiration.get("ExpiredObjectDeleteMarker") is True:
            types.append("delete_markers")

    noncurrent_expiration = rule_entry.get("NoncurrentVersionExpiration")
    if isinstance(noncurrent_expiration, dict) and noncurrent_expiration.get("NoncurrentDays") is not None:
        types.append("noncurrent_expiration")

    abort_incomplete = rule_entry.get("AbortIncompleteMultipartUpload")
    if isinstance(abort_incomplete, dict) and abort_incomplete.get("DaysAfterInitiation") is not None:
        types.append("abort_multipart")

    transitions = rule_entry.get("Transitions")
    if isinstance(transitions, list) and len(transitions) > 0:
        types.append("transition")
    elif isinstance(rule_entry.get("Transition"), dict):
        types.append("transition")

    noncurrent_transitions = rule_entry.get("NoncurrentVersionTransitions")
    if isinstance(noncurrent_transitions, list) and len(noncurrent_transitions) > 0:
        types.append("noncurrent_transition")
    elif isinstance(rule_entry.get("NoncurrentVersionTransition"), dict):
        types.append("noncurrent_transition")

    return types


def _feature_param_quantifier(rule: CephAdminBucketFilterRule) -> str:
    return "none" if (rule.quantifier or "").strip().lower() == "none" else "any"


def _lifecycle_rule_matches_param(
    lifecycle_rule: dict,
    rule: CephAdminBucketFilterRule,
    *,
    force_presence_positive: bool = False,
) -> bool:
    param = rule.param
    op = (rule.op or "").strip().lower()
    if force_presence_positive and op == "has_not":
        op = "has"
    if param == "lifecycle_rule_id":
        return _match_text_value(_extract_lifecycle_rule_id(lifecycle_rule), op, rule.value)
    if param == "lifecycle_rule_status":
        return _match_text_value(_extract_lifecycle_rule_status(lifecycle_rule), op, rule.value)
    if param == "lifecycle_rule_type":
        rule_types = _extract_lifecycle_rule_types(lifecycle_rule)
        if op == "has":
            return any(_match_text_value(value, "eq", rule.value) for value in rule_types)
        if op == "has_not":
            return not any(_match_text_value(value, "eq", rule.value) for value in rule_types)
        return False
    if param == "lifecycle_abort_multipart_present":
        present = _extract_lifecycle_abort_days(lifecycle_rule) is not None
        if op == "has":
            return present
        if op == "has_not":
            return not present
        return False
    if param == "lifecycle_expiration_days":
        return _match_numeric_value(_extract_lifecycle_expiration_days(lifecycle_rule), op, rule.value)
    if param == "lifecycle_noncurrent_expiration_days":
        return _match_numeric_value(_extract_lifecycle_noncurrent_expiration_days(lifecycle_rule), op, rule.value)
    if param == "lifecycle_transition_days":
        transition_days = _extract_lifecycle_transition_days(lifecycle_rule)
        return any(_match_numeric_value(days, op, rule.value) for days in transition_days)
    if param == "lifecycle_abort_multipart_days":
        return _match_numeric_value(_extract_lifecycle_abort_days(lifecycle_rule), op, rule.value)
    return False


def _match_lifecycle_param_rule_individual(rule: CephAdminBucketFilterRule, lifecycle_rules: list[dict]) -> bool:
    op = (rule.op or "").strip().lower()
    if op == "has_not":
        return not any(_lifecycle_rule_matches_param(item, rule, force_presence_positive=True) for item in lifecycle_rules)
    matched_any = any(_lifecycle_rule_matches_param(item, rule) for item in lifecycle_rules)
    return matched_any if _feature_param_quantifier(rule) == "any" else (not matched_any)


def _match_lifecycle_param_rules_all(
    rules: list[CephAdminBucketFilterRule],
    lifecycle_rules: list[dict],
) -> bool:
    positive_rules: list[CephAdminBucketFilterRule] = []
    forbidden_rules: list[CephAdminBucketFilterRule] = []
    for rule in rules:
        op = (rule.op or "").strip().lower()
        if op == "has_not" or _feature_param_quantifier(rule) == "none":
            forbidden_rules.append(rule)
        else:
            positive_rules.append(rule)

    positive_ok = True
    if positive_rules:
        positive_ok = any(
            all(_lifecycle_rule_matches_param(item, rule) for rule in positive_rules)
            for item in lifecycle_rules
        )

    forbidden_ok = True
    for rule in forbidden_rules:
        op = (rule.op or "").strip().lower()
        if op == "has_not":
            forbidden_match = any(
                _lifecycle_rule_matches_param(item, rule, force_presence_positive=True)
                for item in lifecycle_rules
            )
        else:
            forbidden_match = any(_lifecycle_rule_matches_param(item, rule) for item in lifecycle_rules)
        if forbidden_match:
            forbidden_ok = False
            break
    return positive_ok and forbidden_ok


def _string_or_none(value: object) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _notification_rule_entries(configuration: object) -> list[tuple[str, dict]]:
    if not isinstance(configuration, dict):
        return []
    entries: list[tuple[str, dict]] = []
    for entry_type, config_key, _destination_key in _NOTIFICATION_CONFIGURATION_SPECS:
        raw_entries = configuration.get(config_key)
        if not isinstance(raw_entries, list):
            continue
        entries.extend((entry_type, entry) for entry in raw_entries if isinstance(entry, dict))
    return entries


def _extract_notification_rule_id(entry: dict) -> str | None:
    for key in ("Id", "ID", "id"):
        if (value := _string_or_none(entry.get(key))) is not None:
            return value
    return None


def _last_notification_identifier(value: str) -> str:
    tail = value.rsplit(":", 1)[-1]
    return tail.rsplit("/", 1)[-1] or tail


def _extract_notification_topic_display_name(entry: dict) -> str | None:
    for key in ("Topic", "TopicName", "topic", "topic_name", "EndpointTopic"):
        if (value := _string_or_none(entry.get(key))) is not None:
            return value
    topic_arn = _string_or_none(entry.get("TopicArn"))
    if not topic_arn:
        return None
    return _last_notification_identifier(topic_arn)


def _extract_notification_topic_match_values(entry: dict) -> list[str]:
    values: list[str] = []
    for key in ("Topic", "TopicName", "topic", "topic_name", "EndpointTopic"):
        if (value := _string_or_none(entry.get(key))) is not None:
            values.append(value)
    topic_arn = _string_or_none(entry.get("TopicArn"))
    if topic_arn:
        values.append(topic_arn)
        values.append(_last_notification_identifier(topic_arn))
    return _dedupe_sorted_text_values(values)


def _extract_notification_events(entry: dict) -> list[str]:
    raw_events = entry.get("Events")
    if not isinstance(raw_events, list):
        raw_events = entry.get("events")
    if isinstance(raw_events, list):
        return [value for item in raw_events if (value := _string_or_none(item)) is not None]
    value = _string_or_none(raw_events)
    return [value] if value else []


def _extract_notification_filter_values(entry: dict, filter_name: str) -> list[str]:
    filters: list[dict] = []
    raw_filter = entry.get("Filter")
    if not isinstance(raw_filter, dict):
        raw_filter = entry.get("filter")
    key_filter = raw_filter.get("Key") if isinstance(raw_filter, dict) else None
    if not isinstance(key_filter, dict) and isinstance(raw_filter, dict):
        key_filter = raw_filter.get("key")
    if isinstance(key_filter, dict):
        raw_rules = key_filter.get("FilterRules")
        if not isinstance(raw_rules, list):
            raw_rules = key_filter.get("filterRules")
        if isinstance(raw_rules, list):
            filters.extend(item for item in raw_rules if isinstance(item, dict))
    raw_rules = entry.get("FilterRules")
    if not isinstance(raw_rules, list):
        raw_rules = entry.get("filterRules")
    if isinstance(raw_rules, list):
        filters.extend(item for item in raw_rules if isinstance(item, dict))

    values: list[str] = []
    for item in filters:
        name = _string_or_none(item.get("Name") or item.get("name"))
        if name is None or name.lower() != filter_name:
            continue
        if (value := _string_or_none(item.get("Value") or item.get("value"))) is not None:
            values.append(value)
    return _dedupe_sorted_text_values(values)


def _dedupe_sorted_text_values(values: list[str]) -> list[str]:
    unique: dict[str, str] = {}
    for value in values:
        text = value.strip()
        if not text:
            continue
        unique.setdefault(text.lower(), text)
    return sorted(unique.values(), key=lambda item: item.lower())


def _match_text_candidates(values: list[str], op: str, right_raw: object) -> bool:
    if op == "neq":
        return not any(_match_text_value(value, "eq", right_raw) for value in values)
    return any(_match_text_value(value, op, right_raw) for value in values)


def _match_presence_values(values: list[str], op: str, right_raw: object) -> bool:
    if op == "has":
        return any(_match_text_value(value, "eq", right_raw) for value in values)
    if op == "has_not":
        return not any(_match_text_value(value, "eq", right_raw) for value in values)
    return False


def _text_list_from_keys(entry: dict, keys: tuple[str, ...]) -> list[str]:
    for key in keys:
        raw = entry.get(key)
        if raw is None:
            continue
        if isinstance(raw, list):
            return [value for item in raw if (value := _string_or_none(item)) is not None]
        if (value := _string_or_none(raw)) is not None:
            return [value]
    return []


def _extract_cors_rule_values(entry: dict, param: str) -> list[str]:
    if param == "cors_allowed_method":
        return _text_list_from_keys(entry, ("AllowedMethods", "allowedMethods", "allowed_methods", "AllowedMethod"))
    if param == "cors_allowed_origin":
        return _text_list_from_keys(entry, ("AllowedOrigins", "allowedOrigins", "allowed_origins", "AllowedOrigin"))
    return []


def _extract_cors_allowed_values(rules: object, param: str) -> list[str]:
    if not isinstance(rules, list):
        return []
    values: list[str] = []
    for entry in rules:
        if isinstance(entry, dict):
            values.extend(_extract_cors_rule_values(entry, param))
    return _dedupe_sorted_text_values(values)


def _cors_rule_matches_param(
    entry: dict,
    rule: CephAdminBucketFilterRule,
    *,
    force_presence_positive: bool = False,
) -> bool:
    op = (rule.op or "").strip().lower()
    if force_presence_positive and op == "has_not":
        op = "has"
    values = _extract_cors_rule_values(entry, rule.param or "")
    if op in {"has", "has_not"}:
        return _match_presence_values(values, op, rule.value)
    return _match_text_candidates(values, op, rule.value)


def _match_cors_param_rule_individual(rule: CephAdminBucketFilterRule, cors_rules: list[dict]) -> bool:
    op = (rule.op or "").strip().lower()
    if op == "has_not":
        return not any(_cors_rule_matches_param(item, rule, force_presence_positive=True) for item in cors_rules)
    matched_any = any(_cors_rule_matches_param(item, rule) for item in cors_rules)
    return matched_any if _feature_param_quantifier(rule) == "any" else (not matched_any)


def _match_cors_param_rules_all(
    rules: list[CephAdminBucketFilterRule],
    cors_rules: list[dict],
) -> bool:
    positive_rules: list[CephAdminBucketFilterRule] = []
    forbidden_rules: list[CephAdminBucketFilterRule] = []
    for rule in rules:
        op = (rule.op or "").strip().lower()
        if op == "has_not" or _feature_param_quantifier(rule) == "none":
            forbidden_rules.append(rule)
        else:
            positive_rules.append(rule)

    positive_ok = True
    if positive_rules:
        positive_ok = any(all(_cors_rule_matches_param(item, rule) for rule in positive_rules) for item in cors_rules)

    forbidden_ok = True
    for rule in forbidden_rules:
        op = (rule.op or "").strip().lower()
        if op == "has_not":
            forbidden_match = any(_cors_rule_matches_param(item, rule, force_presence_positive=True) for item in cors_rules)
        else:
            forbidden_match = any(_cors_rule_matches_param(item, rule) for item in cors_rules)
        if forbidden_match:
            forbidden_ok = False
            break
    return positive_ok and forbidden_ok


def _encryption_rule_entries(configuration: object) -> list[dict]:
    if isinstance(configuration, BucketEncryptionConfiguration):
        raw_rules = configuration.rules
    elif isinstance(configuration, list):
        raw_rules = configuration
    else:
        raw_rules = []
    return [item for item in raw_rules if isinstance(item, dict)]


def _extract_sse_default(entry: dict) -> dict:
    raw = entry.get("ApplyServerSideEncryptionByDefault")
    if not isinstance(raw, dict):
        raw = entry.get("applyServerSideEncryptionByDefault")
    if not isinstance(raw, dict):
        raw = entry.get("apply_server_side_encryption_by_default")
    return raw if isinstance(raw, dict) else {}


def _extract_sse_rule_values(entry: dict, param: str) -> list[str]:
    default = _extract_sse_default(entry)
    if param == "sse_algorithm":
        return _text_list_from_keys(default, ("SSEAlgorithm", "sseAlgorithm", "sse_algorithm"))
    if param == "sse_kms_key_id":
        return _text_list_from_keys(default, ("KMSMasterKeyID", "kmsMasterKeyID", "kms_master_key_id", "KMSKeyId"))
    return []


def _extract_sse_values(configuration: object, param: str) -> list[str]:
    values: list[str] = []
    for entry in _encryption_rule_entries(configuration):
        values.extend(_extract_sse_rule_values(entry, param))
    return _dedupe_sorted_text_values(values)


def _sse_rule_matches_param(entry: dict, rule: CephAdminBucketFilterRule) -> bool:
    values = _extract_sse_rule_values(entry, rule.param or "")
    return _match_text_candidates(values, (rule.op or "").strip().lower(), rule.value)


def _match_sse_param_rule_individual(rule: CephAdminBucketFilterRule, configuration: object) -> bool:
    entries = _encryption_rule_entries(configuration)
    matched_any = any(_sse_rule_matches_param(item, rule) for item in entries)
    return matched_any if _feature_param_quantifier(rule) == "any" else (not matched_any)


def _match_sse_param_rules_all(
    rules: list[CephAdminBucketFilterRule],
    configuration: object,
) -> bool:
    entries = _encryption_rule_entries(configuration)
    positive_rules: list[CephAdminBucketFilterRule] = []
    forbidden_rules: list[CephAdminBucketFilterRule] = []
    for rule in rules:
        if _feature_param_quantifier(rule) == "none":
            forbidden_rules.append(rule)
        else:
            positive_rules.append(rule)

    positive_ok = True
    if positive_rules:
        positive_ok = any(all(_sse_rule_matches_param(item, rule) for rule in positive_rules) for item in entries)

    forbidden_ok = True
    for rule in forbidden_rules:
        if any(_sse_rule_matches_param(item, rule) for item in entries):
            forbidden_ok = False
            break
    return positive_ok and forbidden_ok


def _notification_rule_matches_param(
    entry_type: str,
    entry: dict,
    rule: CephAdminBucketFilterRule,
    *,
    force_presence_positive: bool = False,
) -> bool:
    param = rule.param
    op = (rule.op or "").strip().lower()
    if force_presence_positive and op == "has_not":
        op = "has"
    if param == "notification_rule_id":
        return _match_text_value(_extract_notification_rule_id(entry), op, rule.value)
    if param == "notification_rule_type":
        return _match_presence_values([entry_type], op, rule.value)
    if param == "notification_topic_name":
        if entry_type != "topic":
            return False
        return _match_text_candidates(_extract_notification_topic_match_values(entry), op, rule.value)
    if param == "notification_event":
        return _match_presence_values(_extract_notification_events(entry), op, rule.value)
    if param == "notification_filter_prefix":
        return _match_presence_values(_extract_notification_filter_values(entry, "prefix"), op, rule.value)
    if param == "notification_filter_suffix":
        return _match_presence_values(_extract_notification_filter_values(entry, "suffix"), op, rule.value)
    return False


def _match_notification_param_rule_individual(rule: CephAdminBucketFilterRule, configuration: object) -> bool:
    entries = _notification_rule_entries(configuration)
    op = (rule.op or "").strip().lower()
    if op == "has_not":
        return not any(
            _notification_rule_matches_param(entry_type, entry, rule, force_presence_positive=True)
            for entry_type, entry in entries
        )
    matched_any = any(_notification_rule_matches_param(entry_type, entry, rule) for entry_type, entry in entries)
    return matched_any if _feature_param_quantifier(rule) == "any" else (not matched_any)


def _match_notification_param_rules_all(
    rules: list[CephAdminBucketFilterRule],
    configuration: object,
) -> bool:
    entries = _notification_rule_entries(configuration)
    positive_rules: list[CephAdminBucketFilterRule] = []
    forbidden_rules: list[CephAdminBucketFilterRule] = []
    for rule in rules:
        op = (rule.op or "").strip().lower()
        if op == "has_not" or _feature_param_quantifier(rule) == "none":
            forbidden_rules.append(rule)
        else:
            positive_rules.append(rule)

    positive_ok = True
    if positive_rules:
        positive_ok = any(
            all(_notification_rule_matches_param(entry_type, entry, rule) for rule in positive_rules)
            for entry_type, entry in entries
        )

    forbidden_ok = True
    for rule in forbidden_rules:
        op = (rule.op or "").strip().lower()
        if op == "has_not":
            forbidden_match = any(
                _notification_rule_matches_param(entry_type, entry, rule, force_presence_positive=True)
                for entry_type, entry in entries
            )
        else:
            forbidden_match = any(
                _notification_rule_matches_param(entry_type, entry, rule)
                for entry_type, entry in entries
            )
        if forbidden_match:
            forbidden_ok = False
            break
    return positive_ok and forbidden_ok


def _extract_notification_eventbridge_present(configuration: object) -> bool | None:
    if not isinstance(configuration, dict):
        return None
    eventbridge = configuration.get("EventBridgeConfiguration")
    if eventbridge is None:
        eventbridge = configuration.get("eventBridgeConfiguration")
    return isinstance(eventbridge, dict)


def _extract_notification_topic_names(configuration: object) -> list[str]:
    names: list[str] = []
    for entry_type, entry in _notification_rule_entries(configuration):
        if entry_type != "topic":
            continue
        if (name := _extract_notification_topic_display_name(entry)) is not None:
            names.append(name)
    return _dedupe_sorted_text_values(names)


def _extract_policy_statement_summary(policy: dict | None) -> tuple[int, bool]:
    if not isinstance(policy, dict):
        return 0, False
    raw_statements = policy.get("Statement")
    if isinstance(raw_statements, list):
        statements = raw_statements
    elif raw_statements is None:
        statements = []
    else:
        statements = [raw_statements]
    has_conditions = any(
        isinstance(item, dict) and isinstance(item.get("Condition"), dict) and len(item.get("Condition", {}).keys()) > 0
        for item in statements
    )
    return len(statements), has_conditions


def _match_feature_param_rule(rule: CephAdminBucketFilterRule, snapshot: dict[str, object]) -> bool:
    feature = rule.feature
    param = rule.param
    op = (rule.op or "").strip().lower()
    if not feature or not param or not op:
        return False
    source = _FEATURE_PARAM_SOURCE_BY_PARAM.get(param)
    if not source:
        return False
    source_data = snapshot.get(source, _FEATURE_PARAM_UNAVAILABLE)
    if source_data is _FEATURE_PARAM_UNAVAILABLE:
        return False

    if param in {
        "lifecycle_rule_id",
        "lifecycle_rule_status",
        "lifecycle_rule_type",
        "lifecycle_expiration_days",
        "lifecycle_noncurrent_expiration_days",
        "lifecycle_transition_days",
        "lifecycle_abort_multipart_present",
        "lifecycle_abort_multipart_days",
    }:
        lifecycle_rules = source_data if isinstance(source_data, list) else []
        return _match_lifecycle_param_rule_individual(rule, [item for item in lifecycle_rules if isinstance(item, dict)])
    if param in {
        "notification_rule_id",
        "notification_rule_type",
        "notification_topic_name",
        "notification_event",
        "notification_filter_prefix",
        "notification_filter_suffix",
    }:
        return _match_notification_param_rule_individual(rule, source_data)
    if param in {"sse_algorithm", "sse_kms_key_id"}:
        return _match_sse_param_rule_individual(rule, source_data)

    quantifier = _feature_param_quantifier(rule)

    def apply_scalar(result: bool) -> bool:
        return result if quantifier == "any" else (not result)

    if not isinstance(source_data, BucketProperties) and source == "props":
        return False
    if source == "props":
        props = source_data if isinstance(source_data, BucketProperties) else None
        if props is None:
            return False
        if param == "object_lock_mode":
            value = props.object_lock.mode if props.object_lock else None
            return apply_scalar(_match_text_value(value, op, rule.value))
        if param == "object_lock_retention_days":
            days = props.object_lock.days if props.object_lock else None
            return apply_scalar(_match_numeric_value(_coerce_number(days), op, rule.value))
        if param == "object_lock_retention_years":
            years = props.object_lock.years if props.object_lock else None
            return apply_scalar(_match_numeric_value(_coerce_number(years), op, rule.value))
        if param == "bpa_block_public_acls":
            value = props.public_access_block.block_public_acls if props.public_access_block else None
            return apply_scalar(_match_bool_value(value, op, rule.value))
        if param == "bpa_ignore_public_acls":
            value = props.public_access_block.ignore_public_acls if props.public_access_block else None
            return apply_scalar(_match_bool_value(value, op, rule.value))
        if param == "bpa_block_public_policy":
            value = props.public_access_block.block_public_policy if props.public_access_block else None
            return apply_scalar(_match_bool_value(value, op, rule.value))
        if param == "bpa_restrict_public_buckets":
            value = props.public_access_block.restrict_public_buckets if props.public_access_block else None
            return apply_scalar(_match_bool_value(value, op, rule.value))
        if param in {"cors_allowed_method", "cors_allowed_origin"}:
            rules = props.cors_rules if isinstance(props.cors_rules, list) else []
            return _match_cors_param_rule_individual(rule, [item for item in rules if isinstance(item, dict)])
        return False

    if source == "logging":
        if not isinstance(source_data, BucketLoggingConfiguration):
            return False
        target_bucket = (source_data.target_bucket or "").strip() if source_data.target_bucket else ""
        target_prefix = (source_data.target_prefix or "").strip() if source_data.target_prefix else ""
        if param == "logging_enabled":
            enabled = bool(source_data.enabled and target_bucket)
            return apply_scalar(_match_bool_value(enabled, op, rule.value))
        if param == "logging_target_bucket":
            return apply_scalar(_match_text_value(target_bucket or None, op, rule.value))
        if param == "logging_target_prefix":
            return apply_scalar(_match_text_value(target_prefix or None, op, rule.value))
        return False

    if source == "website":
        if not isinstance(source_data, BucketWebsiteConfiguration):
            return False
        index_document = (source_data.index_document or "").strip() if source_data.index_document else ""
        error_document = (source_data.error_document or "").strip() if source_data.error_document else ""
        redirect_host = ""
        if source_data.redirect_all_requests_to and source_data.redirect_all_requests_to.host_name:
            redirect_host = source_data.redirect_all_requests_to.host_name.strip()
        routing_rules = source_data.routing_rules if isinstance(source_data.routing_rules, list) else []
        if param == "website_index_present":
            index_present = bool(index_document)
            return apply_scalar(_match_bool_value(index_present, op, rule.value))
        if param == "website_index_document":
            return apply_scalar(_match_text_value(index_document or None, op, rule.value))
        if param == "website_error_document":
            return apply_scalar(_match_text_value(error_document or None, op, rule.value))
        if param == "website_redirect_host_present":
            redirect_present = bool(redirect_host)
            return apply_scalar(_match_bool_value(redirect_present, op, rule.value))
        if param == "website_redirect_host":
            return apply_scalar(_match_text_value(redirect_host or None, op, rule.value))
        if param == "website_routing_rule_count":
            return apply_scalar(_match_numeric_value(float(len(routing_rules)), op, rule.value))
        return False

    if source == "policy":
        policy = source_data if isinstance(source_data, dict) else None
        statement_count, has_conditions = _extract_policy_statement_summary(policy)
        if param == "policy_statement_count":
            return apply_scalar(_match_numeric_value(float(statement_count), op, rule.value))
        if param == "policy_has_conditions":
            return apply_scalar(_match_bool_value(has_conditions, op, rule.value))
        return False

    if source == "notifications":
        if param == "notification_eventbridge_present":
            return apply_scalar(_match_bool_value(_extract_notification_eventbridge_present(source_data), op, rule.value))
        return False

    return False


def _match_feature_param_rules(
    rules: list[CephAdminBucketFilterRule],
    match_mode: str,
    snapshot: dict[str, object],
) -> bool:
    if not rules:
        return True
    lifecycle_rules = [rule for rule in rules if rule.feature == "lifecycle_rules"]
    cors_rules = [rule for rule in rules if rule.feature == "cors" and rule.param in {"cors_allowed_method", "cors_allowed_origin"}]
    notification_entry_rules = [
        rule
        for rule in rules
        if rule.feature == "notifications" and rule.param != "notification_eventbridge_present"
    ]
    sse_rules = [rule for rule in rules if rule.feature == "server_side_encryption"]
    non_grouped_rules = [
        rule
        for rule in rules
        if rule.feature != "lifecycle_rules"
        and not (rule.feature == "cors" and rule.param in {"cors_allowed_method", "cors_allowed_origin"})
        and not (rule.feature == "notifications" and rule.param != "notification_eventbridge_present")
        and rule.feature != "server_side_encryption"
    ]
    results: list[bool] = []

    if lifecycle_rules:
        lifecycle_source = snapshot.get("lifecycle", _FEATURE_PARAM_UNAVAILABLE)
        if lifecycle_source is _FEATURE_PARAM_UNAVAILABLE or not isinstance(lifecycle_source, list):
            lifecycle_result = False if match_mode == "all" else False
            if match_mode == "all":
                return False
            results.append(lifecycle_result)
        else:
            normalized = [item for item in lifecycle_source if isinstance(item, dict)]
            if match_mode == "all":
                results.append(_match_lifecycle_param_rules_all(lifecycle_rules, normalized))
            else:
                results.extend(_match_lifecycle_param_rule_individual(rule, normalized) for rule in lifecycle_rules)

    if cors_rules:
        props_source = snapshot.get("props", _FEATURE_PARAM_UNAVAILABLE)
        if props_source is _FEATURE_PARAM_UNAVAILABLE or not isinstance(props_source, BucketProperties):
            cors_result = False if match_mode == "all" else False
            if match_mode == "all":
                return False
            results.append(cors_result)
        else:
            raw_rules = props_source.cors_rules if isinstance(props_source.cors_rules, list) else []
            normalized = [item for item in raw_rules if isinstance(item, dict)]
            if match_mode == "all":
                results.append(_match_cors_param_rules_all(cors_rules, normalized))
            else:
                results.extend(_match_cors_param_rule_individual(rule, normalized) for rule in cors_rules)

    if notification_entry_rules:
        notification_source = snapshot.get("notifications", _FEATURE_PARAM_UNAVAILABLE)
        if notification_source is _FEATURE_PARAM_UNAVAILABLE or not isinstance(notification_source, dict):
            notification_result = False if match_mode == "all" else False
            if match_mode == "all":
                return False
            results.append(notification_result)
        elif match_mode == "all":
            results.append(_match_notification_param_rules_all(notification_entry_rules, notification_source))
        else:
            results.extend(_match_notification_param_rule_individual(rule, notification_source) for rule in notification_entry_rules)

    if sse_rules:
        encryption_source = snapshot.get("encryption", _FEATURE_PARAM_UNAVAILABLE)
        if encryption_source is _FEATURE_PARAM_UNAVAILABLE:
            sse_result = False if match_mode == "all" else False
            if match_mode == "all":
                return False
            results.append(sse_result)
        elif match_mode == "all":
            results.append(_match_sse_param_rules_all(sse_rules, encryption_source))
        else:
            results.extend(_match_sse_param_rule_individual(rule, encryption_source) for rule in sse_rules)

    results.extend(_match_feature_param_rule(rule, snapshot) for rule in non_grouped_rules)
    return all(results) if match_mode == "all" else any(results)


def _required_feature_param_sources(rules: list[CephAdminBucketFilterRule]) -> set[str]:
    required: set[str] = set()
    for rule in rules:
        if not rule.param:
            continue
        source = _FEATURE_PARAM_SOURCE_BY_PARAM.get(rule.param)
        if source:
            required.add(source)
    return required


def _load_feature_param_snapshot_for_bucket(
    bucket: CephAdminBucketSummary,
    required_sources: set[str],
    service: BucketsService,
    account: S3Account,
) -> dict[str, object]:
    snapshot: dict[str, object] = {}
    if "props" in required_sources:
        try:
            snapshot["props"] = service.get_bucket_properties(bucket.name, account)
        except RuntimeError:
            snapshot["props"] = _FEATURE_PARAM_UNAVAILABLE
    if "lifecycle" in required_sources:
        try:
            snapshot["lifecycle"] = service.get_lifecycle(bucket.name, account).rules or []
        except RuntimeError:
            snapshot["lifecycle"] = _FEATURE_PARAM_UNAVAILABLE
    if "logging" in required_sources:
        try:
            snapshot["logging"] = service.get_bucket_logging(bucket.name, account)
        except RuntimeError:
            snapshot["logging"] = _FEATURE_PARAM_UNAVAILABLE
    if "website" in required_sources:
        try:
            snapshot["website"] = service.get_bucket_website(bucket.name, account)
        except RuntimeError:
            snapshot["website"] = _FEATURE_PARAM_UNAVAILABLE
    if "policy" in required_sources:
        try:
            snapshot["policy"] = service.get_policy(bucket.name, account)
        except RuntimeError:
            snapshot["policy"] = _FEATURE_PARAM_UNAVAILABLE
    if "notifications" in required_sources:
        if not account_sns_feature_enabled(account):
            snapshot["notifications"] = _FEATURE_PARAM_UNAVAILABLE
        else:
            try:
                snapshot["notifications"] = service.get_bucket_notifications(bucket.name, account).configuration or {}
            except RuntimeError:
                snapshot["notifications"] = _FEATURE_PARAM_UNAVAILABLE
    if "encryption" in required_sources:
        try:
            snapshot["encryption"] = service.get_bucket_encryption(bucket.name, account)
        except RuntimeError:
            snapshot["encryption"] = _FEATURE_PARAM_UNAVAILABLE
    return snapshot


def _load_feature_param_snapshots(
    buckets: list[CephAdminBucketSummary],
    rules: list[CephAdminBucketFilterRule],
    service: BucketsService,
    account: S3Account,
    *,
    progress: _BucketListingProgressEmitter | None = None,
    progress_stage: str = "feature_param_enrichment",
    progress_message: str = "Loading bucket feature parameters",
    progress_start: int = 82,
    progress_end: int = 88,
    cancel_check: Callable[[], None] | None = None,
) -> tuple[dict[str, dict[str, object]], set[str]]:
    snapshots: dict[str, dict[str, object]] = {}
    if not buckets:
        return snapshots, set()
    required_sources = _required_feature_param_sources(rules)
    if not required_sources:
        available = {_bucket_identity_key(bucket) for bucket in buckets}
        return snapshots, available

    def load_one(bucket: CephAdminBucketSummary) -> tuple[str, dict[str, object]]:
        return _bucket_identity_key(bucket), _load_feature_param_snapshot_for_bucket(bucket, required_sources, service, account)

    max_workers = min(BUCKET_ENRICH_MAX_WORKERS, len(buckets))
    total = len(buckets)

    def emit_progress(processed: int) -> None:
        if progress is None:
            return
        progress.emit(
            percent=_common_interpolate_progress_percent(
                progress_start,
                progress_end,
                processed=processed,
                total=total,
            ),
            stage=progress_stage,
            processed=processed,
            total=total,
            message=progress_message,
        )

    if max_workers <= 1:
        for index, bucket in enumerate(buckets, start=1):
            _invoke_cancel_check(cancel_check)
            key, snapshot = load_one(bucket)
            snapshots[key] = snapshot
            emit_progress(index)
            _invoke_cancel_check(cancel_check)
    else:
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            futures = [executor.submit(load_one, bucket) for bucket in buckets]
            for index, future in enumerate(as_completed(futures), start=1):
                _invoke_cancel_check(cancel_check)
                key, snapshot = future.result()
                snapshots[key] = snapshot
                emit_progress(index)
                _invoke_cancel_check(cancel_check)

    available_keys: set[str] = set()
    for key, snapshot in snapshots.items():
        if all(snapshot.get(source, _FEATURE_PARAM_UNAVAILABLE) is not _FEATURE_PARAM_UNAVAILABLE for source in required_sources):
            available_keys.add(key)
    return snapshots, available_keys


def _filter_requires_owner_metadata(query: CephAdminBucketFilterQuery | None) -> bool:
    if not query:
        return False
    owner_related_fields = {"owner", "owner_kind", "tenant", "owner_name"} | _OWNER_ENRICHED_FIELDS
    for rule in query.rules:
        if rule.field in owner_related_fields:
            return True
    return False


def _filter_requires_tenant_metadata(query: CephAdminBucketFilterQuery | None) -> bool:
    if not query:
        return False
    for rule in query.rules:
        if rule.field == "tenant":
            return True
    owner_detail_fields = {"owner_name"} | _OWNER_ENRICHED_FIELDS
    if any(rule.field in owner_detail_fields for rule in query.rules):
        return _determine_owner_name_lookup_scope(query) != "account"
    return False


def _filter_requires_owner_usage(query: CephAdminBucketFilterQuery | None) -> bool:
    if not query:
        return False
    owner_usage_fields = _OWNER_USAGE_FIELDS | _OWNER_USAGE_PERCENT_FIELDS
    return any(rule.field in owner_usage_fields for rule in query.rules)


def _request_requires_bucket_stats(query: CephAdminBucketFilterQuery | None, sort_by: str) -> bool:
    return sort_by in {"used_bytes", "object_count"} or _shared_filter_requires_stats(query)


def _request_requires_owner_metadata(
    query: CephAdminBucketFilterQuery | None,
    sort_by: str,
    simple_filter: str | None,
) -> bool:
    return _filter_requires_owner_metadata(query) or sort_by in {"tenant", "owner"} or bool(simple_filter)


def _request_requires_tenant_metadata(
    query: CephAdminBucketFilterQuery | None,
    sort_by: str,
    simple_filter: str | None,
) -> bool:
    return _filter_requires_tenant_metadata(query) or sort_by == "tenant" or bool(simple_filter)


def _backfill_bucket_owner_metadata(
    ctx: CephAdminContext,
    buckets: list[CephAdminBucketSummary],
    *,
    include_tenant: bool = False,
    progress: _BucketListingProgressEmitter | None = None,
    progress_stage: str = "owner_backfill",
    progress_message: str = "Loading bucket owner metadata",
    progress_start: int = 63,
    progress_end: int = 65,
    cancel_check: Callable[[], None] | None = None,
) -> list[CephAdminBucketSummary]:
    if not buckets:
        return buckets

    pending = [
        bucket
        for bucket in buckets
        if not bucket.owner
        or (include_tenant and bucket.tenant is None and _owner_kind_from_owner(bucket.owner) != "account")
    ]
    if not pending:
        return buckets

    def load_one(bucket: CephAdminBucketSummary) -> tuple[CephAdminBucketSummary, str | None, str | None]:
        try:
            payload = ctx.rgw_admin.get_bucket_info(bucket.name, stats=False, allow_not_found=True)
        except RGWAdminError:
            return bucket, None, None
        if not isinstance(payload, dict) or payload.get("not_found"):
            return bucket, None, None
        tenant, owner = _extract_bucket_owner_scope(payload)
        return bucket, tenant, owner

    max_workers = min(BUCKET_OWNER_LOOKUP_MAX_WORKERS, len(pending))
    total = len(pending)

    def emit_progress(processed: int) -> None:
        if progress is None:
            return
        progress.emit(
            percent=_common_interpolate_progress_percent(
                progress_start,
                progress_end,
                processed=processed,
                total=total,
            ),
            stage=progress_stage,
            processed=processed,
            total=total,
            message=progress_message,
        )

    if max_workers <= 1:
        resolved = []
        for index, bucket in enumerate(pending, start=1):
            _invoke_cancel_check(cancel_check)
            resolved.append(load_one(bucket))
            emit_progress(index)
            _invoke_cancel_check(cancel_check)
    else:
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            futures = [executor.submit(load_one, bucket) for bucket in pending]
            resolved = []
            for index, future in enumerate(as_completed(futures), start=1):
                _invoke_cancel_check(cancel_check)
                resolved.append(future.result())
                emit_progress(index)
                _invoke_cancel_check(cancel_check)

    for bucket, tenant, owner in resolved:
        if not bucket.owner and owner:
            bucket.owner = owner
        if include_tenant and bucket.tenant is None and tenant:
            bucket.tenant = tenant
    return buckets


def _enrich_buckets(
    buckets: list[CephAdminBucketSummary],
    requested: set[str],
    include_tags: bool,
    service: BucketsService,
    account: S3Account,
    *,
    progress: _BucketListingProgressEmitter | None = None,
    progress_stage: str = "bucket_enrichment",
    progress_message: str = "Loading bucket details",
    progress_start: int = 75,
    progress_end: int = 88,
    cancel_check: Callable[[], None] | None = None,
) -> list[CephAdminBucketSummary]:
    if not buckets or (not requested and not include_tags):
        return buckets

    wants_tags = include_tags
    wants_website = "static_website" in requested
    wants_policy = "bucket_policy" in requested
    wants_logging = "access_logging" in requested
    wants_encryption = "server_side_encryption" in requested
    wants_notifications = "notifications" in requested
    sns_feature_enabled = account_sns_feature_enabled(account)
    lifecycle_detail_keys = requested & _COLUMN_DETAIL_LIFECYCLE_KEYS
    wants_lifecycle_details = bool(lifecycle_detail_keys)
    props_detail_keys = requested & _COLUMN_DETAIL_PROPS_KEYS
    wants_props_details = bool(props_detail_keys)
    logging_detail_keys = requested & _COLUMN_DETAIL_LOGGING_KEYS
    wants_logging_details = bool(logging_detail_keys)
    website_detail_keys = requested & _COLUMN_DETAIL_WEBSITE_KEYS
    wants_website_details = bool(website_detail_keys)
    policy_detail_keys = requested & _COLUMN_DETAIL_POLICY_KEYS
    wants_policy_details = bool(policy_detail_keys)
    notification_detail_keys = requested & _COLUMN_DETAIL_NOTIFICATION_KEYS
    wants_notification_details = bool(notification_detail_keys)
    sse_detail_keys = requested & _COLUMN_DETAIL_SSE_KEYS
    wants_sse_details = bool(sse_detail_keys)
    props_feature_keys = {"versioning", "object_lock", "block_public_access", "lifecycle_rules", "cors"}
    requested_props_features = requested & props_feature_keys
    use_props_bundle = len(requested_props_features) > 1 or wants_props_details

    def enrich_one(bucket: CephAdminBucketSummary) -> CephAdminBucketSummary:
        tags: list[BucketTag] | None = None
        if wants_tags:
            try:
                tags = service.get_bucket_tags(bucket.name, account)
            except RuntimeError:
                tags = []

        feature_map: dict[str, BucketFeatureStatus] = {}
        column_details: dict[str, Any] = {}
        props: BucketProperties | None = None
        props_error = False
        if use_props_bundle:
            try:
                props = service.get_bucket_properties(bucket.name, account)
            except RuntimeError:
                props_error = True

        if "versioning" in requested:
            raw_versioning: str | None = None
            if use_props_bundle:
                if props_error:
                    feature_map["versioning"] = _feature_status_unavailable()
                else:
                    raw_versioning = props.versioning_status if props else None
            else:
                try:
                    raw_versioning = service.get_bucket_versioning_status(bucket.name, account)
                except RuntimeError:
                    feature_map["versioning"] = _feature_status_unavailable()
            if "versioning" not in feature_map:
                raw = raw_versioning or "Disabled"
                normalized = str(raw).strip().lower()
                if normalized == "enabled":
                    feature_map["versioning"] = _feature_status_active(raw)
                elif normalized == "suspended":
                    feature_map["versioning"] = BucketFeatureStatus(state=raw, tone="unknown")
                else:
                    feature_map["versioning"] = _feature_status_inactive(raw)

        if "object_lock" in requested:
            if use_props_bundle:
                if props_error:
                    feature_map["object_lock"] = _feature_status_unavailable()
                else:
                    enabled = bool((props.object_lock_enabled if props else None) is True)
                    feature_map["object_lock"] = _feature_status_active("Enabled") if enabled else _feature_status_inactive("Disabled")
            else:
                try:
                    object_lock = service.get_bucket_object_lock(bucket.name, account)
                    enabled = bool(object_lock and object_lock.enabled is True)
                    feature_map["object_lock"] = _feature_status_active("Enabled") if enabled else _feature_status_inactive("Disabled")
                except RuntimeError:
                    feature_map["object_lock"] = _feature_status_unavailable()

        if "block_public_access" in requested:
            cfg = None
            if use_props_bundle:
                if props_error:
                    feature_map["block_public_access"] = _feature_status_unavailable()
                else:
                    cfg = props.public_access_block if props else None
            else:
                try:
                    cfg = service.get_public_access_block(bucket.name, account)
                except RuntimeError:
                    feature_map["block_public_access"] = _feature_status_unavailable()
            if "block_public_access" not in feature_map:
                if not cfg:
                    feature_map["block_public_access"] = _feature_status_inactive("Disabled")
                else:
                    keys = [
                        cfg.block_public_acls,
                        cfg.ignore_public_acls,
                        cfg.block_public_policy,
                        cfg.restrict_public_buckets,
                    ]
                    fully_enabled = all(val is True for val in keys)
                    partially_enabled = not fully_enabled and any(val is True for val in keys)
                    if fully_enabled:
                        feature_map["block_public_access"] = _feature_status_active("Enabled")
                    elif partially_enabled:
                        feature_map["block_public_access"] = _feature_status_active("Partial")
                    else:
                        feature_map["block_public_access"] = _feature_status_inactive("Disabled")

        if "lifecycle_rules" in requested or wants_lifecycle_details:
            lifecycle_rules_for_state: list[object] = []
            lifecycle_rules_raw: list[dict] | None = None
            lifecycle_unavailable = False

            if wants_lifecycle_details:
                try:
                    lifecycle_rules_raw = service.get_lifecycle(bucket.name, account).rules or []
                    lifecycle_rules_for_state = lifecycle_rules_raw
                except RuntimeError:
                    lifecycle_unavailable = True
            elif use_props_bundle:
                if props_error:
                    lifecycle_unavailable = True
                else:
                    lifecycle_rules_for_state = props.lifecycle_rules if props else []
            else:
                try:
                    lifecycle_rules_raw = service.get_lifecycle(bucket.name, account).rules or []
                    lifecycle_rules_for_state = lifecycle_rules_raw
                except RuntimeError:
                    lifecycle_unavailable = True

            if "lifecycle_rules" in requested:
                if lifecycle_unavailable:
                    feature_map["lifecycle_rules"] = _feature_status_unavailable()
                else:
                    has_rules = bool(lifecycle_rules_for_state and len(lifecycle_rules_for_state) > 0)
                    feature_map["lifecycle_rules"] = (
                        _feature_status_active("Enabled") if has_rules else _feature_status_inactive("Disabled")
                    )

            if wants_lifecycle_details:
                if lifecycle_unavailable:
                    for key in lifecycle_detail_keys:
                        column_details[key] = None
                else:
                    normalized_rules = [item for item in (lifecycle_rules_raw or []) if isinstance(item, dict)]

                    if "lifecycle_expiration_days" in lifecycle_detail_keys:
                        values = [_extract_lifecycle_expiration_days(rule) for rule in normalized_rules]
                        column_details["lifecycle_expiration_days"] = _dedupe_sorted_day_values(
                            [value for value in values if value is not None]
                        )
                    if "lifecycle_noncurrent_expiration_days" in lifecycle_detail_keys:
                        values = [_extract_lifecycle_noncurrent_expiration_days(rule) for rule in normalized_rules]
                        column_details["lifecycle_noncurrent_expiration_days"] = _dedupe_sorted_day_values(
                            [value for value in values if value is not None]
                        )
                    if "lifecycle_transition_days" in lifecycle_detail_keys:
                        values: list[float] = []
                        for rule in normalized_rules:
                            values.extend(_extract_lifecycle_transition_days(rule))
                        column_details["lifecycle_transition_days"] = _dedupe_sorted_day_values(values)
                    if "lifecycle_abort_multipart_days" in lifecycle_detail_keys:
                        values = [_extract_lifecycle_abort_days(rule) for rule in normalized_rules]
                        column_details["lifecycle_abort_multipart_days"] = _dedupe_sorted_day_values(
                            [value for value in values if value is not None]
                        )

        if "cors" in requested:
            rules = None
            if use_props_bundle:
                if props_error:
                    feature_map["cors"] = _feature_status_unavailable()
                else:
                    rules = props.cors_rules if props else []
            else:
                try:
                    rules = service.get_bucket_cors(bucket.name, account) or []
                except RuntimeError:
                    feature_map["cors"] = _feature_status_unavailable()
            if "cors" not in feature_map:
                has_rules = bool(rules and len(rules) > 0)
                feature_map["cors"] = _feature_status_active("Configured") if has_rules else _feature_status_inactive("Not set")

        if wants_props_details:
            if props_error or props is None:
                for key in props_detail_keys:
                    column_details[key] = None
            else:
                object_lock = props.object_lock
                if "object_lock_mode" in props_detail_keys:
                    column_details["object_lock_mode"] = object_lock.mode if object_lock else None
                if "object_lock_retention_days" in props_detail_keys:
                    column_details["object_lock_retention_days"] = object_lock.days if object_lock else None
                if "object_lock_retention_years" in props_detail_keys:
                    column_details["object_lock_retention_years"] = object_lock.years if object_lock else None

                public_access_block = props.public_access_block
                if "bpa_block_public_acls" in props_detail_keys:
                    column_details["bpa_block_public_acls"] = public_access_block.block_public_acls if public_access_block else None
                if "bpa_ignore_public_acls" in props_detail_keys:
                    column_details["bpa_ignore_public_acls"] = public_access_block.ignore_public_acls if public_access_block else None
                if "bpa_block_public_policy" in props_detail_keys:
                    column_details["bpa_block_public_policy"] = public_access_block.block_public_policy if public_access_block else None
                if "bpa_restrict_public_buckets" in props_detail_keys:
                    column_details["bpa_restrict_public_buckets"] = public_access_block.restrict_public_buckets if public_access_block else None

                cors_rules = props.cors_rules if isinstance(props.cors_rules, list) else []
                if "cors_allowed_methods" in props_detail_keys:
                    column_details["cors_allowed_methods"] = _extract_cors_allowed_values(cors_rules, "cors_allowed_method")
                if "cors_allowed_origins" in props_detail_keys:
                    column_details["cors_allowed_origins"] = _extract_cors_allowed_values(cors_rules, "cors_allowed_origin")

        if wants_website or wants_website_details:
            try:
                website = service.get_bucket_website(bucket.name, account)
                routing_rules = website.routing_rules or []
                configured = bool(
                    (website.redirect_all_requests_to and (website.redirect_all_requests_to.host_name or "").strip())
                    or (website.index_document or "").strip()
                    or (isinstance(routing_rules, list) and len(routing_rules) > 0)
                )
                if wants_website:
                    feature_map["static_website"] = _feature_status_active("Enabled") if configured else _feature_status_inactive("Disabled")
                if "website_index_document" in website_detail_keys:
                    column_details["website_index_document"] = (website.index_document or "").strip() or None
                if "website_error_document" in website_detail_keys:
                    column_details["website_error_document"] = (website.error_document or "").strip() or None
                if "website_redirect_host" in website_detail_keys:
                    redirect_host = (
                        (website.redirect_all_requests_to.host_name or "").strip()
                        if website.redirect_all_requests_to
                        else ""
                    )
                    column_details["website_redirect_host"] = redirect_host or None
                if "website_routing_rule_count" in website_detail_keys:
                    column_details["website_routing_rule_count"] = len(routing_rules) if isinstance(routing_rules, list) else 0
            except RuntimeError:
                if wants_website:
                    feature_map["static_website"] = _feature_status_unavailable()
                for key in website_detail_keys:
                    column_details[key] = None

        if wants_policy or wants_policy_details:
            try:
                policy = service.get_policy(bucket.name, account)
                configured = bool(policy and isinstance(policy, dict) and len(policy.keys()) > 0)
                if wants_policy:
                    feature_map["bucket_policy"] = _feature_status_active("Configured") if configured else _feature_status_inactive("Not set")
                statement_count, has_conditions = _extract_policy_statement_summary(policy if isinstance(policy, dict) else None)
                if "policy_statement_count" in policy_detail_keys:
                    column_details["policy_statement_count"] = statement_count
                if "policy_has_conditions" in policy_detail_keys:
                    column_details["policy_has_conditions"] = has_conditions
            except RuntimeError:
                if wants_policy:
                    feature_map["bucket_policy"] = _feature_status_unavailable()
                for key in policy_detail_keys:
                    column_details[key] = None

        if wants_logging or wants_logging_details:
            try:
                logging_config = service.get_bucket_logging(bucket.name, account)
                enabled = bool(logging_config.enabled and (logging_config.target_bucket or "").strip())
                if wants_logging:
                    feature_map["access_logging"] = _feature_status_active("Enabled") if enabled else _feature_status_inactive("Disabled")
                if "logging_target_bucket" in logging_detail_keys:
                    column_details["logging_target_bucket"] = (logging_config.target_bucket or "").strip() or None
                if "logging_target_prefix" in logging_detail_keys:
                    column_details["logging_target_prefix"] = (logging_config.target_prefix or "").strip() or None
            except RuntimeError:
                if wants_logging:
                    feature_map["access_logging"] = _feature_status_unavailable()
                for key in logging_detail_keys:
                    column_details[key] = None

        if wants_notifications or wants_notification_details:
            if not sns_feature_enabled:
                if wants_notifications:
                    feature_map["notifications"] = _feature_status_unavailable()
                for key in notification_detail_keys:
                    column_details[key] = None
            else:
                try:
                    notifications = service.get_bucket_notifications(bucket.name, account)
                    configuration = notifications.configuration or {}
                    if wants_notifications:
                        configured = is_bucket_notification_configuration_configured(configuration)
                        feature_map["notifications"] = (
                            _feature_status_active("Configured") if configured else _feature_status_inactive("Not set")
                        )
                    if "notification_topic_names" in notification_detail_keys:
                        column_details["notification_topic_names"] = _extract_notification_topic_names(configuration)
                except RuntimeError:
                    if wants_notifications:
                        feature_map["notifications"] = _feature_status_unavailable()
                    for key in notification_detail_keys:
                        column_details[key] = None

        if wants_encryption or wants_sse_details:
            try:
                encryption = service.get_bucket_encryption(bucket.name, account)
                enabled = bool(encryption.rules and len(encryption.rules) > 0)
                if wants_encryption:
                    feature_map["server_side_encryption"] = (
                        _feature_status_active("Enabled") if enabled else _feature_status_inactive("Disabled")
                    )
                if "sse_algorithms" in sse_detail_keys:
                    column_details["sse_algorithms"] = _extract_sse_values(encryption, "sse_algorithm")
                if "sse_kms_key_ids" in sse_detail_keys:
                    column_details["sse_kms_key_ids"] = _extract_sse_values(encryption, "sse_kms_key_id")
            except RuntimeError:
                if wants_encryption:
                    feature_map["server_side_encryption"] = _feature_status_unavailable()
                for key in sse_detail_keys:
                    column_details[key] = None

        update = {}
        if tags is not None:
            update["tags"] = tags
        if feature_map:
            update["features"] = feature_map
        if column_details:
            update["column_details"] = column_details
        if update:
            base = bucket.model_dump()
            return CephAdminBucketSummary(**{**base, **update})
        return bucket

    max_workers = min(BUCKET_ENRICH_MAX_WORKERS, len(buckets))
    total = len(buckets)

    def emit_progress(processed: int) -> None:
        if progress is None:
            return
        progress.emit(
            percent=_common_interpolate_progress_percent(
                progress_start,
                progress_end,
                processed=processed,
                total=total,
            ),
            stage=progress_stage,
            processed=processed,
            total=total,
            message=progress_message,
        )

    if max_workers <= 1:
        enriched = []
        for index, bucket in enumerate(buckets, start=1):
            _invoke_cancel_check(cancel_check)
            enriched.append(enrich_one(bucket))
            emit_progress(index)
            _invoke_cancel_check(cancel_check)
        return enriched

    # Bucket-level S3 reads are network-bound and independent; run a bounded parallel fan-out.
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {executor.submit(enrich_one, bucket): index for index, bucket in enumerate(buckets)}
        enriched: list[CephAdminBucketSummary | None] = [None] * len(buckets)
        for processed, future in enumerate(as_completed(futures), start=1):
            _invoke_cancel_check(cancel_check)
            enriched[futures[future]] = future.result()
            emit_progress(processed)
            _invoke_cancel_check(cancel_check)
        return [bucket for bucket in enriched if bucket is not None]


def _feature_status_unavailable() -> BucketFeatureStatus:
    return BucketFeatureStatus(state="Unavailable", tone="unknown")


def _feature_status_inactive(state: str) -> BucketFeatureStatus:
    return BucketFeatureStatus(state=state, tone="inactive")


def _feature_status_active(state: str) -> BucketFeatureStatus:
    return BucketFeatureStatus(state=state, tone="active")
