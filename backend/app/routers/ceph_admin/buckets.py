# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import json
from collections import OrderedDict
from dataclasses import dataclass
from threading import Lock
from time import monotonic
from typing import Callable

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import ValidationError

from app.db import S3Account
from app.models.bucket import (
    BucketAcl,
    BucketAclUpdate,
    BucketCorsUpdate,
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
    CephAdminBucketFilterQuery,
    CephAdminBucketFilterRule,
    CephAdminBucketSummary,
    PaginatedCephAdminBucketsResponse,
)
from app.routers.ceph_admin.dependencies import CephAdminContext, get_ceph_admin_context
from app.services.buckets_service import BucketsService
from app.services.rgw_admin import RGWAdminError
from app.utils.rgw import extract_bucket_list, is_rgw_account_id
from app.utils.storage_endpoint_features import resolve_feature_flags
from app.utils.usage_stats import extract_usage_stats

router = APIRouter(prefix="/ceph-admin/endpoints/{endpoint_id}/buckets", tags=["ceph-admin-buckets"])

BUCKET_LIST_CACHE_TTL_SECONDS = 30.0
BUCKET_LIST_CACHE_MAX_ENTRIES = 64
RGW_BUCKET_PAYLOAD_CACHE_MAX_ENTRIES = 16


@dataclass(frozen=True)
class _BucketListCacheKey:
    endpoint_id: int
    advanced_filter: str | None
    sort_by: str
    sort_dir: str
    with_stats: bool


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


def _extract_bucket_owner_scope(entry: dict) -> tuple[str | None, str | None]:
    if not isinstance(entry, dict):
        return None, None
    bucket_value = entry.get("bucket")
    tenant_value = entry.get("tenant")
    if tenant_value is None and isinstance(bucket_value, dict):
        tenant_value = bucket_value.get("tenant")
    tenant = _normalize_optional_str(tenant_value)

    owner_value = entry.get("owner") or entry.get("owner_id") or entry.get("user") or entry.get("uid")
    if not owner_value and isinstance(bucket_value, dict):
        owner_value = bucket_value.get("owner") or bucket_value.get("owner_id") or bucket_value.get("user") or bucket_value.get("uid")
    owner = _normalize_optional_str(owner_value)
    if owner and "$" in owner:
        split_tenant, split_uid = _split_tenant_uid(owner)
        if split_tenant:
            tenant = split_tenant
        owner = split_uid or None
    return tenant, owner


def _build_bucket_summary(entry: dict) -> CephAdminBucketSummary | None:
    if not isinstance(entry, dict):
        return None
    bucket_name = _extract_bucket_name(entry)
    if not bucket_name:
        return None
    bucket_value = entry.get("bucket")
    tenant_value = entry.get("tenant")
    if tenant_value is None and isinstance(bucket_value, dict):
        tenant_value = bucket_value.get("tenant")
    tenant = str(tenant_value).strip() if isinstance(tenant_value, str) and tenant_value.strip() else None
    owner_value = entry.get("owner") or entry.get("owner_id") or entry.get("user") or entry.get("uid")
    if not owner_value and isinstance(bucket_value, dict):
        owner_value = bucket_value.get("owner") or bucket_value.get("user") or bucket_value.get("uid")
    owner = str(owner_value).strip() if isinstance(owner_value, str) and owner_value.strip() else None
    usage_bytes, objects = extract_usage_stats(entry.get("usage"))
    quota_size = None
    quota_objects = None
    quota = entry.get("bucket_quota") or entry.get("quota")
    if isinstance(quota, dict):
        max_size = quota.get("max_size") or quota.get("max_size_kb")
        try:
            if max_size is not None:
                quota_size = int(max_size) * (1024 if "max_size_kb" in quota else 1)
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
    bucket_value = entry.get("bucket")
    name = None
    if isinstance(bucket_value, str):
        name = bucket_value
    elif isinstance(bucket_value, dict):
        name = bucket_value.get("name") or bucket_value.get("bucket") or bucket_value.get("bucket_name")
    if not name:
        name = entry.get("name") or entry.get("bucket_name") or entry.get("bucket")
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
) -> str | None:
    if not owner_id:
        return None
    owner_key = f"{tenant or ''}:{owner_id}"
    if owner_key in cache:
        return cache[owner_key]

    name: str | None = None
    try:
        account_payload = ctx.rgw_admin.get_account(owner_id, allow_not_found=True)
    except RGWAdminError:
        account_payload = None
    if isinstance(account_payload, dict) and not account_payload.get("not_found"):
        name = _normalize_optional_str(
            account_payload.get("name")
            or account_payload.get("display_name")
            or account_payload.get("display-name")
        )
        cache[owner_key] = name
        return name

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
        name = _normalize_optional_str(
            user_payload.get("display_name")
            or user_payload.get("display-name")
            or (user_payload.get("user") or {}).get("display_name")
        )
    cache[owner_key] = name
    return name


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
                return None, CephAdminBucketFilterQuery.parse_obj(parsed)
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


def _match_field_rule(bucket: CephAdminBucketSummary, rule: CephAdminBucketFilterRule) -> bool:
    field = rule.field
    op = rule.op
    if not field or not op:
        return False
    value = getattr(bucket, field, None)
    if op == "is_null":
        return value is None
    if op == "not_null":
        return value is not None
    if value is None:
        return False

    string_fields = {"name", "tenant", "owner"}
    if field in string_fields:
        left = _normalize_text(str(value))
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


def _match_rules(bucket: CephAdminBucketSummary, rules: list[CephAdminBucketFilterRule], match: str) -> bool:
    if not rules:
        return True
    results: list[bool] = []
    for rule in rules:
        if rule.field:
            results.append(_match_field_rule(bucket, rule))
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

    enriched: list[CephAdminBucketSummary] = []
    for bucket in buckets:
        tags: list[BucketTag] | None = None
        if wants_tags:
            try:
                tags = service.get_bucket_tags(bucket.name, account)
            except RuntimeError:
                tags = []

        feature_map: dict[str, BucketFeatureStatus] = {}

        if "versioning" in requested:
            try:
                raw = service.get_bucket_versioning_status(bucket.name, account) or "Disabled"
                normalized = str(raw).strip().lower()
                if normalized == "enabled":
                    feature_map["versioning"] = _feature_status_active(raw)
                elif normalized == "suspended":
                    feature_map["versioning"] = BucketFeatureStatus(state=raw, tone="unknown")
                else:
                    feature_map["versioning"] = _feature_status_inactive(raw)
            except RuntimeError:
                feature_map["versioning"] = _feature_status_unavailable()

        if "object_lock" in requested:
            try:
                object_lock = service.get_bucket_object_lock(bucket.name, account)
                enabled = bool(object_lock and object_lock.enabled is True)
                feature_map["object_lock"] = _feature_status_active("Enabled") if enabled else _feature_status_inactive("Disabled")
            except RuntimeError:
                feature_map["object_lock"] = _feature_status_unavailable()

        if "block_public_access" in requested:
            try:
                cfg = service.get_public_access_block(bucket.name, account)
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
            except RuntimeError:
                feature_map["block_public_access"] = _feature_status_unavailable()

        if "lifecycle_rules" in requested:
            try:
                rules = service.get_lifecycle(bucket.name, account).rules or []
                has_rules = bool(rules and len(rules) > 0)
                feature_map["lifecycle_rules"] = _feature_status_active("Enabled") if has_rules else _feature_status_inactive("Disabled")
            except RuntimeError:
                feature_map["lifecycle_rules"] = _feature_status_unavailable()

        if "cors" in requested:
            try:
                rules = service.get_bucket_cors(bucket.name, account) or []
                has_rules = bool(rules and len(rules) > 0)
                feature_map["cors"] = _feature_status_active("Configured") if has_rules else _feature_status_inactive("Not set")
            except RuntimeError:
                feature_map["cors"] = _feature_status_unavailable()

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

        update = {}
        if tags is not None:
            update["tags"] = tags
        if feature_map:
            update["features"] = feature_map
        if update:
            base = bucket.model_dump() if hasattr(bucket, "model_dump") else bucket.dict()
            enriched.append(CephAdminBucketSummary(**{**base, **update}))
        else:
            enriched.append(bucket)
    return enriched


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
    usage_enabled = True
    endpoint = getattr(ctx, "endpoint", None)
    if endpoint is not None and hasattr(endpoint, "provider") and hasattr(endpoint, "features_config"):
        usage_enabled = bool(resolve_feature_flags(endpoint).usage_enabled)
    if not usage_enabled:
        with_stats = False
    elif _filter_requires_stats(advanced_filter):
        with_stats = True

    include_set = _parse_includes(include)
    wants_owner_name = "owner_name" in include_set
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
    }

    cache_key = _BucketListCacheKey(
        endpoint_id=int(getattr(ctx.endpoint, "id", 0) or 0),
        advanced_filter=_serialize_filter(advanced_filter),
        sort_by=sort_by,
        sort_dir=sort_dir,
        with_stats=with_stats,
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
                        for entry in _get_cached_rgw_bucket_entries(ctx, with_stats=with_stats)
                        if _extract_bucket_name(entry) in allowed_names
                    ]
            else:
                entries = _get_cached_rgw_bucket_entries(ctx, with_stats=with_stats)
        except RGWAdminError as exc:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
        results: list[CephAdminBucketSummary] = []
        for entry in entries:
            summary = _build_bucket_summary(entry)
            if summary:
                results.append(summary)

        if advanced_filter and advanced_filter.rules:
            field_rules = [rule for rule in advanced_filter.rules if rule.field]
            feature_rules = [rule for rule in advanced_filter.rules if rule.feature]
            match_mode = advanced_filter.match

            if field_rules and match_mode == "all":
                results = [bucket for bucket in results if all(_match_field_rule(bucket, rule) for rule in field_rules)]
            elif field_rules and match_mode == "any" and not feature_rules:
                results = [bucket for bucket in results if any(_match_field_rule(bucket, rule) for rule in field_rules)]

            if feature_rules:
                filter_features = {rule.feature for rule in feature_rules if rule.feature}
                service = BucketsService()
                account = _build_endpoint_account(ctx)
                results = _enrich_buckets(
                    results,
                    {feature for feature in filter_features if feature != "tags"},
                    include_tags="tags" in filter_features,
                    service=service,
                    account=account,
                )
                if match_mode == "all":
                    results = [bucket for bucket in results if all(_match_feature_rule(bucket, rule) for rule in feature_rules)]
                else:
                    results = [bucket for bucket in results if _match_rules(bucket, advanced_filter.rules, match_mode)]
                for bucket in results:
                    bucket.features = None
                    bucket.tags = None

        def sort_key(bucket: CephAdminBucketSummary):
            value = None
            if sort_by == "tenant":
                value = bucket.tenant or ""
            elif sort_by == "owner":
                value = bucket.owner or ""
            elif sort_by == "used_bytes":
                value = bucket.used_bytes
            elif sort_by == "object_count":
                value = bucket.object_count
            else:
                value = bucket.name
            if value is None:
                return (1, "")
            if isinstance(value, str):
                return (0, value.lower())
            return (0, value)

        results.sort(key=sort_key, reverse=sort_dir == "desc")
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

    requested = {feature for feature in requested_features if feature != "tags"}
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
        owner_cache: dict[str, str | None] = {}
        for bucket in page_items:
            bucket.owner_name = _resolve_owner_name(ctx, bucket.owner, bucket.tenant, owner_cache)

    has_next = end < total
    return PaginatedCephAdminBucketsResponse(
        items=page_items,
        total=total,
        page=page,
        page_size=page_size,
        has_next=has_next,
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
    endpoint = getattr(ctx, "endpoint", None)
    if endpoint is not None and hasattr(endpoint, "provider") and hasattr(endpoint, "features_config") and not resolve_feature_flags(endpoint).usage_enabled:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Usage metrics are disabled for this endpoint")
    service = BucketsService()
    account = _build_endpoint_account(ctx)
    try:
        bucket_info = ctx.rgw_admin.get_bucket_info(bucket_name, stats=False, allow_not_found=True)
    except RGWAdminError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
    if not bucket_info or (isinstance(bucket_info, dict) and bucket_info.get("not_found")):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Bucket not found")

    tenant, owner = _extract_bucket_owner_scope(bucket_info)
    if not owner:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unable to resolve bucket owner for quota update",
        )

    if is_rgw_account_id(owner):
        account.rgw_account_id = owner
        account.rgw_user_uid = None
    else:
        account.rgw_account_id = tenant
        account.rgw_user_uid = owner

    try:
        service.set_bucket_quota(bucket_name, account, payload)
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
