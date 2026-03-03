# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import json
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from threading import Lock
from time import monotonic
from typing import Any, Callable, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import ValidationError
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.db import S3Account
from app.models.bucket import (
    BucketAcl,
    BucketAclUpdate,
    BucketCorsUpdate,
    BucketEncryptionConfiguration,
    BucketLifecycleConfig,
    BucketLoggingConfiguration,
    BucketNotificationConfiguration,
    BucketObjectLock,
    BucketObjectLockUpdate,
    BucketPolicyIn,
    BucketPolicyOut,
    BucketProperties,
    BucketPublicAccessBlock,
    BucketTag,
    BucketFeatureStatus,
    BucketQuotaUpdate,
    BucketTagsUpdate,
    BucketVersioningUpdate,
    BucketWebsiteConfiguration,
)
from app.models.ceph_admin import (
    CephAdminBucketCompareRequest,
    CephAdminBucketCompareResult,
    CephAdminBucketFilterQuery,
    CephAdminBucketFilterRule,
    CephAdminBucketSummary,
    PaginatedCephAdminBucketsResponse,
)
from app.routers.ceph_admin.dependencies import CephAdminContext, _resolve_storage_endpoint, get_ceph_admin_context
from app.services.buckets_service import BucketsService
from app.services.rgw_admin import RGWAdminError
from app.utils.rgw import extract_bucket_list, is_rgw_account_id
from app.utils.storage_endpoint_features import resolve_feature_flags
from app.utils.usage_stats import extract_usage_stats

router = APIRouter(prefix="/ceph-admin/endpoints/{endpoint_id}/buckets", tags=["ceph-admin-buckets"])

BUCKET_LIST_CACHE_TTL_SECONDS = 30.0
BUCKET_LIST_CACHE_MAX_ENTRIES = 64
RGW_BUCKET_PAYLOAD_CACHE_MAX_ENTRIES = 16
BUCKET_ENRICH_MAX_WORKERS = 6
BUCKET_OWNER_LOOKUP_MAX_WORKERS = 6


@dataclass(frozen=True)
class _BucketListCacheKey:
    endpoint_id: int
    advanced_filter: str | None
    sort_by: str
    sort_dir: str
    with_stats: bool
    with_owner_metadata: bool


@dataclass
class _BucketListCacheEntry:
    endpoint_id: int
    expires_at: float
    items: list[CephAdminBucketSummary]


@dataclass(frozen=True)
class _RgwBucketPayloadCacheKey:
    endpoint_id: int
    with_stats: bool


@dataclass
class _RgwBucketPayloadCacheEntry:
    endpoint_id: int
    expires_at: float
    entries: list[dict]


_BUCKET_LIST_CACHE: OrderedDict[_BucketListCacheKey, _BucketListCacheEntry] = OrderedDict()
_BUCKET_LIST_CACHE_LOCK = Lock()
_RGW_BUCKET_PAYLOAD_CACHE: OrderedDict[_RgwBucketPayloadCacheKey, _RgwBucketPayloadCacheEntry] = OrderedDict()
_RGW_BUCKET_PAYLOAD_CACHE_LOCK = Lock()
_FEATURE_PARAM_UNAVAILABLE = object()
_FEATURE_PARAM_SOURCE_BY_PARAM: dict[str, str] = {
    "lifecycle_rule_id": "lifecycle",
    "lifecycle_rule_type": "lifecycle",
    "lifecycle_expiration_days": "lifecycle",
    "lifecycle_noncurrent_expiration_days": "lifecycle",
    "lifecycle_transition_days": "lifecycle",
    "lifecycle_abort_multipart_present": "lifecycle",
    "lifecycle_abort_multipart_days": "lifecycle",
    "object_lock_mode": "props",
    "object_lock_retention_days": "props",
    "bpa_block_public_acls": "props",
    "bpa_ignore_public_acls": "props",
    "bpa_block_public_policy": "props",
    "bpa_restrict_public_buckets": "props",
    "cors_allowed_method": "props",
    "cors_allowed_origin": "props",
    "logging_enabled": "logging",
    "logging_target_bucket": "logging",
    "website_index_present": "website",
    "website_redirect_host_present": "website",
    "policy_statement_count": "policy",
    "policy_has_conditions": "policy",
}
_COLUMN_DETAIL_LIFECYCLE_KEYS = {
    "lifecycle_expiration_days",
    "lifecycle_noncurrent_expiration_days",
    "lifecycle_transition_days",
    "lifecycle_abort_multipart_days",
}


def _build_endpoint_account(ctx: CephAdminContext) -> S3Account:
    account = S3Account(
        name=f"ceph-admin:{ctx.endpoint.id}",
        rgw_account_id=None,
        email=None,
        rgw_user_uid=None,
    )
    account.storage_endpoint = ctx.endpoint  # type: ignore[assignment]
    account.set_session_credentials(ctx.access_key, ctx.secret_key)
    return account


def _build_endpoint_account_from_credentials(endpoint_id: int, endpoint, access_key: str, secret_key: str) -> S3Account:
    account = S3Account(
        name=f"ceph-admin:{endpoint_id}",
        rgw_account_id=None,
        email=None,
        rgw_user_uid=None,
    )
    account.storage_endpoint = endpoint  # type: ignore[assignment]
    account.set_session_credentials(access_key, secret_key)
    return account


def _parse_includes(include: list[str]) -> set[str]:
    include_set: set[str] = set()
    for item in include:
        if not isinstance(item, str):
            continue
        for part in item.split(","):
            normalized = part.strip()
            if normalized:
                include_set.add(normalized)
    return include_set


def _split_tenant_uid(value: str) -> tuple[str | None, str]:
    if "$" in value:
        tenant, uid = value.split("$", 1)
        return (tenant.strip() or None), uid.strip()
    return None, value.strip()


def _normalize_optional_str(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    cleaned = value.strip()
    return cleaned or None


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
    if owner_scope in {"any", "account"}:
        try:
            account_payload = ctx.rgw_admin.get_account(owner_id, allow_not_found=True)
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


def _normalize_text(value: str) -> str:
    return value.strip().lower()


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
    else:
        value = getattr(bucket, field, None)
    if op == "is_null":
        return value is None
    if op == "not_null":
        return value is not None
    if value is None:
        return False

    string_fields = {"name", "tenant", "owner", "owner_name", "owner_kind"}
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
        "lifecycle_rule_type",
        "lifecycle_expiration_days",
        "lifecycle_noncurrent_expiration_days",
        "lifecycle_transition_days",
        "lifecycle_abort_multipart_present",
        "lifecycle_abort_multipart_days",
    }:
        lifecycle_rules = source_data if isinstance(source_data, list) else []
        return _match_lifecycle_param_rule_individual(rule, [item for item in lifecycle_rules if isinstance(item, dict)])

    quantifier = _feature_param_quantifier(rule)

    def apply_scalar(result: bool) -> bool:
        return result if quantifier == "any" else (not result)

    def apply_sequence(values: list[str], text_op: str) -> bool:
        if text_op == "has":
            return any(_match_text_value(value, "eq", rule.value) for value in values)
        if text_op == "has_not":
            return not any(_match_text_value(value, "eq", rule.value) for value in values)
        matched_any = any(_match_text_value(value, text_op, rule.value) for value in values)
        return matched_any if quantifier == "any" else (not matched_any)

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
            field_name = "AllowedMethods" if param == "cors_allowed_method" else "AllowedOrigins"
            collected: list[str] = []
            rules = props.cors_rules if isinstance(props.cors_rules, list) else []
            for cors_rule in rules:
                if not isinstance(cors_rule, dict):
                    continue
                values = cors_rule.get(field_name)
                if not isinstance(values, list):
                    continue
                for item in values:
                    text = str(item or "").strip()
                    if text:
                        collected.append(text)
            return apply_sequence(collected, op)
        return False

    if source == "logging":
        if not isinstance(source_data, BucketLoggingConfiguration):
            return False
        target_bucket = (source_data.target_bucket or "").strip() if source_data.target_bucket else ""
        if param == "logging_enabled":
            enabled = bool(source_data.enabled and target_bucket)
            return apply_scalar(_match_bool_value(enabled, op, rule.value))
        if param == "logging_target_bucket":
            return apply_scalar(_match_text_value(target_bucket or None, op, rule.value))
        return False

    if source == "website":
        if not isinstance(source_data, BucketWebsiteConfiguration):
            return False
        redirect_host = ""
        if source_data.redirect_all_requests_to and source_data.redirect_all_requests_to.host_name:
            redirect_host = source_data.redirect_all_requests_to.host_name.strip()
        if param == "website_index_present":
            index_present = bool((source_data.index_document or "").strip())
            return apply_scalar(_match_bool_value(index_present, op, rule.value))
        if param == "website_redirect_host_present":
            redirect_present = bool(redirect_host)
            return apply_scalar(_match_bool_value(redirect_present, op, rule.value))
        return False

    if source == "policy":
        policy = source_data if isinstance(source_data, dict) else None
        statement_count, has_conditions = _extract_policy_statement_summary(policy)
        if param == "policy_statement_count":
            return apply_scalar(_match_numeric_value(float(statement_count), op, rule.value))
        if param == "policy_has_conditions":
            return apply_scalar(_match_bool_value(has_conditions, op, rule.value))
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
    non_lifecycle_rules = [rule for rule in rules if rule.feature != "lifecycle_rules"]
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

    results.extend(_match_feature_param_rule(rule, snapshot) for rule in non_lifecycle_rules)
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
    return snapshot


def _load_feature_param_snapshots(
    buckets: list[CephAdminBucketSummary],
    rules: list[CephAdminBucketFilterRule],
    service: BucketsService,
    account: S3Account,
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
    if max_workers <= 1:
        for bucket in buckets:
            key, snapshot = load_one(bucket)
            snapshots[key] = snapshot
    else:
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            for key, snapshot in executor.map(load_one, buckets):
                snapshots[key] = snapshot

    available_keys: set[str] = set()
    for key, snapshot in snapshots.items():
        if all(snapshot.get(source, _FEATURE_PARAM_UNAVAILABLE) is not _FEATURE_PARAM_UNAVAILABLE for source in required_sources):
            available_keys.add(key)
    return snapshots, available_keys


def _match_rules(bucket: CephAdminBucketSummary, rules: list[CephAdminBucketFilterRule], match: str) -> bool:
    if not rules:
        return True
    results: list[bool] = []
    for rule in rules:
        if rule.field:
            results.append(_match_field_rule(bucket, rule))
        elif rule.param:
            results.append(False)
        else:
            results.append(_match_feature_rule(bucket, rule))
    return all(results) if match == "all" else any(results)


def _filter_requires_stats(query: CephAdminBucketFilterQuery | None) -> bool:
    if not query:
        return False
    for rule in query.rules:
        if rule.field in {"used_bytes", "object_count", "quota_max_size_bytes", "quota_max_objects"}:
            return True
    return False


def _filter_requires_owner_metadata(query: CephAdminBucketFilterQuery | None) -> bool:
    if not query:
        return False
    owner_related_fields = {"tenant", "owner", "owner_name", "owner_kind"}
    for rule in query.rules:
        if rule.field in owner_related_fields:
            return True
    return False


def _enrich_buckets(
    buckets: list[CephAdminBucketSummary],
    requested: set[str],
    include_tags: bool,
    service: BucketsService,
    account: S3Account,
) -> list[CephAdminBucketSummary]:
    if not buckets or (not requested and not include_tags):
        return buckets

    wants_tags = include_tags
    wants_website = "static_website" in requested
    wants_policy = "bucket_policy" in requested
    wants_logging = "access_logging" in requested
    wants_encryption = "server_side_encryption" in requested
    lifecycle_detail_keys = requested & _COLUMN_DETAIL_LIFECYCLE_KEYS
    wants_lifecycle_details = bool(lifecycle_detail_keys)
    props_feature_keys = {"versioning", "object_lock", "block_public_access", "lifecycle_rules", "cors"}
    requested_props_features = requested & props_feature_keys
    use_props_bundle = len(requested_props_features) > 1

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

        if wants_website and "static_website" in requested:
            try:
                website = service.get_bucket_website(bucket.name, account)
                routing_rules = website.routing_rules or []
                configured = bool(
                    (website.redirect_all_requests_to and (website.redirect_all_requests_to.host_name or "").strip())
                    or (website.index_document or "").strip()
                    or (isinstance(routing_rules, list) and len(routing_rules) > 0)
                )
                feature_map["static_website"] = _feature_status_active("Enabled") if configured else _feature_status_inactive("Disabled")
            except RuntimeError:
                feature_map["static_website"] = _feature_status_unavailable()

        if wants_policy and "bucket_policy" in requested:
            try:
                policy = service.get_policy(bucket.name, account)
                configured = bool(policy and isinstance(policy, dict) and len(policy.keys()) > 0)
                feature_map["bucket_policy"] = _feature_status_active("Configured") if configured else _feature_status_inactive("Not set")
            except RuntimeError:
                feature_map["bucket_policy"] = _feature_status_unavailable()

        if wants_logging and "access_logging" in requested:
            try:
                logging_config = service.get_bucket_logging(bucket.name, account)
                enabled = bool(logging_config.enabled and (logging_config.target_bucket or "").strip())
                feature_map["access_logging"] = _feature_status_active("Enabled") if enabled else _feature_status_inactive("Disabled")
            except RuntimeError:
                feature_map["access_logging"] = _feature_status_unavailable()

        if wants_encryption and "server_side_encryption" in requested:
            try:
                encryption = service.get_bucket_encryption(bucket.name, account)
                enabled = bool(encryption.rules and len(encryption.rules) > 0)
                feature_map["server_side_encryption"] = (
                    _feature_status_active("Enabled") if enabled else _feature_status_inactive("Disabled")
                )
            except RuntimeError:
                feature_map["server_side_encryption"] = _feature_status_unavailable()

        update = {}
        if tags is not None:
            update["tags"] = tags
        if feature_map:
            update["features"] = feature_map
        if column_details:
            update["column_details"] = column_details
        if update:
            base = bucket.model_dump() if hasattr(bucket, "model_dump") else bucket.dict()
            return CephAdminBucketSummary(**{**base, **update})
        return bucket

    max_workers = min(BUCKET_ENRICH_MAX_WORKERS, len(buckets))
    if max_workers <= 1:
        return [enrich_one(bucket) for bucket in buckets]

    # Bucket-level S3 reads are network-bound and independent; run a bounded parallel fan-out.
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        return list(executor.map(enrich_one, buckets))


def _feature_status_unavailable() -> BucketFeatureStatus:
    return BucketFeatureStatus(state="Unavailable", tone="unknown")


def _feature_status_inactive(state: str) -> BucketFeatureStatus:
    return BucketFeatureStatus(state=state, tone="inactive")


def _feature_status_active(state: str) -> BucketFeatureStatus:
    return BucketFeatureStatus(state=state, tone="active")


def _serialize_filter(query: CephAdminBucketFilterQuery | None) -> str | None:
    if not query:
        return None
    payload = query.model_dump(mode="json") if hasattr(query, "model_dump") else query.dict()
    return json.dumps(payload, separators=(",", ":"), sort_keys=True)


def _clone_bucket(bucket: CephAdminBucketSummary) -> CephAdminBucketSummary:
    if hasattr(bucket, "model_copy"):
        return bucket.model_copy(deep=True)
    if hasattr(bucket, "copy"):
        return bucket.copy(deep=True)
    payload = bucket.model_dump() if hasattr(bucket, "model_dump") else bucket.dict()
    return CephAdminBucketSummary(**payload)


def _clone_bucket_list(items: list[CephAdminBucketSummary]) -> list[CephAdminBucketSummary]:
    return [_clone_bucket(item) for item in items]


def _prune_bucket_listing_cache(now: float) -> None:
    expired_keys = [key for key, entry in _BUCKET_LIST_CACHE.items() if entry.expires_at <= now]
    for key in expired_keys:
        _BUCKET_LIST_CACHE.pop(key, None)
    while len(_BUCKET_LIST_CACHE) > BUCKET_LIST_CACHE_MAX_ENTRIES:
        _BUCKET_LIST_CACHE.popitem(last=False)


def _prune_rgw_bucket_payload_cache(now: float) -> None:
    expired_keys = [key for key, entry in _RGW_BUCKET_PAYLOAD_CACHE.items() if entry.expires_at <= now]
    for key in expired_keys:
        _RGW_BUCKET_PAYLOAD_CACHE.pop(key, None)
    while len(_RGW_BUCKET_PAYLOAD_CACHE) > RGW_BUCKET_PAYLOAD_CACHE_MAX_ENTRIES:
        _RGW_BUCKET_PAYLOAD_CACHE.popitem(last=False)


def _get_cached_rgw_bucket_entries(ctx: CephAdminContext, with_stats: bool) -> list[dict]:
    key = _RgwBucketPayloadCacheKey(endpoint_id=int(getattr(ctx.endpoint, "id", 0) or 0), with_stats=with_stats)
    now = monotonic()
    with _RGW_BUCKET_PAYLOAD_CACHE_LOCK:
        _prune_rgw_bucket_payload_cache(now)
        cached = _RGW_BUCKET_PAYLOAD_CACHE.get(key)
        if cached is not None:
            _RGW_BUCKET_PAYLOAD_CACHE.move_to_end(key)
            return cached.entries

    payload = ctx.rgw_admin.get_all_buckets(with_stats=with_stats)
    entries = extract_bucket_list(payload)
    expires_at = monotonic() + BUCKET_LIST_CACHE_TTL_SECONDS
    with _RGW_BUCKET_PAYLOAD_CACHE_LOCK:
        _prune_rgw_bucket_payload_cache(monotonic())
        _RGW_BUCKET_PAYLOAD_CACHE[key] = _RgwBucketPayloadCacheEntry(
            endpoint_id=key.endpoint_id,
            expires_at=expires_at,
            entries=entries,
        )
        _RGW_BUCKET_PAYLOAD_CACHE.move_to_end(key)
        _prune_rgw_bucket_payload_cache(monotonic())
    return entries


def _get_cached_bucket_listing(
    key: _BucketListCacheKey,
    builder: Callable[[], list[CephAdminBucketSummary]],
) -> list[CephAdminBucketSummary]:
    now = monotonic()
    with _BUCKET_LIST_CACHE_LOCK:
        _prune_bucket_listing_cache(now)
        cached = _BUCKET_LIST_CACHE.get(key)
        if cached is not None:
            _BUCKET_LIST_CACHE.move_to_end(key)
            return cached.items

    items = builder()
    expires_at = monotonic() + BUCKET_LIST_CACHE_TTL_SECONDS
    with _BUCKET_LIST_CACHE_LOCK:
        _prune_bucket_listing_cache(monotonic())
        _BUCKET_LIST_CACHE[key] = _BucketListCacheEntry(endpoint_id=key.endpoint_id, expires_at=expires_at, items=items)
        _BUCKET_LIST_CACHE.move_to_end(key)
        _prune_bucket_listing_cache(monotonic())
    return items


def _invalidate_bucket_listing_cache(endpoint_id: int) -> None:
    with _BUCKET_LIST_CACHE_LOCK:
        invalid_keys = [key for key, entry in _BUCKET_LIST_CACHE.items() if entry.endpoint_id == endpoint_id]
        for key in invalid_keys:
            _BUCKET_LIST_CACHE.pop(key, None)
    with _RGW_BUCKET_PAYLOAD_CACHE_LOCK:
        invalid_keys = [key for key, entry in _RGW_BUCKET_PAYLOAD_CACHE.items() if entry.endpoint_id == endpoint_id]
        for key in invalid_keys:
            _RGW_BUCKET_PAYLOAD_CACHE.pop(key, None)


def _require_sse_feature(ctx: CephAdminContext) -> None:
    if not resolve_feature_flags(ctx.endpoint).sse_enabled:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Server-side encryption is disabled for this endpoint",
        )


@router.get("", response_model=PaginatedCephAdminBucketsResponse)
def list_buckets(
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=200),
    filter: str | None = Query(None),
    advanced_filter: str | None = Query(None),
    sort_by: str = Query("name"),
    sort_dir: str = Query("asc"),
    include: list[str] = Query(default=[]),
    with_stats: bool = True,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> PaginatedCephAdminBucketsResponse:
    if advanced_filter:
        simple_filter = filter.strip() if isinstance(filter, str) and filter.strip() else None
        _, advanced_filter = _parse_filter(advanced_filter)
    else:
        simple_filter, advanced_filter = _parse_filter(filter)
    simple_filter = simple_filter.strip() if isinstance(simple_filter, str) and simple_filter.strip() else None
    storage_metrics_enabled = True
    endpoint = getattr(ctx, "endpoint", None)
    if endpoint is not None and hasattr(endpoint, "provider") and hasattr(endpoint, "features_config"):
        storage_metrics_enabled = bool(resolve_feature_flags(endpoint).metrics_enabled)
    if not storage_metrics_enabled:
        with_stats = False
    elif _filter_requires_stats(advanced_filter):
        with_stats = True

    include_set = _parse_includes(include)
    wants_owner_name = "owner_name" in include_set
    needs_owner_metadata = _filter_requires_owner_metadata(advanced_filter) or sort_by in {"tenant", "owner"}
    fetch_with_stats = with_stats or needs_owner_metadata
    requested_features = include_set & {
        "tags",
        "versioning",
        "object_lock",
        "block_public_access",
        "lifecycle_rules",
        "static_website",
        "bucket_policy",
        "cors",
        "access_logging",
        "server_side_encryption",
    }
    requested_detail_fields = include_set & _COLUMN_DETAIL_LIFECYCLE_KEYS

    cache_key = _BucketListCacheKey(
        endpoint_id=int(getattr(ctx.endpoint, "id", 0) or 0),
        advanced_filter=_serialize_filter(advanced_filter),
        sort_by=sort_by,
        sort_dir=sort_dir,
        with_stats=with_stats,
        with_owner_metadata=needs_owner_metadata,
    )

    def build_listing() -> list[CephAdminBucketSummary]:
        try:
            name_candidates = _extract_name_candidates(advanced_filter)
            if name_candidates is not None:
                if not name_candidates:
                    entries: list[dict] = []
                else:
                    allowed_names = set(name_candidates)
                    entries = [
                        entry
                        for entry in _get_cached_rgw_bucket_entries(ctx, with_stats=fetch_with_stats)
                        if _extract_bucket_name(entry) in allowed_names
                    ]
            else:
                entries = _get_cached_rgw_bucket_entries(ctx, with_stats=fetch_with_stats)
        except RGWAdminError as exc:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
        results: list[CephAdminBucketSummary] = []
        for entry in entries:
            summary = _build_bucket_summary(entry)
            if summary:
                if not with_stats:
                    summary.used_bytes = None
                    summary.object_count = None
                    summary.quota_max_size_bytes = None
                    summary.quota_max_objects = None
                results.append(summary)

        if advanced_filter and advanced_filter.rules:
            field_rules = [rule for rule in advanced_filter.rules if rule.field]
            feature_state_rules = [rule for rule in advanced_filter.rules if rule.feature and rule.state is not None]
            feature_param_rules = [rule for rule in advanced_filter.rules if rule.feature and rule.param is not None]
            match_mode = advanced_filter.match
            expensive_field_rules = [
                rule for rule in field_rules if rule.field in {"owner_name", "tag"}
            ]
            cheap_field_rules = [
                rule for rule in field_rules if rule.field not in {"owner_name", "tag"}
            ]

            if cheap_field_rules and match_mode == "all":
                results = [bucket for bucket in results if all(_match_field_rule(bucket, rule) for rule in cheap_field_rules)]
            elif (
                cheap_field_rules
                and match_mode == "any"
                and not expensive_field_rules
                and not feature_state_rules
                and not feature_param_rules
            ):
                results = [bucket for bucket in results if any(_match_field_rule(bucket, rule) for rule in cheap_field_rules)]

            if expensive_field_rules or feature_state_rules or feature_param_rules:
                filter_features = {rule.feature for rule in feature_state_rules if rule.feature}
                requires_tag_lookup = any(rule.field == "tag" for rule in expensive_field_rules)
                requires_owner_name_lookup = any(rule.field == "owner_name" for rule in expensive_field_rules)
                service = BucketsService()
                account = _build_endpoint_account(ctx)
                expensive_candidates = results

                if feature_param_rules:
                    if requires_owner_name_lookup and expensive_candidates:
                        owner_scope = _determine_owner_name_lookup_scope(advanced_filter)
                        owner_name_by_key = _resolve_owner_names_for_buckets(
                            ctx,
                            expensive_candidates,
                            owner_scope=owner_scope,
                        )
                        for bucket in expensive_candidates:
                            if not bucket.owner:
                                bucket.owner_name = None
                                continue
                            owner_key = f"{bucket.tenant or ''}:{bucket.owner}"
                            bucket.owner_name = owner_name_by_key.get(owner_key)

                    if expensive_candidates and (filter_features or requires_tag_lookup):
                        expensive_candidates = _enrich_buckets(
                            expensive_candidates,
                            {feature for feature in filter_features if feature != "tags"},
                            include_tags=requires_tag_lookup or ("tags" in filter_features),
                            service=service,
                            account=account,
                        )

                    feature_param_snapshots, feature_param_available_keys = _load_feature_param_snapshots(
                        expensive_candidates,
                        feature_param_rules,
                        service=service,
                        account=account,
                    )

                    filtered: list[CephAdminBucketSummary] = []
                    for bucket in expensive_candidates:
                        bucket_key = _bucket_identity_key(bucket)
                        if bucket_key not in feature_param_available_keys:
                            # Strict mode: exclude buckets that cannot be evaluated for active feature param rules.
                            continue
                        snapshot = feature_param_snapshots.get(bucket_key, {})
                        if match_mode == "all":
                            matches = (
                                (all(_match_field_rule(bucket, rule) for rule in field_rules) if field_rules else True)
                                and (all(_match_feature_rule(bucket, rule) for rule in feature_state_rules) if feature_state_rules else True)
                                and _match_feature_param_rules(feature_param_rules, match_mode, snapshot)
                            )
                        else:
                            field_match = any(_match_field_rule(bucket, rule) for rule in field_rules) if field_rules else False
                            state_match = any(_match_feature_rule(bucket, rule) for rule in feature_state_rules) if feature_state_rules else False
                            param_match = _match_feature_param_rules(feature_param_rules, match_mode, snapshot)
                            matches = field_match or state_match or param_match
                        if matches:
                            filtered.append(bucket)
                    results = filtered
                else:
                    field_matched: list[CephAdminBucketSummary] = []
                    if match_mode == "any" and cheap_field_rules:
                        # Apply cheap predicates first and resolve expensive data only for unresolved buckets.
                        unresolved: list[CephAdminBucketSummary] = []
                        for bucket in results:
                            if any(_match_field_rule(bucket, rule) for rule in cheap_field_rules):
                                field_matched.append(bucket)
                            else:
                                unresolved.append(bucket)
                        expensive_candidates = unresolved

                    if requires_owner_name_lookup and expensive_candidates:
                        owner_scope = _determine_owner_name_lookup_scope(advanced_filter)
                        owner_name_by_key = _resolve_owner_names_for_buckets(
                            ctx,
                            expensive_candidates,
                            owner_scope=owner_scope,
                        )
                        for bucket in expensive_candidates:
                            if not bucket.owner:
                                bucket.owner_name = None
                                continue
                            owner_key = f"{bucket.tenant or ''}:{bucket.owner}"
                            bucket.owner_name = owner_name_by_key.get(owner_key)

                    if expensive_candidates and (filter_features or requires_tag_lookup):
                        expensive_candidates = _enrich_buckets(
                            expensive_candidates,
                            {feature for feature in filter_features if feature != "tags"},
                            include_tags=requires_tag_lookup or ("tags" in filter_features),
                            service=service,
                            account=account,
                        )

                    if match_mode == "all":
                        results = [
                            bucket
                            for bucket in expensive_candidates
                            if (all(_match_field_rule(bucket, rule) for rule in expensive_field_rules) if expensive_field_rules else True)
                            and (all(_match_feature_rule(bucket, rule) for rule in feature_state_rules) if feature_state_rules else True)
                        ]
                    elif cheap_field_rules:
                        expensive_matched = [
                            bucket
                            for bucket in expensive_candidates
                            if (any(_match_field_rule(bucket, rule) for rule in expensive_field_rules) if expensive_field_rules else False)
                            or (any(_match_feature_rule(bucket, rule) for rule in feature_state_rules) if feature_state_rules else False)
                        ]
                        results = field_matched + expensive_matched
                    else:
                        results = [
                            bucket
                            for bucket in expensive_candidates
                            if (any(_match_field_rule(bucket, rule) for rule in expensive_field_rules) if expensive_field_rules else False)
                            or (any(_match_feature_rule(bucket, rule) for rule in feature_state_rules) if feature_state_rules else False)
                        ]

                for bucket in results:
                    bucket.features = None
                    bucket.tags = None
                    bucket.column_details = None

        def sort_value(bucket: CephAdminBucketSummary):
            if sort_by == "tenant":
                value = bucket.tenant or ""
            elif sort_by == "owner":
                value = bucket.owner or ""
            elif sort_by == "used_bytes":
                value = bucket.used_bytes if bucket.used_bytes is not None else 0
            elif sort_by == "object_count":
                value = bucket.object_count if bucket.object_count is not None else 0
            else:
                value = bucket.name
            if isinstance(value, str):
                return value.lower()
            return value

        sortable: list[tuple[object, CephAdminBucketSummary]] = []
        missing_values: list[CephAdminBucketSummary] = []
        for bucket in results:
            value = sort_value(bucket)
            if value is None:
                missing_values.append(bucket)
            else:
                sortable.append((value, bucket))

        sortable.sort(key=lambda item: item[0], reverse=sort_dir == "desc")
        results = [bucket for _, bucket in sortable] + missing_values
        return results

    results = _get_cached_bucket_listing(cache_key, build_listing)
    filtered_results = results
    if simple_filter:
        filter_value = simple_filter.lower()
        if advanced_filter:
            filtered_results = [bucket for bucket in filtered_results if filter_value in bucket.name.lower()]
        else:
            filtered_results = [
                bucket
                for bucket in filtered_results
                if filter_value in bucket.name.lower()
                or filter_value in (bucket.tenant or "").lower()
                or filter_value in (bucket.owner or "").lower()
            ]

    total = len(filtered_results)
    start = max(page - 1, 0) * page_size
    end = start + page_size
    page_items = _clone_bucket_list(filtered_results[start:end])

    requested = ({feature for feature in requested_features if feature != "tags"} | requested_detail_fields)
    if requested or ("tags" in requested_features):
        service = BucketsService()
        account = _build_endpoint_account(ctx)
        page_items = _enrich_buckets(
            page_items,
            requested,
            include_tags="tags" in requested_features,
            service=service,
            account=account,
        )

    if wants_owner_name and page_items:
        owner_name_by_key = _resolve_owner_names_for_buckets(ctx, page_items, owner_scope="any")
        for bucket in page_items:
            if not bucket.owner:
                bucket.owner_name = None
                continue
            owner_key = f"{bucket.tenant or ''}:{bucket.owner}"
            bucket.owner_name = owner_name_by_key.get(owner_key, bucket.owner_name)

    has_next = end < total
    return PaginatedCephAdminBucketsResponse(
        items=page_items,
        total=total,
        page=page,
        page_size=page_size,
        has_next=has_next,
    )


@router.post("/compare", response_model=CephAdminBucketCompareResult)
def compare_bucket_pair(
    endpoint_id: int,
    payload: CephAdminBucketCompareRequest,
    db: Session = Depends(get_db),
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> CephAdminBucketCompareResult:
    source_account = _build_endpoint_account(ctx)
    target_endpoint = _resolve_storage_endpoint(db, payload.target_endpoint_id)
    target_access_key = getattr(target_endpoint, "ceph_admin_access_key", None)
    target_secret_key = getattr(target_endpoint, "ceph_admin_secret_key", None)
    if not target_access_key or not target_secret_key:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Target endpoint Ceph Admin credentials are not configured",
        )
    target_account = _build_endpoint_account_from_credentials(
        payload.target_endpoint_id,
        target_endpoint,
        target_access_key,
        target_secret_key,
    )

    service = BucketsService()
    content_diff = None
    config_diff = None
    try:
        if payload.include_content:
            content_diff = service.compare_bucket_content(
                payload.source_bucket,
                source_account,
                payload.target_bucket,
                target_account,
                size_only=payload.size_only,
                diff_sample_limit=payload.diff_sample_limit,
            )
        if payload.include_config:
            config_diff = service.compare_bucket_configuration(
                payload.source_bucket,
                source_account,
                payload.target_bucket,
                target_account,
            )
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc

    has_differences = bool(
        (
            content_diff is not None
            and (
                content_diff.different_count > 0
                or content_diff.only_source_count > 0
                or content_diff.only_target_count > 0
            )
        )
        or (config_diff.changed if config_diff else False)
    )
    return CephAdminBucketCompareResult(
        source_endpoint_id=endpoint_id,
        target_endpoint_id=payload.target_endpoint_id,
        source_bucket=payload.source_bucket,
        target_bucket=payload.target_bucket,
        compare_mode=content_diff.compare_mode if content_diff else None,
        has_differences=has_differences,
        content_diff=content_diff,
        config_diff=config_diff,
    )


@router.get("/{bucket_name}/properties", response_model=BucketProperties)
def bucket_properties(
    bucket_name: str,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> BucketProperties:
    service = BucketsService()
    account = _build_endpoint_account(ctx)
    try:
        return service.get_bucket_properties(bucket_name, account)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.put("/{bucket_name}/versioning", status_code=status.HTTP_200_OK)
def update_versioning(
    bucket_name: str,
    payload: BucketVersioningUpdate,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
):
    service = BucketsService()
    account = _build_endpoint_account(ctx)
    try:
        service.set_versioning(bucket_name, account, enabled=payload.enabled)
        _invalidate_bucket_listing_cache(ctx.endpoint.id)
        return {"message": f"Versioning updated for {bucket_name}", "enabled": payload.enabled}
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.put("/{bucket_name}/quota", status_code=status.HTTP_200_OK)
def update_quota(
    bucket_name: str,
    payload: BucketQuotaUpdate,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
):
    service = BucketsService()
    account = _build_endpoint_account(ctx)
    try:
        bucket_info = ctx.rgw_admin.get_bucket_info(bucket_name, stats=False, allow_not_found=True)
    except RGWAdminError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
    if not bucket_info or (isinstance(bucket_info, dict) and bucket_info.get("not_found")):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Bucket not found")

    owner_account_id, owner_uid = _resolve_bucket_owner_identity(bucket_info)
    if not owner_account_id and not owner_uid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unable to resolve bucket owner for quota update",
        )
    account.rgw_account_id = owner_account_id
    account.rgw_user_uid = owner_uid

    try:
        service.set_bucket_quota(bucket_name, account, payload, rgw_admin=ctx.rgw_admin)
        _invalidate_bucket_listing_cache(ctx.endpoint.id)
        return {"message": "Bucket quota updated"}
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.get("/{bucket_name}/lifecycle", response_model=BucketLifecycleConfig)
def get_lifecycle(
    bucket_name: str,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> BucketLifecycleConfig:
    service = BucketsService()
    account = _build_endpoint_account(ctx)
    try:
        return service.get_lifecycle(bucket_name, account)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.put("/{bucket_name}/lifecycle", response_model=BucketLifecycleConfig)
def put_lifecycle(
    bucket_name: str,
    payload: BucketLifecycleConfig,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> BucketLifecycleConfig:
    service = BucketsService()
    account = _build_endpoint_account(ctx)
    try:
        response = service.set_lifecycle(bucket_name, account, rules=payload.rules)
        _invalidate_bucket_listing_cache(ctx.endpoint.id)
        return response
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.delete("/{bucket_name}/lifecycle", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def delete_lifecycle(
    bucket_name: str,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> Response:
    service = BucketsService()
    account = _build_endpoint_account(ctx)
    try:
        service.delete_lifecycle(bucket_name, account)
        _invalidate_bucket_listing_cache(ctx.endpoint.id)
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.get("/{bucket_name}/cors")
def get_cors(
    bucket_name: str,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
):
    service = BucketsService()
    account = _build_endpoint_account(ctx)
    try:
        cors = service.get_bucket_properties(bucket_name, account).cors_rules
        return {"rules": cors or []}
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.put("/{bucket_name}/cors")
def put_cors(
    bucket_name: str,
    payload: BucketCorsUpdate,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
):
    service = BucketsService()
    account = _build_endpoint_account(ctx)
    try:
        service.set_cors(bucket_name, account, rules=payload.rules)
        _invalidate_bucket_listing_cache(ctx.endpoint.id)
        return {"rules": payload.rules}
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.delete("/{bucket_name}/cors", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def delete_cors(
    bucket_name: str,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> Response:
    service = BucketsService()
    account = _build_endpoint_account(ctx)
    try:
        service.delete_cors(bucket_name, account)
        _invalidate_bucket_listing_cache(ctx.endpoint.id)
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.get("/{bucket_name}/policy", response_model=BucketPolicyOut)
def get_policy(
    bucket_name: str,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> BucketPolicyOut:
    service = BucketsService()
    account = _build_endpoint_account(ctx)
    try:
        policy = service.get_policy(bucket_name, account)
        return BucketPolicyOut(policy=policy)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.put("/{bucket_name}/policy", response_model=BucketPolicyOut)
def put_policy(
    bucket_name: str,
    payload: BucketPolicyIn,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> BucketPolicyOut:
    service = BucketsService()
    account = _build_endpoint_account(ctx)
    try:
        service.put_policy(bucket_name, account, payload.policy)
        _invalidate_bucket_listing_cache(ctx.endpoint.id)
        return BucketPolicyOut(policy=payload.policy)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.delete("/{bucket_name}/policy", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def delete_policy(
    bucket_name: str,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> Response:
    service = BucketsService()
    account = _build_endpoint_account(ctx)
    try:
        service.delete_policy(bucket_name, account)
        _invalidate_bucket_listing_cache(ctx.endpoint.id)
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.get("/{bucket_name}/notifications", response_model=BucketNotificationConfiguration)
def get_notifications(
    bucket_name: str,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> BucketNotificationConfiguration:
    service = BucketsService()
    account = _build_endpoint_account(ctx)
    try:
        return service.get_bucket_notifications(bucket_name, account)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.put("/{bucket_name}/notifications", response_model=BucketNotificationConfiguration)
def put_notifications(
    bucket_name: str,
    payload: BucketNotificationConfiguration,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> BucketNotificationConfiguration:
    service = BucketsService()
    account = _build_endpoint_account(ctx)
    try:
        configuration = payload.configuration or {}
        response = service.set_bucket_notifications(bucket_name, account, configuration)
        _invalidate_bucket_listing_cache(ctx.endpoint.id)
        return response
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.delete("/{bucket_name}/notifications", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def delete_notifications(
    bucket_name: str,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> Response:
    service = BucketsService()
    account = _build_endpoint_account(ctx)
    try:
        service.delete_bucket_notifications(bucket_name, account)
        _invalidate_bucket_listing_cache(ctx.endpoint.id)
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.get("/{bucket_name}/logging", response_model=BucketLoggingConfiguration)
def get_logging(
    bucket_name: str,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> BucketLoggingConfiguration:
    service = BucketsService()
    account = _build_endpoint_account(ctx)
    try:
        return service.get_bucket_logging(bucket_name, account)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.put("/{bucket_name}/logging", response_model=BucketLoggingConfiguration)
def put_logging(
    bucket_name: str,
    payload: BucketLoggingConfiguration,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> BucketLoggingConfiguration:
    service = BucketsService()
    account = _build_endpoint_account(ctx)
    try:
        response = service.set_bucket_logging(bucket_name, account, payload)
        _invalidate_bucket_listing_cache(ctx.endpoint.id)
        return response
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.delete("/{bucket_name}/logging", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def delete_logging(
    bucket_name: str,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> Response:
    service = BucketsService()
    account = _build_endpoint_account(ctx)
    try:
        service.delete_bucket_logging(bucket_name, account)
        _invalidate_bucket_listing_cache(ctx.endpoint.id)
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.get("/{bucket_name}/website", response_model=BucketWebsiteConfiguration)
def get_website(
    bucket_name: str,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> BucketWebsiteConfiguration:
    service = BucketsService()
    account = _build_endpoint_account(ctx)
    try:
        return service.get_bucket_website(bucket_name, account)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.put("/{bucket_name}/website", response_model=BucketWebsiteConfiguration)
def put_website(
    bucket_name: str,
    payload: BucketWebsiteConfiguration,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> BucketWebsiteConfiguration:
    service = BucketsService()
    account = _build_endpoint_account(ctx)
    try:
        response = service.set_bucket_website(bucket_name, account, payload)
        _invalidate_bucket_listing_cache(ctx.endpoint.id)
        return response
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.delete("/{bucket_name}/website", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def delete_website(
    bucket_name: str,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> Response:
    service = BucketsService()
    account = _build_endpoint_account(ctx)
    try:
        service.delete_bucket_website(bucket_name, account)
        _invalidate_bucket_listing_cache(ctx.endpoint.id)
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.get("/{bucket_name}/tags")
def get_tags(
    bucket_name: str,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
):
    service = BucketsService()
    account = _build_endpoint_account(ctx)
    try:
        tags = service.get_bucket_tags(bucket_name, account)
        return {"tags": [tag.model_dump() for tag in tags]}
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.put("/{bucket_name}/tags")
def put_tags(
    bucket_name: str,
    payload: BucketTagsUpdate,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
):
    service = BucketsService()
    account = _build_endpoint_account(ctx)
    try:
        service.set_bucket_tags(bucket_name, account, [t.model_dump() for t in payload.tags])
        _invalidate_bucket_listing_cache(ctx.endpoint.id)
        return {"tags": [t.model_dump() for t in payload.tags]}
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.delete("/{bucket_name}/tags", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def delete_tags(
    bucket_name: str,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> Response:
    service = BucketsService()
    account = _build_endpoint_account(ctx)
    try:
        service.delete_bucket_tags(bucket_name, account)
        _invalidate_bucket_listing_cache(ctx.endpoint.id)
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.get("/{bucket_name}/acl", response_model=BucketAcl)
def get_acl(
    bucket_name: str,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> BucketAcl:
    service = BucketsService()
    account = _build_endpoint_account(ctx)
    try:
        return service.get_bucket_acl(bucket_name, account)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.put("/{bucket_name}/acl", response_model=BucketAcl)
def put_acl(
    bucket_name: str,
    payload: BucketAclUpdate,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> BucketAcl:
    service = BucketsService()
    account = _build_endpoint_account(ctx)
    try:
        response = service.set_bucket_acl(bucket_name, account, payload)
        _invalidate_bucket_listing_cache(ctx.endpoint.id)
        return response
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.get("/{bucket_name}/public-access-block", response_model=BucketPublicAccessBlock)
def get_public_access_block(
    bucket_name: str,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> BucketPublicAccessBlock:
    service = BucketsService()
    account = _build_endpoint_account(ctx)
    try:
        return service.get_public_access_block(bucket_name, account)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.put("/{bucket_name}/public-access-block", response_model=BucketPublicAccessBlock)
def put_public_access_block(
    bucket_name: str,
    payload: BucketPublicAccessBlock,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> BucketPublicAccessBlock:
    service = BucketsService()
    account = _build_endpoint_account(ctx)
    try:
        response = service.set_public_access_block(bucket_name, account, payload)
        _invalidate_bucket_listing_cache(ctx.endpoint.id)
        return response
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.get("/{bucket_name}/object-lock", response_model=BucketObjectLock)
def get_object_lock(
    bucket_name: str,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> BucketObjectLock:
    service = BucketsService()
    account = _build_endpoint_account(ctx)
    try:
        return service.get_object_lock(bucket_name, account)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.put("/{bucket_name}/object-lock", response_model=BucketObjectLock)
def put_object_lock(
    bucket_name: str,
    payload: BucketObjectLockUpdate,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> BucketObjectLock:
    service = BucketsService()
    account = _build_endpoint_account(ctx)
    try:
        response = service.set_object_lock(bucket_name, account, payload)
        _invalidate_bucket_listing_cache(ctx.endpoint.id)
        return response
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.get("/{bucket_name}/encryption", response_model=BucketEncryptionConfiguration)
def get_bucket_encryption(
    bucket_name: str,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> BucketEncryptionConfiguration:
    _require_sse_feature(ctx)
    service = BucketsService()
    account = _build_endpoint_account(ctx)
    try:
        return service.get_bucket_encryption(bucket_name, account)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.put("/{bucket_name}/encryption", response_model=BucketEncryptionConfiguration)
def put_bucket_encryption(
    bucket_name: str,
    payload: BucketEncryptionConfiguration,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> BucketEncryptionConfiguration:
    _require_sse_feature(ctx)
    service = BucketsService()
    account = _build_endpoint_account(ctx)
    try:
        response = service.set_bucket_encryption(bucket_name, account, payload.rules)
        _invalidate_bucket_listing_cache(ctx.endpoint.id)
        return response
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.delete("/{bucket_name}/encryption", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def delete_bucket_encryption(
    bucket_name: str,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> Response:
    _require_sse_feature(ctx)
    service = BucketsService()
    account = _build_endpoint_account(ctx)
    try:
        service.delete_bucket_encryption(bucket_name, account)
        _invalidate_bucket_listing_cache(ctx.endpoint.id)
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
