# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import json
from collections import OrderedDict
from dataclasses import dataclass
from datetime import datetime, timezone
from threading import Lock
from time import monotonic
from typing import Any, Callable, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import ValidationError

from app.models.ceph_admin import (
    CephAdminAccountFilterQuery,
    CephAdminAccountFilterRule,
    CephAdminEntityMetrics,
    CephAdminRgwAccountCreate,
    CephAdminRgwAccountCreateResponse,
    CephAdminRgwAccountConfigUpdate,
    CephAdminRgwAccountDetail,
    CephAdminRgwQuotaConfig,
    CephAdminRgwAccountSummary,
    PaginatedCephAdminAccountsResponse,
)
from app.routers.ceph_admin.dependencies import CephAdminContext, get_ceph_admin_context
from app.services.rgw_admin import RGWAdminError
from app.utils.quota_stats import extract_quota_limits
from app.utils.rgw import extract_bucket_list
from app.utils.storage_endpoint_features import resolve_feature_flags
from app.utils.usage_stats import extract_usage_stats

router = APIRouter(prefix="/ceph-admin/endpoints/{endpoint_id}/accounts", tags=["ceph-admin-accounts"])

ACCOUNTS_LIST_CACHE_TTL_SECONDS = 30.0
ACCOUNTS_LIST_CACHE_MAX_ENTRIES = 64
RGW_ACCOUNTS_PAYLOAD_CACHE_MAX_ENTRIES = 16


@dataclass(frozen=True)
class _AccountsListCacheKey:
    endpoint_id: int
    advanced_filter: str | None
    sort_by: str
    sort_dir: str


@dataclass
class _AccountsListCacheEntry:
    endpoint_id: int
    expires_at: float
    items: list[CephAdminRgwAccountSummary]


@dataclass(frozen=True)
class _RgwAccountsPayloadCacheKey:
    endpoint_id: int


@dataclass
class _RgwAccountsPayloadCacheEntry:
    endpoint_id: int
    expires_at: float
    payload: list[Any]


_ACCOUNTS_LIST_CACHE: OrderedDict[_AccountsListCacheKey, _AccountsListCacheEntry] = OrderedDict()
_ACCOUNTS_LIST_CACHE_LOCK = Lock()
_RGW_ACCOUNTS_PAYLOAD_CACHE: OrderedDict[_RgwAccountsPayloadCacheKey, _RgwAccountsPayloadCacheEntry] = OrderedDict()
_RGW_ACCOUNTS_PAYLOAD_CACHE_LOCK = Lock()


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


def _normalize_optional_str(value: Any) -> Optional[str]:
    if not isinstance(value, str):
        return None
    cleaned = value.strip()
    return cleaned or None


def _parse_int(value: Any) -> Optional[int]:
    if value is None:
        return None
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, (int, float)):
        return int(value)
    if isinstance(value, str):
        cleaned = value.strip()
        if not cleaned:
            return None
        try:
            return int(float(cleaned))
        except ValueError:
            return None
    return None


def _parse_bool(value: Any) -> Optional[bool]:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"true", "1", "yes", "enabled", "enable", "on"}:
            return True
        if normalized in {"false", "0", "no", "disabled", "disable", "off"}:
            return False
    return None


def _fields_set(model: Any) -> set[str]:
    if hasattr(model, "model_fields_set"):
        return set(getattr(model, "model_fields_set"))
    if hasattr(model, "__fields_set__"):
        return set(getattr(model, "__fields_set__"))
    return set()


def _serialize_filter(query: CephAdminAccountFilterQuery | None) -> str | None:
    if not query:
        return None
    payload = query.model_dump(mode="json") if hasattr(query, "model_dump") else query.dict()
    return json.dumps(payload, separators=(",", ":"), sort_keys=True)


def _clone_account(account: CephAdminRgwAccountSummary) -> CephAdminRgwAccountSummary:
    if hasattr(account, "model_copy"):
        return account.model_copy(deep=True)
    if hasattr(account, "copy"):
        return account.copy(deep=True)
    payload = account.model_dump() if hasattr(account, "model_dump") else account.dict()
    return CephAdminRgwAccountSummary(**payload)


def _clone_account_list(items: list[CephAdminRgwAccountSummary]) -> list[CephAdminRgwAccountSummary]:
    return [_clone_account(item) for item in items]


def _parse_advanced_filter(raw: str | None) -> CephAdminAccountFilterQuery | None:
    if raw is None:
        return None
    text = raw.strip()
    if not text:
        return None
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid advanced_filter JSON") from exc
    if not isinstance(parsed, dict):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="advanced_filter must be a JSON object")
    try:
        if hasattr(CephAdminAccountFilterQuery, "model_validate"):
            return CephAdminAccountFilterQuery.model_validate(parsed)
        return CephAdminAccountFilterQuery(**parsed)
    except ValidationError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


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


def _match_account_field_rule(account: CephAdminRgwAccountSummary, rule: CephAdminAccountFilterRule) -> bool:
    field = rule.field
    op = rule.op
    value = getattr(account, field, None)
    if op == "is_null":
        return value is None
    if op == "not_null":
        return value is not None
    if value is None:
        return False

    string_fields = {"account_id", "account_name", "email"}
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


def _match_account_rules(
    account: CephAdminRgwAccountSummary,
    rules: list[CephAdminAccountFilterRule],
    match: str,
) -> bool:
    if not rules:
        return True
    results = [_match_account_field_rule(account, rule) for rule in rules]
    return all(results) if match == "all" else any(results)


def _includes_for_account_fields(fields: set[str]) -> set[str]:
    include: set[str] = set()
    # Listing payload is already enriched with profile/limits/quota via per-account detail fetch.
    # Raw /admin/metadata/account may only expose account ids.
    # Keep per-account enrichment only for fields that are still missing.
    if fields & {"bucket_count", "user_count"}:
        include.add("stats")
    return include


def _extract_count(data: dict[str, Any], keys: tuple[str, ...]) -> Optional[int]:
    for key in keys:
        parsed = _parse_int(data.get(key))
        if parsed is not None:
            return parsed
    return None


def _extract_bucket_count(payload: dict[str, Any]) -> Optional[int]:
    direct = _extract_count(payload, ("bucket_count", "num_buckets", "buckets_count"))
    if direct is not None:
        return direct
    stats = payload.get("stats")
    if isinstance(stats, dict):
        from_stats = _extract_count(stats, ("bucket_count", "num_buckets", "buckets_count"))
        if from_stats is not None:
            return from_stats
    buckets = payload.get("bucket_list") or payload.get("buckets")
    if isinstance(buckets, list):
        return len(buckets)
    return None


def _extract_user_count(payload: dict[str, Any]) -> Optional[int]:
    direct = _extract_count(payload, ("user_count", "users_count", "num_users", "users"))
    if direct is not None:
        return direct
    stats = payload.get("stats")
    if isinstance(stats, dict):
        from_stats = _extract_count(stats, ("user_count", "users_count", "num_users"))
        if from_stats is not None:
            return from_stats
    users = payload.get("user_list")
    if isinstance(users, list):
        return len(users)
    return None


def _extract_quota_enabled(payload: dict[str, Any], keys: tuple[str, ...] = ("quota", "account_quota")) -> Optional[bool]:
    for key in keys:
        value = payload.get(key)
        if isinstance(value, dict):
            parsed = _parse_bool(value.get("enabled"))
            if parsed is not None:
                return parsed
    return None


def _build_account_detail(payload: dict[str, Any], account_id_fallback: str) -> CephAdminRgwAccountDetail:
    account_id = _normalize_optional_str(payload.get("id") or payload.get("account_id")) or account_id_fallback
    account_name = _normalize_optional_str(payload.get("name") or payload.get("account_name") or payload.get("display_name"))
    email = _normalize_optional_str(payload.get("email") or payload.get("mail"))
    limits_payload = payload.get("limits") if isinstance(payload.get("limits"), dict) else {}
    max_users = _parse_int(payload.get("max_users") or limits_payload.get("max_users"))
    max_buckets = _parse_int(payload.get("max_buckets") or limits_payload.get("max_buckets"))
    max_roles = _parse_int(payload.get("max_roles") or limits_payload.get("max_roles"))
    max_groups = _parse_int(payload.get("max_groups") or limits_payload.get("max_groups"))
    max_access_keys = _parse_int(payload.get("max_access_keys") or limits_payload.get("max_access_keys"))
    quota_size, quota_objects = extract_quota_limits(payload, keys=("quota", "account_quota"))
    quota_enabled = _extract_quota_enabled(payload, keys=("quota", "account_quota"))
    quota = None
    if quota_enabled is not None or quota_size is not None or quota_objects is not None:
        quota = CephAdminRgwQuotaConfig(
            enabled=quota_enabled,
            max_size_bytes=quota_size,
            max_objects=quota_objects,
        )
    bucket_quota_size, bucket_quota_objects = extract_quota_limits(payload, keys=("bucket_quota",))
    bucket_quota_enabled = _extract_quota_enabled(payload, keys=("bucket_quota",))
    bucket_quota = None
    if bucket_quota_enabled is not None or bucket_quota_size is not None or bucket_quota_objects is not None:
        bucket_quota = CephAdminRgwQuotaConfig(
            enabled=bucket_quota_enabled,
            max_size_bytes=bucket_quota_size,
            max_objects=bucket_quota_objects,
        )
    return CephAdminRgwAccountDetail(
        account_id=account_id,
        account_name=account_name,
        email=email,
        max_users=max_users,
        max_buckets=max_buckets,
        max_roles=max_roles,
        max_groups=max_groups,
        max_access_keys=max_access_keys,
        bucket_count=_extract_bucket_count(payload),
        user_count=_extract_user_count(payload),
        quota=quota,
        bucket_quota=bucket_quota,
    )


def _invalidate_accounts_listing_cache(endpoint_id: int | None = None) -> None:
    with _ACCOUNTS_LIST_CACHE_LOCK:
        if endpoint_id is None:
            _ACCOUNTS_LIST_CACHE.clear()
        else:
            keys = [key for key in _ACCOUNTS_LIST_CACHE.keys() if key.endpoint_id == endpoint_id]
            for key in keys:
                _ACCOUNTS_LIST_CACHE.pop(key, None)
    with _RGW_ACCOUNTS_PAYLOAD_CACHE_LOCK:
        if endpoint_id is None:
            _RGW_ACCOUNTS_PAYLOAD_CACHE.clear()
        else:
            keys = [key for key in _RGW_ACCOUNTS_PAYLOAD_CACHE.keys() if key.endpoint_id == endpoint_id]
            for key in keys:
                _RGW_ACCOUNTS_PAYLOAD_CACHE.pop(key, None)


def _enrich_accounts(
    accounts: list[CephAdminRgwAccountSummary],
    requested: set[str],
    ctx: CephAdminContext,
) -> list[CephAdminRgwAccountSummary]:
    if not accounts or not requested:
        return accounts
    enriched: list[CephAdminRgwAccountSummary] = []
    for item in accounts:
        account = _clone_account(item)
        try:
            payload = ctx.rgw_admin.get_account(account.account_id, allow_not_found=True)
        except RGWAdminError as exc:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
        if not payload or payload.get("not_found"):
            enriched.append(account)
            continue
        if "profile" in requested:
            if not account.account_name:
                account.account_name = _normalize_optional_str(
                    payload.get("account_name") or payload.get("name") or payload.get("display_name")
                )
            account.email = _normalize_optional_str(payload.get("email") or payload.get("mail"))
        if "limits" in requested:
            limits_payload = payload.get("limits") if isinstance(payload.get("limits"), dict) else {}
            account.max_users = _parse_int(payload.get("max_users") or limits_payload.get("max_users"))
            account.max_buckets = _parse_int(payload.get("max_buckets") or limits_payload.get("max_buckets"))
        if "quota" in requested:
            quota_size, quota_objects = extract_quota_limits(payload, keys=("quota", "account_quota"))
            account.quota_max_size_bytes = quota_size
            account.quota_max_objects = quota_objects
        if "stats" in requested:
            account.bucket_count = _extract_bucket_count(payload)
            account.user_count = _extract_user_count(payload)
        enriched.append(account)
    return enriched


def _prune_accounts_listing_cache(now: float) -> None:
    expired_keys = [key for key, entry in _ACCOUNTS_LIST_CACHE.items() if entry.expires_at <= now]
    for key in expired_keys:
        _ACCOUNTS_LIST_CACHE.pop(key, None)
    while len(_ACCOUNTS_LIST_CACHE) > ACCOUNTS_LIST_CACHE_MAX_ENTRIES:
        _ACCOUNTS_LIST_CACHE.popitem(last=False)


def _prune_rgw_accounts_payload_cache(now: float) -> None:
    expired_keys = [key for key, entry in _RGW_ACCOUNTS_PAYLOAD_CACHE.items() if entry.expires_at <= now]
    for key in expired_keys:
        _RGW_ACCOUNTS_PAYLOAD_CACHE.pop(key, None)
    while len(_RGW_ACCOUNTS_PAYLOAD_CACHE) > RGW_ACCOUNTS_PAYLOAD_CACHE_MAX_ENTRIES:
        _RGW_ACCOUNTS_PAYLOAD_CACHE.popitem(last=False)


def _get_cached_rgw_accounts_payload(ctx: CephAdminContext) -> list[Any]:
    key = _RgwAccountsPayloadCacheKey(endpoint_id=int(getattr(ctx.endpoint, "id", 0) or 0))
    now = monotonic()
    with _RGW_ACCOUNTS_PAYLOAD_CACHE_LOCK:
        _prune_rgw_accounts_payload_cache(now)
        cached = _RGW_ACCOUNTS_PAYLOAD_CACHE.get(key)
        if cached is not None:
            _RGW_ACCOUNTS_PAYLOAD_CACHE.move_to_end(key)
            return cached.payload
    try:
        try:
            payload = ctx.rgw_admin.list_accounts(include_details=True)
        except TypeError:
            payload = ctx.rgw_admin.list_accounts()
    except RGWAdminError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
    expires_at = monotonic() + ACCOUNTS_LIST_CACHE_TTL_SECONDS
    with _RGW_ACCOUNTS_PAYLOAD_CACHE_LOCK:
        _prune_rgw_accounts_payload_cache(monotonic())
        _RGW_ACCOUNTS_PAYLOAD_CACHE[key] = _RgwAccountsPayloadCacheEntry(
            endpoint_id=key.endpoint_id,
            expires_at=expires_at,
            payload=payload or [],
        )
        _RGW_ACCOUNTS_PAYLOAD_CACHE.move_to_end(key)
        _prune_rgw_accounts_payload_cache(monotonic())
    return payload or []


def _get_cached_accounts_listing(
    key: _AccountsListCacheKey,
    builder: Callable[[], list[CephAdminRgwAccountSummary]],
) -> list[CephAdminRgwAccountSummary]:
    now = monotonic()
    with _ACCOUNTS_LIST_CACHE_LOCK:
        _prune_accounts_listing_cache(now)
        cached = _ACCOUNTS_LIST_CACHE.get(key)
        if cached is not None:
            _ACCOUNTS_LIST_CACHE.move_to_end(key)
            return cached.items
    items = builder()
    expires_at = monotonic() + ACCOUNTS_LIST_CACHE_TTL_SECONDS
    with _ACCOUNTS_LIST_CACHE_LOCK:
        _prune_accounts_listing_cache(monotonic())
        _ACCOUNTS_LIST_CACHE[key] = _AccountsListCacheEntry(endpoint_id=key.endpoint_id, expires_at=expires_at, items=items)
        _ACCOUNTS_LIST_CACHE.move_to_end(key)
        _prune_accounts_listing_cache(monotonic())
    return items


@router.get("", response_model=PaginatedCephAdminAccountsResponse)
def list_rgw_accounts(
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=200),
    search: str | None = Query(None),
    advanced_filter: str | None = Query(None),
    sort_by: str = Query("account_id"),
    sort_dir: str = Query("asc"),
    include: list[str] = Query(default=[]),
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> PaginatedCephAdminAccountsResponse:
    include_set = _parse_includes(include)
    requested = include_set & {"profile", "limits", "quota", "stats"}
    simple_search = search.strip() if isinstance(search, str) and search.strip() else None
    parsed_advanced_filter = _parse_advanced_filter(advanced_filter)
    cache_key = _AccountsListCacheKey(
        endpoint_id=int(getattr(ctx.endpoint, "id", 0) or 0),
        advanced_filter=_serialize_filter(parsed_advanced_filter),
        sort_by=sort_by,
        sort_dir=sort_dir,
    )

    def build_listing() -> list[CephAdminRgwAccountSummary]:
        payload = _get_cached_rgw_accounts_payload(ctx)
        results: list[CephAdminRgwAccountSummary] = []
        for entry in payload or []:
            account_id_value = None
            account_name = None
            email = None
            max_users = None
            max_buckets = None
            quota_max_size_bytes = None
            quota_max_objects = None
            bucket_count = None
            user_count = None
            if isinstance(entry, dict):
                account_id_value = entry.get("account_id") or entry.get("id")
                account_name = _normalize_optional_str(
                    entry.get("account_name") or entry.get("name") or entry.get("display_name")
                )
                email = _normalize_optional_str(entry.get("email") or entry.get("mail"))
                limits_payload = entry.get("limits") if isinstance(entry.get("limits"), dict) else {}
                max_users = _parse_int(entry.get("max_users") or limits_payload.get("max_users"))
                max_buckets = _parse_int(entry.get("max_buckets") or limits_payload.get("max_buckets"))
                quota_max_size_bytes, quota_max_objects = extract_quota_limits(entry, keys=("quota", "account_quota"))
                bucket_count = _extract_bucket_count(entry)
                user_count = _extract_user_count(entry)
            else:
                account_id_value = entry
            account_id = str(account_id_value or "").strip()
            if not account_id:
                continue
            results.append(
                CephAdminRgwAccountSummary(
                    account_id=account_id,
                    account_name=account_name,
                    email=email,
                    max_users=max_users,
                    max_buckets=max_buckets,
                    quota_max_size_bytes=quota_max_size_bytes,
                    quota_max_objects=quota_max_objects,
                    bucket_count=bucket_count,
                    user_count=user_count,
                )
            )

        advanced_fields: set[str] = set()
        if parsed_advanced_filter and parsed_advanced_filter.rules:
            advanced_fields = {rule.field for rule in parsed_advanced_filter.rules if rule.field}
        sort_fields = {sort_by} if sort_by else {"account_id"}
        needed_for_listing = _includes_for_account_fields(advanced_fields | sort_fields)
        if needed_for_listing:
            results = _enrich_accounts(results, needed_for_listing, ctx)

        if parsed_advanced_filter and parsed_advanced_filter.rules:
            results = [
                account
                for account in results
                if _match_account_rules(account, parsed_advanced_filter.rules, parsed_advanced_filter.match)
            ]

        def sort_key(item: CephAdminRgwAccountSummary):
            if sort_by in ("account_name", "name"):
                value: Any = item.account_name or item.account_id
            elif sort_by == "email":
                value = item.email
            elif sort_by == "max_users":
                value = item.max_users
            elif sort_by == "max_buckets":
                value = item.max_buckets
            elif sort_by == "quota_max_size_bytes":
                value = item.quota_max_size_bytes
            elif sort_by == "quota_max_objects":
                value = item.quota_max_objects
            elif sort_by == "bucket_count":
                value = item.bucket_count
            elif sort_by == "user_count":
                value = item.user_count
            else:
                value = item.account_id
            if value is None:
                return (1, "")
            if isinstance(value, str):
                return (0, value.lower(), (item.account_id or "").lower())
            return (0, value, (item.account_id or "").lower())

        results.sort(key=sort_key, reverse=sort_dir == "desc")
        return results

    results = _get_cached_accounts_listing(cache_key, build_listing)
    filtered_results = results
    if simple_search:
        search_value = simple_search.lower()
        if parsed_advanced_filter:
            filtered_results = [account for account in filtered_results if search_value in account.account_id.lower()]
        else:
            filtered_results = [
                account
                for account in filtered_results
                if search_value in account.account_id.lower()
                or search_value in (account.account_name or "").lower()
            ]

    total = len(filtered_results)
    start = max(page - 1, 0) * page_size
    end = start + page_size
    page_items = _clone_account_list(filtered_results[start:end])
    has_next = end < total
    requested_for_page = requested & {"stats"}
    if requested_for_page and page_items:
        page_items = _enrich_accounts(page_items, requested_for_page, ctx)

    return PaginatedCephAdminAccountsResponse(
        items=page_items,
        total=total,
        page=page,
        page_size=page_size,
        has_next=has_next,
    )


def _load_account_payload(account_id: str, ctx: CephAdminContext) -> dict[str, Any]:
    normalized_account_id = account_id.strip()
    if not normalized_account_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="account_id is required")
    try:
        payload = ctx.rgw_admin.get_account(normalized_account_id, allow_not_found=True)
    except RGWAdminError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
    if not payload or (isinstance(payload, dict) and payload.get("not_found")):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="RGW account not found")
    if not isinstance(payload, dict):
        return {"payload": payload}
    return payload


@router.post("", response_model=CephAdminRgwAccountCreateResponse, status_code=status.HTTP_201_CREATED)
def create_rgw_account(
    payload: CephAdminRgwAccountCreate,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> CephAdminRgwAccountCreateResponse:
    requested_account_id = payload.account_id.strip() if isinstance(payload.account_id, str) else None
    requested_account_id = requested_account_id or None
    account_name = payload.account_name.strip()
    if not account_name:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="account_name is required")
    try:
        create_result = ctx.rgw_admin.create_account(
            account_id=requested_account_id,
            account_name=account_name,
            email=payload.email,
            max_users=payload.max_users,
            max_buckets=payload.max_buckets,
            max_roles=payload.max_roles,
            max_groups=payload.max_groups,
            max_access_keys=payload.max_access_keys,
            extra_params=payload.extra_params or None,
        )
    except RGWAdminError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
    if isinstance(create_result, dict):
        if create_result.get("conflict"):
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="RGW account already exists")
        if create_result.get("not_found") or create_result.get("not_implemented"):
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="RGW account creation is not supported on this cluster",
            )

    account_id = requested_account_id
    if isinstance(create_result, dict):
        account_id = (
            _normalize_optional_str(create_result.get("id"))
            or _normalize_optional_str(create_result.get("account_id"))
            or account_id
        )
        account_payload = create_result.get("account")
        if not account_id and isinstance(account_payload, dict):
            account_id = (
                _normalize_optional_str(account_payload.get("id"))
                or _normalize_optional_str(account_payload.get("account_id"))
            )
    if not account_id:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Unable to determine created account id from RGW response",
        )

    if payload.quota_enabled is not None or payload.quota_max_size_bytes is not None or payload.quota_max_objects is not None:
        try:
            quota_result = ctx.rgw_admin.set_account_quota(
                account_id,
                max_size_bytes=payload.quota_max_size_bytes,
                max_objects=payload.quota_max_objects,
                quota_type="account",
                enabled=bool(payload.quota_enabled) if payload.quota_enabled is not None else True,
            )
        except RGWAdminError as exc:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
        if isinstance(quota_result, dict) and (quota_result.get("not_found") or quota_result.get("not_implemented")):
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="RGW account quota update is not supported on this cluster",
            )

    if (
        payload.bucket_quota_enabled is not None
        or payload.bucket_quota_max_size_bytes is not None
        or payload.bucket_quota_max_objects is not None
    ):
        try:
            quota_result = ctx.rgw_admin.set_account_quota(
                account_id,
                max_size_bytes=payload.bucket_quota_max_size_bytes,
                max_objects=payload.bucket_quota_max_objects,
                quota_type="bucket",
                enabled=bool(payload.bucket_quota_enabled) if payload.bucket_quota_enabled is not None else True,
            )
        except RGWAdminError as exc:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
        if isinstance(quota_result, dict) and (quota_result.get("not_found") or quota_result.get("not_implemented")):
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="RGW bucket quota update is not supported on this cluster",
            )

    _invalidate_accounts_listing_cache(int(getattr(ctx.endpoint, "id", 0) or 0))
    account_payload = _load_account_payload(account_id, ctx)
    account_detail = _build_account_detail(account_payload, account_id_fallback=account_id)
    return CephAdminRgwAccountCreateResponse(account=account_detail)


@router.get("/{account_id}/detail", response_model=CephAdminRgwAccountDetail)
def get_rgw_account_detail(
    account_id: str,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> CephAdminRgwAccountDetail:
    payload = _load_account_payload(account_id, ctx)
    return _build_account_detail(payload, account_id_fallback=account_id.strip())


@router.put("/{account_id}/config", response_model=CephAdminRgwAccountDetail)
def update_rgw_account_config(
    account_id: str,
    update: CephAdminRgwAccountConfigUpdate,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> CephAdminRgwAccountDetail:
    normalized_account_id = account_id.strip()
    if not normalized_account_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="account_id is required")

    field_set = _fields_set(update)
    should_update_account = bool(
        {"account_name", "email", "max_users", "max_buckets", "max_roles", "max_groups", "max_access_keys"} & field_set
    ) or bool(update.extra_params)
    if should_update_account:
        try:
            update_result = ctx.rgw_admin.update_account(
                normalized_account_id,
                account_name=(
                    update.account_name
                    if "account_name" in field_set and update.account_name is not None
                    else ("" if "account_name" in field_set else None)
                ),
                email=(
                    update.email
                    if "email" in field_set and update.email is not None
                    else ("" if "email" in field_set else None)
                ),
                max_users=(
                    update.max_users
                    if "max_users" in field_set and update.max_users is not None
                    else (0 if "max_users" in field_set else None)
                ),
                max_buckets=(
                    update.max_buckets
                    if "max_buckets" in field_set and update.max_buckets is not None
                    else (0 if "max_buckets" in field_set else None)
                ),
                max_roles=(
                    update.max_roles
                    if "max_roles" in field_set and update.max_roles is not None
                    else (0 if "max_roles" in field_set else None)
                ),
                max_groups=(
                    update.max_groups
                    if "max_groups" in field_set and update.max_groups is not None
                    else (0 if "max_groups" in field_set else None)
                ),
                max_access_keys=(
                    update.max_access_keys
                    if "max_access_keys" in field_set and update.max_access_keys is not None
                    else (0 if "max_access_keys" in field_set else None)
                ),
                extra_params=update.extra_params or None,
            )
            if isinstance(update_result, dict) and (update_result.get("not_found") or update_result.get("not_implemented")):
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail="RGW account update is not supported on this cluster",
                )
        except RGWAdminError as exc:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc

    should_update_quota = bool(
        {"quota_enabled", "quota_max_size_bytes", "quota_max_objects"} & field_set
    )
    if should_update_quota:
        enabled = update.quota_enabled if "quota_enabled" in field_set else True
        max_size_bytes = (
            update.quota_max_size_bytes
            if "quota_max_size_bytes" in field_set and update.quota_max_size_bytes is not None
            else (0 if "quota_max_size_bytes" in field_set else None)
        )
        max_objects = (
            update.quota_max_objects
            if "quota_max_objects" in field_set and update.quota_max_objects is not None
            else (0 if "quota_max_objects" in field_set else None)
        )
        try:
            quota_result = ctx.rgw_admin.set_account_quota(
                normalized_account_id,
                max_size_bytes=max_size_bytes,
                max_objects=max_objects,
                enabled=bool(enabled) if enabled is not None else True,
            )
            if isinstance(quota_result, dict) and (quota_result.get("not_found") or quota_result.get("not_implemented")):
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail="RGW account quota update is not supported on this cluster",
                )
        except RGWAdminError as exc:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc

    should_update_bucket_quota = bool(
        {"bucket_quota_enabled", "bucket_quota_max_size_bytes", "bucket_quota_max_objects"} & field_set
    )
    if should_update_bucket_quota:
        enabled = update.bucket_quota_enabled if "bucket_quota_enabled" in field_set else True
        max_size_bytes = (
            update.bucket_quota_max_size_bytes
            if "bucket_quota_max_size_bytes" in field_set and update.bucket_quota_max_size_bytes is not None
            else (0 if "bucket_quota_max_size_bytes" in field_set else None)
        )
        max_objects = (
            update.bucket_quota_max_objects
            if "bucket_quota_max_objects" in field_set and update.bucket_quota_max_objects is not None
            else (0 if "bucket_quota_max_objects" in field_set else None)
        )
        try:
            quota_result = ctx.rgw_admin.set_account_quota(
                normalized_account_id,
                max_size_bytes=max_size_bytes,
                max_objects=max_objects,
                quota_type="bucket",
                enabled=bool(enabled) if enabled is not None else True,
            )
            if isinstance(quota_result, dict) and (quota_result.get("not_found") or quota_result.get("not_implemented")):
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail="RGW bucket quota update is not supported on this cluster",
                )
        except RGWAdminError as exc:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc

    _invalidate_accounts_listing_cache(int(getattr(ctx.endpoint, "id", 0) or 0))
    payload = _load_account_payload(normalized_account_id, ctx)
    return _build_account_detail(payload, account_id_fallback=normalized_account_id)


@router.get("/{account_id}/metrics", response_model=CephAdminEntityMetrics)
def get_rgw_account_metrics(
    account_id: str,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> CephAdminEntityMetrics:
    if not resolve_feature_flags(ctx.endpoint).metrics_enabled:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Storage metrics are disabled for this endpoint")
    normalized_account_id = account_id.strip()
    if not normalized_account_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="account_id is required")
    try:
        payload = ctx.rgw_admin.get_all_buckets(account_id=normalized_account_id, with_stats=True)
    except RGWAdminError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc

    bucket_usage: list[dict[str, Any]] = []
    total_bytes = 0
    total_objects = 0
    has_bytes = False
    has_objects = False
    for entry in extract_bucket_list(payload):
        if not isinstance(entry, dict):
            continue
        name = entry.get("bucket") or entry.get("name")
        if not name:
            continue
        used_bytes, object_count = extract_usage_stats(entry.get("usage"))
        bucket_usage.append(
            {
                "name": str(name),
                "used_bytes": used_bytes,
                "object_count": object_count,
            }
        )
        if used_bytes is not None:
            total_bytes += int(used_bytes)
            has_bytes = True
        if object_count is not None:
            total_objects += int(object_count)
            has_objects = True
    bucket_usage.sort(key=lambda item: item.get("used_bytes") or 0, reverse=True)
    return CephAdminEntityMetrics(
        total_bytes=total_bytes if has_bytes else None,
        total_objects=total_objects if has_objects else None,
        bucket_count=len(bucket_usage),
        bucket_usage=bucket_usage,
        generated_at=datetime.now(timezone.utc).replace(microsecond=0),
    )


@router.get("/{account_id}")
def get_rgw_account(
    account_id: str,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> dict[str, Any]:
    return _load_account_payload(account_id, ctx)
