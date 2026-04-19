# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from collections import OrderedDict
from datetime import datetime, timezone
from threading import Lock
from typing import Any, Callable, Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status

from app.models.ceph_admin import (
    CephAdminEntityMetrics,
    CephAdminRgwAccessKey,
    CephAdminRgwAccessKeyStatusChange,
    CephAdminRgwGeneratedAccessKey,
    CephAdminRgwUserCreate,
    CephAdminRgwUserCreateResponse,
    CephAdminRgwQuotaConfig,
    CephAdminRgwUserConfigUpdate,
    CephAdminRgwUserDetail,
    CephAdminUserFilterQuery,
    CephAdminUserFilterRule,
    CephAdminRgwUserSummary,
    PaginatedCephAdminUsersResponse,
)
from app.routers.ceph_admin.listing_common import (
    EndpointCacheEntry as _common_EndpointCacheEntry,
    EndpointListCacheKey as _common_EndpointListCacheKey,
    EndpointPayloadCacheKey as _common_EndpointPayloadCacheKey,
    apply_advanced_filter as _common_apply_advanced_filter,
    apply_simple_search as _common_apply_simple_search,
    coerce_number as _common_coerce_number,
    collect_filter_fields as _common_collect_filter_fields,
    fields_set as _common_fields_set,
    get_or_set_cache as _common_get_or_set_cache,
    invalidate_cache as _common_invalidate_cache,
    normalize_optional_str as _common_normalize_optional_str,
    normalize_text as _common_normalize_text,
    paginate as _common_paginate,
    parse_filter_query as _common_parse_filter_query,
    parse_includes as _common_parse_includes,
    parse_int as _common_parse_int,
    serialize_filter as _common_serialize_filter,
    sort_value as _common_sort_value,
)
from app.routers.ceph_admin.dependencies import CephAdminContext, get_ceph_admin_context
from app.services.rgw_admin import RGWAdminError
from app.utils.quota_stats import extract_quota_limits
from app.utils.rgw import extract_bucket_list
from app.utils.storage_endpoint_features import resolve_feature_flags
from app.utils.usage_stats import compute_usage_ratio_percent, summarize_bucket_usage

router = APIRouter(prefix="/ceph-admin/endpoints/{endpoint_id}/users", tags=["ceph-admin-users"])

USERS_LIST_CACHE_TTL_SECONDS = 30.0
USERS_LIST_CACHE_MAX_ENTRIES = 64
RGW_USERS_PAYLOAD_CACHE_MAX_ENTRIES = 16

_UsersListCacheKey = _common_EndpointListCacheKey
_RgwUsersPayloadCacheKey = _common_EndpointPayloadCacheKey


_USERS_LIST_CACHE: OrderedDict[_UsersListCacheKey, _common_EndpointCacheEntry] = OrderedDict()
_USERS_LIST_CACHE_LOCK = Lock()
_RGW_USERS_PAYLOAD_CACHE: OrderedDict[_RgwUsersPayloadCacheKey, _common_EndpointCacheEntry] = OrderedDict()
_RGW_USERS_PAYLOAD_CACHE_LOCK = Lock()


def _split_tenant_uid(value: str) -> Tuple[Optional[str], str]:
    raw = value.strip()
    if "$" in raw:
        tenant, uid = raw.split("$", 1)
        if tenant and uid:
            return tenant, uid
    return None, raw


def _extract_access_key(payload: dict) -> tuple[Optional[str], Optional[str]]:
    access_key = payload.get("access_key")
    secret_key = payload.get("secret_key")
    return access_key, secret_key


def _parse_includes(include: list[str]) -> set[str]:
    return _common_parse_includes(include)


def _normalize_optional_str(value: Any) -> Optional[str]:
    return _common_normalize_optional_str(value)


def _optional_account_lookup_enabled(ctx: CephAdminContext) -> bool | None:
    try:
        return resolve_feature_flags(ctx.endpoint).account_enabled
    except Exception:
        return None


def _extract_user_payload(raw: dict) -> dict:
    if not isinstance(raw, dict):
        return {}
    user_payload = raw.get("user")
    if isinstance(user_payload, dict):
        return user_payload
    return raw


def _extract_user_setting(payload: dict[str, Any], user_payload: dict[str, Any], *keys: str) -> Optional[str]:
    for key in keys:
        value = _normalize_optional_str(user_payload.get(key))
        if value is not None:
            return value
        value = _normalize_optional_str(payload.get(key))
        if value is not None:
            return value
    return None


def _parse_suspended(raw: Any) -> Optional[bool]:
    if isinstance(raw, bool):
        return raw
    if isinstance(raw, (int, float)):
        return bool(raw)
    if isinstance(raw, str):
        normalized = raw.strip().lower()
        if normalized in {"true", "1", "yes", "suspended", "enabled"}:
            return True
        if normalized in {"false", "0", "no", "disabled", "active"}:
            return False
    return None


def _parse_int(value: Any) -> Optional[int]:
    return _common_parse_int(value)


def _fields_set(model: Any) -> set[str]:
    return _common_fields_set(model)


def _serialize_filter(query: CephAdminUserFilterQuery | None) -> str | None:
    return _common_serialize_filter(query)


def _clone_user(user: CephAdminRgwUserSummary) -> CephAdminRgwUserSummary:
    if hasattr(user, "model_copy"):
        return user.model_copy(deep=True)
    if hasattr(user, "copy"):
        return user.copy(deep=True)
    payload = user.model_dump() if hasattr(user, "model_dump") else user.dict()
    return CephAdminRgwUserSummary(**payload)


def _clone_user_list(items: list[CephAdminRgwUserSummary]) -> list[CephAdminRgwUserSummary]:
    return [_clone_user(item) for item in items]


def _clear_optional_user_details(item: CephAdminRgwUserSummary) -> None:
    item.account_id = None
    item.account_name = None
    item.full_name = None
    item.email = None
    item.suspended = None
    item.max_buckets = None
    item.quota_max_size_bytes = None
    item.quota_max_objects = None
    item.used_bytes = None
    item.object_count = None


def _parse_advanced_filter(raw: str | None) -> CephAdminUserFilterQuery | None:
    return _common_parse_filter_query(raw, query_cls=CephAdminUserFilterQuery)


def _normalize_text(value: str) -> str:
    return _common_normalize_text(value)


def _coerce_number(value: object) -> float | None:
    return _common_coerce_number(value)


def _coerce_bool(value: object) -> bool | None:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"true", "1", "yes", "y", "on", "enabled", "suspended"}:
            return True
        if normalized in {"false", "0", "no", "n", "off", "disabled", "active"}:
            return False
    return None


def _match_user_field_rule(user: CephAdminRgwUserSummary, rule: CephAdminUserFilterRule) -> bool:
    field = rule.field
    op = rule.op
    if field == "quota_usage_size_percent":
        value = compute_usage_ratio_percent(user.used_bytes, user.quota_max_size_bytes)
    elif field == "quota_usage_object_percent":
        value = compute_usage_ratio_percent(user.object_count, user.quota_max_objects)
    else:
        value = getattr(user, field, None)
    if op == "is_null":
        return value is None
    if op == "not_null":
        return value is not None

    if field == "suspended":
        left_bool = _coerce_bool(value)
        if left_bool is None:
            # Treat missing suspended flag as active.
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

    string_fields = {"uid", "tenant", "account_id", "account_name", "full_name", "email"}
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


def _match_user_rules(
    user: CephAdminRgwUserSummary,
    rules: list[CephAdminUserFilterRule],
    match: str,
) -> bool:
    if not rules:
        return True
    results = [_match_user_field_rule(user, rule) for rule in rules]
    return all(results) if match == "all" else any(results)


def _includes_for_user_fields(fields: set[str]) -> set[str]:
    include: set[str] = set()
    if fields & {"account_id", "account_name"}:
        include.add("account")
    if fields & {"full_name", "email"}:
        include.add("profile")
    if "suspended" in fields:
        include.add("status")
    if "max_buckets" in fields:
        include.add("limits")
    if fields & {"quota_max_size_bytes", "quota_max_objects", "quota_usage_size_percent", "quota_usage_object_percent"}:
        include.add("quota")
    if fields & {"used_bytes", "object_count", "quota_usage_size_percent", "quota_usage_object_percent"}:
        include.add("usage")
    return include


def _enrich_users(
    users: list[CephAdminRgwUserSummary],
    requested: set[str],
    ctx: CephAdminContext,
) -> list[CephAdminRgwUserSummary]:
    if not users or not requested:
        return users
    account_name_by_id: dict[str, Optional[str]] = {}
    enriched: list[CephAdminRgwUserSummary] = []
    for item in users:
        user = _clone_user(item)
        try:
            payload = ctx.rgw_admin.get_user(user.uid, tenant=user.tenant, allow_not_found=True)
        except RGWAdminError as exc:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
        if not payload or payload.get("not_found"):
            enriched.append(user)
            continue
        user_payload = _extract_user_payload(payload)
        account_id = _normalize_optional_str(payload.get("account_id") or user_payload.get("account_id"))
        if "account" in requested:
            user.account_id = account_id
            payload_account_name = _normalize_optional_str(
                payload.get("account_name") or user_payload.get("account_name")
            )
            if account_id:
                if account_id not in account_name_by_id:
                    account_payload = None
                    if _optional_account_lookup_enabled(ctx) is not False:
                        try:
                            account_payload = ctx.rgw_admin.get_account(
                                account_id,
                                allow_not_found=True,
                                allow_not_implemented=True,
                            )
                        except RGWAdminError as exc:
                            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
                    account_name_by_id[account_id] = _normalize_optional_str(
                        account_payload.get("name") if isinstance(account_payload, dict) else None
                    )
                user.account_name = account_name_by_id.get(account_id) or payload_account_name
            else:
                user.account_name = payload_account_name
        if "profile" in requested:
            user.full_name = _normalize_optional_str(user_payload.get("display_name") or payload.get("display_name"))
            user.email = _normalize_optional_str(user_payload.get("email") or payload.get("email"))
        if "status" in requested:
            user.suspended = _parse_suspended(user_payload.get("suspended") or payload.get("suspended"))
        if "limits" in requested:
            user.max_buckets = _parse_int(user_payload.get("max_buckets") or payload.get("max_buckets"))
        if "quota" in requested:
            quota_size, quota_objects = extract_quota_limits(payload, keys=("user_quota", "quota"))
            user.quota_max_size_bytes = quota_size
            user.quota_max_objects = quota_objects
        if "usage" in requested:
            lookup_uid = f"{user.tenant}${user.uid}" if user.tenant else user.uid
            try:
                buckets_payload = ctx.rgw_admin.get_all_buckets(uid=lookup_uid, with_stats=True)
            except RGWAdminError as exc:
                raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
            _bucket_usage, total_bytes, total_objects, _bucket_count = summarize_bucket_usage(
                extract_bucket_list(buckets_payload)
            )
            user.used_bytes = total_bytes
            user.object_count = total_objects
        enriched.append(user)
    return enriched


def _get_cached_rgw_users_payload(ctx: CephAdminContext) -> list[Any]:
    key = _RgwUsersPayloadCacheKey(endpoint_id=int(getattr(ctx.endpoint, "id", 0) or 0))
    def _fetch_payload() -> list[Any]:
        try:
            payload = ctx.rgw_admin.list_users()
        except RGWAdminError as exc:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
        return payload or []

    return _common_get_or_set_cache(
        _RGW_USERS_PAYLOAD_CACHE,
        _RGW_USERS_PAYLOAD_CACHE_LOCK,
        key,
        ttl_seconds=USERS_LIST_CACHE_TTL_SECONDS,
        max_entries=RGW_USERS_PAYLOAD_CACHE_MAX_ENTRIES,
        builder=_fetch_payload,
    )


def _get_cached_users_listing(
    key: _UsersListCacheKey,
    builder: Callable[[], list[CephAdminRgwUserSummary]],
) -> list[CephAdminRgwUserSummary]:
    return _common_get_or_set_cache(
        _USERS_LIST_CACHE,
        _USERS_LIST_CACHE_LOCK,
        key,
        ttl_seconds=USERS_LIST_CACHE_TTL_SECONDS,
        max_entries=USERS_LIST_CACHE_MAX_ENTRIES,
        builder=builder,
    )


def _invalidate_users_listing_cache(endpoint_id: int | None = None) -> None:
    _common_invalidate_cache(_USERS_LIST_CACHE, _USERS_LIST_CACHE_LOCK, endpoint_id=endpoint_id)
    _common_invalidate_cache(_RGW_USERS_PAYLOAD_CACHE, _RGW_USERS_PAYLOAD_CACHE_LOCK, endpoint_id=endpoint_id)


def _extract_quota_enabled(payload: dict[str, Any], keys: tuple[str, ...] = ("user_quota", "quota")) -> Optional[bool]:
    for key in keys:
        value = payload.get(key)
        if isinstance(value, dict):
            parsed = _coerce_bool(value.get("enabled"))
            if parsed is not None:
                return parsed
    return None


def _extract_caps(payload: dict[str, Any]) -> list[str]:
    values = payload.get("caps")
    if values is None and isinstance(payload.get("user"), dict):
        values = payload["user"].get("caps")
    result: list[str] = []
    if isinstance(values, dict):
        for key, value in values.items():
            key_value = _normalize_optional_str(key)
            perm_value = _normalize_optional_str(value)
            if key_value and perm_value:
                result.append(f"{key_value}={perm_value}")
    elif isinstance(values, list):
        for entry in values:
            if isinstance(entry, dict):
                cap_type = _normalize_optional_str(entry.get("type"))
                perm = _normalize_optional_str(entry.get("perm"))
                if cap_type and perm:
                    result.append(f"{cap_type}={perm}")
                elif cap_type:
                    result.append(cap_type)
            elif isinstance(entry, str):
                cleaned = entry.strip()
                if cleaned:
                    result.append(cleaned)
    elif isinstance(values, str):
        cleaned = values.strip()
        if cleaned:
            result.append(cleaned)
    # Keep insertion order while removing duplicates.
    return list(dict.fromkeys(result))


def _parse_key_status(status_value: Any) -> tuple[Optional[str], Optional[bool]]:
    if status_value is None:
        return None, None
    status_text = str(status_value).strip()
    if not status_text:
        return None, None
    normalized = status_text.lower()
    if normalized in {"enabled", "active", "true", "1"}:
        return status_text, True
    if normalized in {"disabled", "inactive", "suspended", "false", "0"}:
        return status_text, False
    return status_text, None


def _serialize_access_key(entry: dict[str, Any]) -> Optional[CephAdminRgwAccessKey]:
    access_key_value = entry.get("access_key") or entry.get("access_key_id")
    access_key = _normalize_optional_str(access_key_value)
    if not access_key:
        return None
    secret_key = _normalize_optional_str(entry.get("secret_key"))
    status_text, is_active = _parse_key_status(entry.get("status") or entry.get("key_status") or entry.get("state"))
    return CephAdminRgwAccessKey(
        access_key=access_key,
        secret_key=secret_key,
        status=status_text,
        is_active=is_active,
        created_at=entry.get("create_date") or entry.get("created_at"),
        user=_normalize_optional_str(entry.get("user") or entry.get("uid")),
        subuser=_normalize_optional_str(entry.get("subuser")),
    )


def _serialize_access_keys(entries: list[dict]) -> list[CephAdminRgwAccessKey]:
    results: list[CephAdminRgwAccessKey] = []
    seen: set[str] = set()
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        serialized = _serialize_access_key(entry)
        if not serialized:
            continue
        if serialized.access_key in seen:
            continue
        seen.add(serialized.access_key)
        results.append(serialized)
    return results


def _resolve_user_identity(
    payload: dict[str, Any],
    *,
    uid_fallback: str,
    tenant_fallback: Optional[str],
) -> tuple[Optional[str], str]:
    user_payload = _extract_user_payload(payload)
    uid_raw = _normalize_optional_str(user_payload.get("uid") or payload.get("uid")) or uid_fallback
    tenant = tenant_fallback
    uid = uid_raw
    if "$" in uid_raw:
        split_tenant, split_uid = _split_tenant_uid(uid_raw)
        tenant = split_tenant
        uid = split_uid
    return tenant, uid


def _build_user_detail(
    payload: dict[str, Any],
    *,
    uid_fallback: str,
    tenant_fallback: Optional[str],
    account_name: Optional[str] = None,
    keys: Optional[list[CephAdminRgwAccessKey]] = None,
) -> CephAdminRgwUserDetail:
    user_payload = _extract_user_payload(payload)
    tenant, uid = _resolve_user_identity(payload, uid_fallback=uid_fallback, tenant_fallback=tenant_fallback)
    account_id = _normalize_optional_str(payload.get("account_id") or user_payload.get("account_id"))
    quota_size, quota_objects = extract_quota_limits(payload, keys=("user_quota", "quota"))
    quota_enabled = _extract_quota_enabled(payload, keys=("user_quota", "quota"))
    quota = None
    if quota_enabled is not None or quota_size is not None or quota_objects is not None:
        quota = CephAdminRgwQuotaConfig(
            enabled=quota_enabled,
            max_size_bytes=quota_size,
            max_objects=quota_objects,
        )
    return CephAdminRgwUserDetail(
        uid=uid,
        tenant=tenant,
        display_name=_normalize_optional_str(user_payload.get("display_name") or payload.get("display_name")),
        email=_normalize_optional_str(user_payload.get("email") or payload.get("email")),
        account_id=account_id,
        account_name=account_name,
        suspended=_parse_suspended(user_payload.get("suspended") or payload.get("suspended")),
        admin=_coerce_bool(user_payload.get("admin") if "admin" in user_payload else payload.get("admin")),
        system=_coerce_bool(user_payload.get("system") if "system" in user_payload else payload.get("system")),
        account_root=_coerce_bool(user_payload.get("account_root") or payload.get("account_root")),
        max_buckets=_parse_int(user_payload.get("max_buckets") or payload.get("max_buckets")),
        op_mask=_normalize_optional_str(user_payload.get("op_mask") or payload.get("op_mask")),
        default_placement=_extract_user_setting(
            payload,
            user_payload,
            "default_placement",
            "default_placement_rule",
        ),
        default_storage_class=_extract_user_setting(
            payload,
            user_payload,
            "default_storage_class",
        ),
        caps=_extract_caps(payload),
        quota=quota,
        keys=keys or [],
    )


def _load_user_payload(uid: str, tenant: Optional[str], ctx: CephAdminContext) -> dict[str, Any]:
    normalized_uid = uid.strip()
    if not normalized_uid:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="uid is required")
    try:
        payload = ctx.rgw_admin.get_user(normalized_uid, tenant=tenant, allow_not_found=True)
    except RGWAdminError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
    if not payload or (isinstance(payload, dict) and payload.get("not_found")):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="RGW user not found")
    if not isinstance(payload, dict):
        return {"payload": payload}
    return payload


def _resolve_account_name(
    account_id: Optional[str],
    ctx: CephAdminContext,
    *,
    payload_account_name: Optional[str] = None,
) -> Optional[str]:
    if not account_id:
        return payload_account_name
    if _optional_account_lookup_enabled(ctx) is False:
        return payload_account_name
    try:
        account_payload = ctx.rgw_admin.get_account(
            account_id,
            allow_not_found=True,
            allow_not_implemented=True,
        )
    except RGWAdminError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
    if not isinstance(account_payload, dict) or account_payload.get("not_found"):
        return payload_account_name
    return _normalize_optional_str(
        account_payload.get("name") or account_payload.get("display_name") or account_payload.get("account_name")
    ) or payload_account_name


def _build_metrics_from_buckets(payload: Any) -> CephAdminEntityMetrics:
    bucket_usage, total_bytes, total_objects, bucket_count = summarize_bucket_usage(extract_bucket_list(payload))
    return CephAdminEntityMetrics(
        total_bytes=total_bytes,
        total_objects=total_objects,
        bucket_count=bucket_count,
        bucket_usage=bucket_usage,
        generated_at=datetime.now(timezone.utc).replace(microsecond=0),
    )


def _extract_generated_key_from_payload(raw: Any, rgw_admin: Any) -> Optional[CephAdminRgwGeneratedAccessKey]:
    entries = rgw_admin._extract_keys(raw) if hasattr(rgw_admin, "_extract_keys") else []
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        access_key, secret_key = _extract_access_key(entry)
        if access_key and secret_key:
            return CephAdminRgwGeneratedAccessKey(access_key=access_key, secret_key=secret_key)
    return None


def _apply_caps_update(
    uid: str,
    tenant: Optional[str],
    mode: str,
    values: list[str],
    ctx: CephAdminContext,
) -> None:
    caps_values = [str(value).strip() for value in values if str(value).strip()]
    caps_values = list(dict.fromkeys(caps_values))
    try:
        current_payload = _load_user_payload(uid, tenant, ctx)
        existing_caps = _extract_caps(current_payload)
        if mode == "replace":
            if existing_caps:
                ctx.rgw_admin.set_user_caps(uid, existing_caps, tenant=tenant, op="rm")
            if caps_values:
                ctx.rgw_admin.set_user_caps(uid, caps_values, tenant=tenant, op="add")
        elif mode == "add":
            if caps_values:
                ctx.rgw_admin.set_user_caps(uid, caps_values, tenant=tenant, op="add")
        else:
            if caps_values:
                ctx.rgw_admin.set_user_caps(uid, caps_values, tenant=tenant, op="rm")
    except RGWAdminError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.get("", response_model=PaginatedCephAdminUsersResponse)
def list_rgw_users(
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=200),
    search: str | None = Query(None),
    advanced_filter: str | None = Query(None),
    sort_by: str = Query("uid"),
    sort_dir: str = Query("asc"),
    include: list[str] = Query(default=[]),
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> PaginatedCephAdminUsersResponse:
    include_set = _parse_includes(include)
    requested = include_set & {"account", "profile", "status", "limits", "quota"}
    parsed_advanced_filter = _parse_advanced_filter(advanced_filter)
    cache_key = _UsersListCacheKey(
        endpoint_id=int(getattr(ctx.endpoint, "id", 0) or 0),
        advanced_filter=_serialize_filter(parsed_advanced_filter),
        sort_by=sort_by,
        sort_dir=sort_dir,
    )

    def build_listing() -> list[CephAdminRgwUserSummary]:
        payload = _get_cached_rgw_users_payload(ctx)
        results: list[CephAdminRgwUserSummary] = []
        for entry in payload or []:
            uid_value = None
            if isinstance(entry, dict):
                uid_value = entry.get("user") or entry.get("uid") or entry.get("id")
            else:
                uid_value = entry
            uid = str(uid_value or "").strip()
            if not uid:
                continue
            tenant, user_uid = _split_tenant_uid(uid)
            results.append(CephAdminRgwUserSummary(uid=user_uid if tenant else uid, tenant=tenant))

        advanced_fields = _common_collect_filter_fields(parsed_advanced_filter)
        sort_fields = {sort_by} if sort_by else {"uid"}
        needed_for_listing = _includes_for_user_fields(advanced_fields | sort_fields)
        if needed_for_listing:
            results = _enrich_users(results, needed_for_listing, ctx)

        results = _common_apply_advanced_filter(results, parsed_advanced_filter, _match_user_rules)

        def sort_key(item: CephAdminRgwUserSummary):
            if sort_by == "tenant":
                value: Any = item.tenant or ""
            elif sort_by == "account_name":
                value = item.account_name or item.account_id or ""
            elif sort_by == "full_name":
                value = item.full_name or ""
            elif sort_by == "email":
                value = item.email or ""
            elif sort_by == "suspended":
                value = -1 if item.suspended is None else int(bool(item.suspended))
            elif sort_by == "max_buckets":
                value = item.max_buckets
            elif sort_by == "quota_max_size_bytes":
                value = item.quota_max_size_bytes
            elif sort_by == "quota_max_objects":
                value = item.quota_max_objects
            else:
                value = item.uid
            return _common_sort_value(value, item.uid or "")

        results.sort(key=sort_key, reverse=sort_dir == "desc")
        if needed_for_listing:
            for user in results:
                _clear_optional_user_details(user)
        return results

    results = _get_cached_users_listing(cache_key, build_listing)
    filtered_results = _common_apply_simple_search(
        results,
        search=search,
        parsed_filter=parsed_advanced_filter,
        match_with_filter=lambda user, needle: needle in user.uid.lower(),
        match_without_filter=lambda user, needle: (
            needle in user.uid.lower() or needle in (user.tenant or "").lower()
        ),
    )
    page_items, total, has_next = _common_paginate(
        filtered_results,
        page=page,
        page_size=page_size,
        clone=_clone_user_list,
    )
    if requested and page_items:
        page_items = _enrich_users(page_items, requested, ctx)

    return PaginatedCephAdminUsersResponse(
        items=page_items,
        total=total,
        page=page,
        page_size=page_size,
        has_next=has_next,
    )


@router.post("", response_model=CephAdminRgwUserCreateResponse, status_code=status.HTTP_201_CREATED)
def create_rgw_user(
    payload: CephAdminRgwUserCreate,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> CephAdminRgwUserCreateResponse:
    uid = payload.uid.strip()
    if not uid:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="uid is required")
    tenant = payload.tenant.strip() if isinstance(payload.tenant, str) else None
    tenant = tenant or None
    account_id = payload.account_id.strip() if isinstance(payload.account_id, str) else None
    account_id = account_id or None
    if account_id and tenant:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="tenant cannot be combined with account_id")

    try:
        if account_id:
            create_result = ctx.rgw_admin.create_user_with_account_id(
                uid=uid,
                account_id=account_id,
                display_name=payload.display_name or uid,
                account_root=bool(payload.account_root) if payload.account_root is not None else False,
                email=payload.email,
                generate_key=bool(payload.generate_key),
                extra_params=payload.extra_params or None,
            )
            lookup_tenant: Optional[str] = None
        else:
            create_result = ctx.rgw_admin.create_user(
                uid=uid,
                display_name=payload.display_name or uid,
                email=payload.email,
                tenant=tenant,
                generate_key=bool(payload.generate_key),
                extra_params=payload.extra_params or None,
            )
            lookup_tenant = tenant
    except RGWAdminError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc

    if isinstance(create_result, dict):
        if create_result.get("conflict"):
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="RGW user already exists")
        if create_result.get("not_found") or create_result.get("not_implemented"):
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="RGW user creation is not supported on this cluster",
            )

    field_set = _fields_set(payload)
    should_update_user = bool(
        {"display_name", "email", "suspended", "max_buckets", "op_mask", "admin", "system", "account_root"} & field_set
    )
    if should_update_user:
        try:
            update_result = ctx.rgw_admin.update_user(
                uid,
                tenant=lookup_tenant,
                display_name=payload.display_name if "display_name" in field_set else None,
                email=payload.email if "email" in field_set else None,
                suspended=payload.suspended if "suspended" in field_set else None,
                max_buckets=payload.max_buckets if "max_buckets" in field_set else None,
                op_mask=payload.op_mask if "op_mask" in field_set else None,
                admin=payload.admin if "admin" in field_set else None,
                system=payload.system if "system" in field_set else None,
                account_root=payload.account_root if "account_root" in field_set else None,
            )
        except RGWAdminError as exc:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
        if isinstance(update_result, dict) and (update_result.get("not_found") or update_result.get("not_implemented")):
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="RGW user update is not supported on this cluster",
            )

    if payload.caps is not None:
        _apply_caps_update(uid, lookup_tenant, payload.caps.mode, payload.caps.values, ctx)

    if payload.quota_enabled is not None or payload.quota_max_size_bytes is not None or payload.quota_max_objects is not None:
        try:
            quota_result = ctx.rgw_admin.set_user_quota(
                uid,
                tenant=lookup_tenant,
                max_size_bytes=payload.quota_max_size_bytes,
                max_objects=payload.quota_max_objects,
                enabled=bool(payload.quota_enabled) if payload.quota_enabled is not None else True,
            )
        except RGWAdminError as exc:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
        if isinstance(quota_result, dict) and (quota_result.get("not_found") or quota_result.get("not_implemented")):
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="RGW user quota update is not supported on this cluster",
            )

    _invalidate_users_listing_cache(int(getattr(ctx.endpoint, "id", 0) or 0))
    user_payload = _load_user_payload(uid, lookup_tenant, ctx)
    resolved_account_id = _normalize_optional_str(
        user_payload.get("account_id") or _extract_user_payload(user_payload).get("account_id")
    )
    account_name = _resolve_account_name(
        resolved_account_id,
        ctx,
        payload_account_name=_normalize_optional_str(
            user_payload.get("account_name") or _extract_user_payload(user_payload).get("account_name")
        ),
    )
    keys = _serialize_access_keys(ctx.rgw_admin.list_user_keys(uid, tenant=lookup_tenant))
    detail = _build_user_detail(
        user_payload,
        uid_fallback=uid,
        tenant_fallback=lookup_tenant,
        account_name=account_name,
        keys=keys,
    )
    generated_key = _extract_generated_key_from_payload(create_result, ctx.rgw_admin)
    return CephAdminRgwUserCreateResponse(detail=detail, generated_key=generated_key)


@router.get("/{user_id}")
def get_rgw_user(
    user_id: str,
    tenant: Optional[str] = None,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> dict[str, Any]:
    return _load_user_payload(user_id, tenant, ctx)


@router.get("/{user_id}/detail", response_model=CephAdminRgwUserDetail)
def get_rgw_user_detail(
    user_id: str,
    tenant: Optional[str] = None,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> CephAdminRgwUserDetail:
    payload = _load_user_payload(user_id, tenant, ctx)
    account_id = _normalize_optional_str(payload.get("account_id") or _extract_user_payload(payload).get("account_id"))
    account_name = _resolve_account_name(
        account_id,
        ctx,
        payload_account_name=_normalize_optional_str(
            payload.get("account_name") or _extract_user_payload(payload).get("account_name")
        ),
    )
    keys = _serialize_access_keys(ctx.rgw_admin.list_user_keys(user_id.strip(), tenant=tenant))
    return _build_user_detail(
        payload,
        uid_fallback=user_id.strip(),
        tenant_fallback=tenant,
        account_name=account_name,
        keys=keys,
    )


@router.put("/{user_id}/config", response_model=CephAdminRgwUserDetail)
def update_rgw_user_config(
    user_id: str,
    update: CephAdminRgwUserConfigUpdate,
    tenant: Optional[str] = None,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> CephAdminRgwUserDetail:
    uid = user_id.strip()
    if not uid:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="uid is required")
    field_set = _fields_set(update)
    should_update_user = bool(
        {"display_name", "email", "suspended", "max_buckets", "op_mask", "admin", "system", "account_root"} & field_set
    ) or bool(update.extra_params)
    if should_update_user:
        try:
            update_result = ctx.rgw_admin.update_user(
                uid,
                tenant=tenant,
                display_name=(
                    update.display_name
                    if "display_name" in field_set and update.display_name is not None
                    else ("" if "display_name" in field_set else None)
                ),
                email=(
                    update.email
                    if "email" in field_set and update.email is not None
                    else ("" if "email" in field_set else None)
                ),
                suspended=update.suspended if "suspended" in field_set else None,
                max_buckets=(
                    update.max_buckets
                    if "max_buckets" in field_set and update.max_buckets is not None
                    else (0 if "max_buckets" in field_set else None)
                ),
                op_mask=(
                    update.op_mask
                    if "op_mask" in field_set and update.op_mask is not None
                    else ("" if "op_mask" in field_set else None)
                ),
                admin=update.admin if "admin" in field_set else None,
                system=update.system if "system" in field_set else None,
                account_root=update.account_root if "account_root" in field_set else None,
                extra_params=update.extra_params or None,
            )
            if isinstance(update_result, dict) and (update_result.get("not_found") or update_result.get("not_implemented")):
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail="RGW user update is not supported on this cluster",
                )
        except RGWAdminError as exc:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc

    if "caps" in field_set and update.caps is not None:
        _apply_caps_update(uid, tenant, update.caps.mode, update.caps.values, ctx)

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
            quota_result = ctx.rgw_admin.set_user_quota(
                uid,
                tenant=tenant,
                max_size_bytes=max_size_bytes,
                max_objects=max_objects,
                enabled=bool(enabled) if enabled is not None else True,
            )
            if isinstance(quota_result, dict) and (quota_result.get("not_found") or quota_result.get("not_implemented")):
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail="RGW user quota update is not supported on this cluster",
                )
        except RGWAdminError as exc:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc

    _invalidate_users_listing_cache(int(getattr(ctx.endpoint, "id", 0) or 0))
    payload = _load_user_payload(uid, tenant, ctx)
    account_id = _normalize_optional_str(payload.get("account_id") or _extract_user_payload(payload).get("account_id"))
    account_name = _resolve_account_name(
        account_id,
        ctx,
        payload_account_name=_normalize_optional_str(
            payload.get("account_name") or _extract_user_payload(payload).get("account_name")
        ),
    )
    keys = _serialize_access_keys(ctx.rgw_admin.list_user_keys(uid, tenant=tenant))
    return _build_user_detail(
        payload,
        uid_fallback=uid,
        tenant_fallback=tenant,
        account_name=account_name,
        keys=keys,
    )


@router.get("/{user_id}/metrics", response_model=CephAdminEntityMetrics)
def get_rgw_user_metrics(
    user_id: str,
    tenant: Optional[str] = None,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> CephAdminEntityMetrics:
    if not resolve_feature_flags(ctx.endpoint).metrics_enabled:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Storage metrics are disabled for this endpoint")
    uid = user_id.strip()
    if not uid:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="uid is required")
    lookup_uid = f"{tenant}${uid}" if tenant else uid
    try:
        payload = ctx.rgw_admin.get_all_buckets(uid=lookup_uid, with_stats=True)
    except RGWAdminError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
    return _build_metrics_from_buckets(payload)


@router.get("/{user_id}/keys", response_model=list[CephAdminRgwAccessKey])
def list_rgw_user_keys(
    user_id: str,
    tenant: Optional[str] = None,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> list[CephAdminRgwAccessKey]:
    uid = user_id.strip()
    _load_user_payload(uid, tenant, ctx)
    try:
        keys = ctx.rgw_admin.list_user_keys(uid, tenant=tenant)
    except RGWAdminError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
    return _serialize_access_keys(keys)


@router.post("/{user_id}/keys", response_model=CephAdminRgwGeneratedAccessKey, status_code=status.HTTP_201_CREATED)
def create_rgw_user_key(
    user_id: str,
    tenant: Optional[str] = None,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> CephAdminRgwGeneratedAccessKey:
    uid = user_id.strip()
    _load_user_payload(uid, tenant, ctx)
    try:
        response = ctx.rgw_admin.create_access_key(uid, tenant=tenant)
    except RGWAdminError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
    access_key = secret_key = None
    for entry in ctx.rgw_admin._extract_keys(response):
        if not isinstance(entry, dict):
            continue
        access_key, secret_key = _extract_access_key(entry)
        if access_key and secret_key:
            break
    if not access_key or not secret_key:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="RGW did not return access credentials for this key",
        )
    return CephAdminRgwGeneratedAccessKey(access_key=access_key, secret_key=secret_key)


@router.put("/{user_id}/keys/{access_key}/status", response_model=CephAdminRgwAccessKey)
def update_rgw_user_key_status(
    user_id: str,
    access_key: str,
    update: CephAdminRgwAccessKeyStatusChange,
    tenant: Optional[str] = None,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> CephAdminRgwAccessKey:
    uid = user_id.strip()
    normalized_key = access_key.strip()
    if not normalized_key:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="access_key is required")
    _load_user_payload(uid, tenant, ctx)
    try:
        ctx.rgw_admin.set_access_key_status(uid, normalized_key, update.active, tenant=tenant)
        keys = ctx.rgw_admin.list_user_keys(uid, tenant=tenant)
    except RGWAdminError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
    for key in _serialize_access_keys(keys):
        if key.access_key == normalized_key:
            return key
    # Fallback when RGW does not return key details after status update.
    return CephAdminRgwAccessKey(
        access_key=normalized_key,
        status="enabled" if update.active else "suspended",
        is_active=update.active,
    )


@router.delete("/{user_id}/keys/{access_key}", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def delete_rgw_user_key(
    user_id: str,
    access_key: str,
    tenant: Optional[str] = None,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> Response:
    uid = user_id.strip()
    normalized_key = access_key.strip()
    if not normalized_key:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="access_key is required")
    _load_user_payload(uid, tenant, ctx)
    try:
        ctx.rgw_admin.delete_access_key(uid, normalized_key, tenant=tenant)
    except RGWAdminError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)
