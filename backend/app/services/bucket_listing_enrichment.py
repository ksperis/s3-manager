# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, Callable, Literal, Protocol

from app.db import StorageEndpoint
from app.services.s3_execution_context import S3ExecutionTarget
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
from app.services.bucket_feature_param_matching import (
    dedupe_sorted_day_values,
    extract_cors_allowed_values,
    extract_lifecycle_abort_days,
    extract_lifecycle_expiration_days,
    extract_lifecycle_noncurrent_expiration_days,
    extract_lifecycle_transition_days,
    extract_notification_topic_names,
    extract_policy_statement_summary,
    extract_sse_values,
)
from app.services.bucket_listing_shared import coerce_filter_bool, coerce_filter_number, filter_requires_stats
from app.services.bucket_notification_state import (
    account_sns_feature_enabled,
    is_bucket_notification_configuration_configured,
)
from app.services.bucket_owner_enrichment import BucketOwnerMetadataService, BucketOwnerUsage
from app.services.buckets_service import BucketsService
from app.services.rgw_bucket_metadata import (
    extract_bucket_owner_scope,
    owner_kind_from_owner,
    split_tenant_uid,
)
from app.services.listing_progress import (
    ListingProgressEmitter,
    build_listing_progress_callback,
    invoke_cancel_check,
)
from app.services.rgw_admin import RGWAdminClient, RGWAdminError
from app.utils.normalize import normalize_optional_scalar, normalize_text
from app.utils.storage_endpoint_features import resolve_feature_flags
from app.utils.usage_stats import compute_usage_ratio_percent

BUCKET_ENRICH_MAX_WORKERS = 6
BUCKET_OWNER_LOOKUP_MAX_WORKERS = 6


class BucketListingAdminContext(Protocol):
    endpoint: StorageEndpoint
    rgw_admin: RGWAdminClient


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
COLUMN_DETAIL_KEYS = (
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
OWNER_QUOTA_FIELDS = {"owner_quota_max_size_bytes", "owner_quota_max_objects"}
OWNER_STATUS_FIELDS = {"owner_suspended"}
OWNER_USAGE_FIELDS = {"owner_used_bytes", "owner_object_count"}
OWNER_USAGE_PERCENT_FIELDS = {"owner_quota_usage_size_percent", "owner_quota_usage_object_percent"}
_OWNER_ENRICHED_FIELDS = OWNER_STATUS_FIELDS | OWNER_QUOTA_FIELDS | OWNER_USAGE_FIELDS | OWNER_USAGE_PERCENT_FIELDS
EXPENSIVE_FIELD_RULES = {"owner_name", "tag"} | _OWNER_ENRICHED_FIELDS


def _normalize_owner_kind(raw: object) -> Literal["account", "user"] | None:
    if not isinstance(raw, str):
        return None
    value = raw.strip().lower().replace("-", "_")
    if value in {"account", "accounts", "acct"}:
        return "account"
    if value in {"user", "users"}:
        return "user"
    return None


def determine_owner_name_lookup_scope(query: CephAdminBucketFilterQuery | None) -> Literal["any", "account", "user"]:
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


def extract_name_candidates(query: CephAdminBucketFilterQuery | None) -> list[str] | None:
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
    ctx: BucketListingAdminContext,
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

    owner_kind = owner_kind_from_owner(owner_id)
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
            name = normalize_optional_scalar(account_payload.get("name"))
            cache[owner_key] = name
            return name

    if owner_scope == "account":
        cache[owner_key] = None
        return None

    tenant_hint = tenant
    uid = owner_id
    split_tenant, split_uid = split_tenant_uid(owner_id)
    if split_tenant:
        tenant_hint = split_tenant
        uid = split_uid
    try:
        user_payload = ctx.rgw_admin.get_user(uid, tenant=tenant_hint, allow_not_found=True)
    except RGWAdminError:
        user_payload = None
    if isinstance(user_payload, dict) and not user_payload.get("not_found"):
        # Strict user owner-name resolution: only RGW "display_name" is accepted.
        name = normalize_optional_scalar(user_payload.get("display_name"))
    cache[owner_key] = name
    return name


def resolve_owner_names_for_buckets(
    ctx: BucketListingAdminContext,
    buckets: list[CephAdminBucketSummary],
    owner_scope: Literal["any", "account", "user"] = "any",
) -> dict[str, str | None]:
    owner_targets: dict[str, tuple[str | None, str]] = {}
    for bucket in buckets:
        if not bucket.owner:
            continue
        if owner_scope != "any":
            bucket_owner_kind = owner_kind_from_owner(bucket.owner)
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


def apply_owner_enrichment(
    ctx: BucketListingAdminContext,
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


def match_bucket_field_rule(bucket: CephAdminBucketSummary, rule: CephAdminBucketFilterRule) -> bool:
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
        left_bool = coerce_filter_bool(value)
        if left_bool is None:
            left_bool = False
        if op in ("eq", "neq"):
            right_bool = coerce_filter_bool(rule.value)
            if right_bool is None:
                return False
            return left_bool == right_bool if op == "eq" else left_bool != right_bool
        if op in ("in", "not_in"):
            if not isinstance(rule.value, list):
                return False
            candidates = {coerce_filter_bool(item) for item in rule.value}
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
        left = normalize_text(str(value))
        if field == "owner_kind":
            normalized_kind = _normalize_owner_kind(rule.value)
            right = normalized_kind if normalized_kind else normalize_text(str(rule.value or ""))
            if not right:
                return False
        else:
            right = normalize_text(str(rule.value or ""))
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
                candidates = {normalize_text(str(item)) for item in rule.value}
            result = left in candidates
            return result if op == "in" else not result
        return False

    left_num = coerce_filter_number(value)
    if left_num is None:
        return False
    if op in ("eq", "neq", "gt", "gte", "lt", "lte"):
        right_num = coerce_filter_number(rule.value)
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
        candidates = {coerce_filter_number(item) for item in rule.value}
        candidates = {item for item in candidates if item is not None}
        result = left_num in candidates
        return result if op == "in" else not result
    return False


def match_bucket_feature_rule(bucket: CephAdminBucketSummary, rule: CephAdminBucketFilterRule) -> bool:
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
        return determine_owner_name_lookup_scope(query) != "account"
    return False


def filter_requires_owner_usage(query: CephAdminBucketFilterQuery | None) -> bool:
    if not query:
        return False
    owner_usage_fields = OWNER_USAGE_FIELDS | OWNER_USAGE_PERCENT_FIELDS
    return any(rule.field in owner_usage_fields for rule in query.rules)


def request_requires_bucket_stats(query: CephAdminBucketFilterQuery | None, sort_by: str) -> bool:
    return sort_by in {"used_bytes", "object_count"} or filter_requires_stats(query)


def request_requires_owner_metadata(
    query: CephAdminBucketFilterQuery | None,
    sort_by: str,
    simple_filter: str | None,
) -> bool:
    return _filter_requires_owner_metadata(query) or sort_by in {"tenant", "owner"} or bool(simple_filter)


def request_requires_tenant_metadata(
    query: CephAdminBucketFilterQuery | None,
    sort_by: str,
    simple_filter: str | None,
) -> bool:
    return _filter_requires_tenant_metadata(query) or sort_by == "tenant" or bool(simple_filter)


def backfill_bucket_owner_metadata(
    ctx: BucketListingAdminContext,
    buckets: list[CephAdminBucketSummary],
    *,
    include_tenant: bool = False,
    progress: ListingProgressEmitter | None = None,
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
        or (include_tenant and bucket.tenant is None and owner_kind_from_owner(bucket.owner) != "account")
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
        tenant, owner = extract_bucket_owner_scope(payload)
        return bucket, tenant, owner

    max_workers = min(BUCKET_OWNER_LOOKUP_MAX_WORKERS, len(pending))
    total = len(pending)
    emit_progress = build_listing_progress_callback(
        progress,
        stage=progress_stage,
        message=progress_message,
        start=progress_start,
        end=progress_end,
        total=total,
    )

    if max_workers <= 1:
        resolved = []
        for index, bucket in enumerate(pending, start=1):
            invoke_cancel_check(cancel_check)
            resolved.append(load_one(bucket))
            emit_progress(index)
            invoke_cancel_check(cancel_check)
    else:
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            futures = [executor.submit(load_one, bucket) for bucket in pending]
            resolved = []
            for index, future in enumerate(as_completed(futures), start=1):
                invoke_cancel_check(cancel_check)
                resolved.append(future.result())
                emit_progress(index)
                invoke_cancel_check(cancel_check)

    for bucket, tenant, owner in resolved:
        if not bucket.owner and owner:
            bucket.owner = owner
        if include_tenant and bucket.tenant is None and tenant:
            bucket.tenant = tenant
    return buckets


def enrich_buckets(
    buckets: list[CephAdminBucketSummary],
    requested: set[str],
    include_tags: bool,
    service: BucketsService,
    account: S3ExecutionTarget,
    *,
    progress: ListingProgressEmitter | None = None,
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
                        values = [extract_lifecycle_expiration_days(rule) for rule in normalized_rules]
                        column_details["lifecycle_expiration_days"] = dedupe_sorted_day_values(
                            [value for value in values if value is not None]
                        )
                    if "lifecycle_noncurrent_expiration_days" in lifecycle_detail_keys:
                        values = [extract_lifecycle_noncurrent_expiration_days(rule) for rule in normalized_rules]
                        column_details["lifecycle_noncurrent_expiration_days"] = dedupe_sorted_day_values(
                            [value for value in values if value is not None]
                        )
                    if "lifecycle_transition_days" in lifecycle_detail_keys:
                        values: list[float] = []
                        for rule in normalized_rules:
                            values.extend(extract_lifecycle_transition_days(rule))
                        column_details["lifecycle_transition_days"] = dedupe_sorted_day_values(values)
                    if "lifecycle_abort_multipart_days" in lifecycle_detail_keys:
                        values = [extract_lifecycle_abort_days(rule) for rule in normalized_rules]
                        column_details["lifecycle_abort_multipart_days"] = dedupe_sorted_day_values(
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
                    column_details["cors_allowed_methods"] = extract_cors_allowed_values(cors_rules, "cors_allowed_method")
                if "cors_allowed_origins" in props_detail_keys:
                    column_details["cors_allowed_origins"] = extract_cors_allowed_values(cors_rules, "cors_allowed_origin")

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
                statement_count, has_conditions = extract_policy_statement_summary(policy if isinstance(policy, dict) else None)
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
                        column_details["notification_topic_names"] = extract_notification_topic_names(configuration)
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
                    column_details["sse_algorithms"] = extract_sse_values(encryption, "sse_algorithm")
                if "sse_kms_key_ids" in sse_detail_keys:
                    column_details["sse_kms_key_ids"] = extract_sse_values(encryption, "sse_kms_key_id")
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
    emit_progress = build_listing_progress_callback(
        progress,
        stage=progress_stage,
        message=progress_message,
        start=progress_start,
        end=progress_end,
        total=total,
    )

    if max_workers <= 1:
        enriched = []
        for index, bucket in enumerate(buckets, start=1):
            invoke_cancel_check(cancel_check)
            enriched.append(enrich_one(bucket))
            emit_progress(index)
            invoke_cancel_check(cancel_check)
        return enriched

    # Bucket-level S3 reads are network-bound and independent; run a bounded parallel fan-out.
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {executor.submit(enrich_one, bucket): index for index, bucket in enumerate(buckets)}
        enriched: list[CephAdminBucketSummary | None] = [None] * len(buckets)
        for processed, future in enumerate(as_completed(futures), start=1):
            invoke_cancel_check(cancel_check)
            enriched[futures[future]] = future.result()
            emit_progress(processed)
            invoke_cancel_check(cancel_check)
        return [bucket for bucket in enriched if bucket is not None]


def _feature_status_unavailable() -> BucketFeatureStatus:
    return BucketFeatureStatus(state="Unavailable", tone="unknown")


def _feature_status_inactive(state: str) -> BucketFeatureStatus:
    return BucketFeatureStatus(state=state, tone="inactive")


def _feature_status_active(state: str) -> BucketFeatureStatus:
    return BucketFeatureStatus(state=state, tone="active")
