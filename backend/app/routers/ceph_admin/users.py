# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import json
from collections import OrderedDict
from dataclasses import dataclass
from datetime import datetime, timezone
from threading import Lock
from time import monotonic
from typing import Any, Callable, Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import ValidationError

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
from app.routers.ceph_admin.dependencies import CephAdminContext, get_ceph_admin_context
from app.services.rgw_admin import RGWAdminError
from app.utils.quota_stats import extract_quota_limits
from app.utils.rgw import extract_bucket_list
from app.utils.usage_stats import extract_usage_stats

router = APIRouter(prefix="/ceph-admin/endpoints/{endpoint_id}/users", tags=["ceph-admin-users"])

USERS_LIST_CACHE_TTL_SECONDS = 30.0
USERS_LIST_CACHE_MAX_ENTRIES = 64
RGW_USERS_PAYLOAD_CACHE_MAX_ENTRIES = 16


@dataclass(frozen=True)
class _UsersListCacheKey:
    endpoint_id: int
    advanced_filter: str | None
    sort_by: str
    sort_dir: str


@dataclass
class _UsersListCacheEntry:
    endpoint_id: int
    expires_at: float
    items: list[CephAdminRgwUserSummary]


@dataclass(frozen=True)
class _RgwUsersPayloadCacheKey:
    endpoint_id: int


@dataclass
class _RgwUsersPayloadCacheEntry:
    endpoint_id: int
    expires_at: float
    payload: list[Any]


_USERS_LIST_CACHE: OrderedDict[_UsersListCacheKey, _UsersListCacheEntry] = OrderedDict()
_USERS_LIST_CACHE_LOCK = Lock()
_RGW_USERS_PAYLOAD_CACHE: OrderedDict[_RgwUsersPayloadCacheKey, _RgwUsersPayloadCacheEntry] = OrderedDict()
_RGW_USERS_PAYLOAD_CACHE_LOCK = Lock()


def _split_tenant_uid(value: str) -> Tuple[Optional[str], str]:
    raw = value.strip()
    if "$" in raw:
        tenant, uid = raw.split("$", 1)
        if tenant and uid:
            return tenant, uid
    return None, raw


def _extract_access_key(payload: dict) -> tuple[Optional[str], Optional[str]]:
    access_key = payload.get("access_key") or payload.get("access-key")
    secret_key = payload.get("secret_key") or payload.get("secret-key")
    return access_key, secret_key


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


def _extract_user_payload(raw: dict) -> dict:
    if not isinstance(raw, dict):
        return {}
    user_payload = raw.get("user")
    if isinstance(user_payload, dict):
        return user_payload
    return raw


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


def _fields_set(model: Any) -> set[str]:
    if hasattr(model, "model_fields_set"):
        return set(getattr(model, "model_fields_set"))
    if hasattr(model, "__fields_set__"):
        return set(getattr(model, "__fields_set__"))
    return set()


def _serialize_filter(query: CephAdminUserFilterQuery | None) -> str | None:
    if not query:
        return None
    payload = query.model_dump(mode="json") if hasattr(query, "model_dump") else query.dict()
    return json.dumps(payload, separators=(",", ":"), sort_keys=True)


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


def _parse_advanced_filter(raw: str | None) -> CephAdminUserFilterQuery | None:
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
        if hasattr(CephAdminUserFilterQuery, "model_validate"):
            return CephAdminUserFilterQuery.model_validate(parsed)
        return CephAdminUserFilterQuery.parse_obj(parsed)
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
    if fields & {"quota_max_size_bytes", "quota_max_objects"}:
        include.add("quota")
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
            if account_id:
                if account_id not in account_name_by_id:
                    try:
                        account_payload = ctx.rgw_admin.get_account(account_id, allow_not_found=True)
                    except RGWAdminError as exc:
                        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
                    account_name_by_id[account_id] = _normalize_optional_str(
                        account_payload.get("name") if isinstance(account_payload, dict) else None
                    )
                user.account_name = account_name_by_id.get(account_id)
        if "profile" in requested:
            user.full_name = _normalize_optional_str(
                user_payload.get("display_name")
                or user_payload.get("display-name")
                or payload.get("display_name")
                or payload.get("display-name")
            )
            user.email = _normalize_optional_str(user_payload.get("email") or payload.get("email"))
        if "status" in requested:
            user.suspended = _parse_suspended(
                user_payload.get("suspended")
                or user_payload.get("suspension")
                or payload.get("suspended")
                or payload.get("suspension")
            )
        if "limits" in requested:
            user.max_buckets = _parse_int(
                user_payload.get("max_buckets")
                or user_payload.get("max-buckets")
                or payload.get("max_buckets")
                or payload.get("max-buckets")
            )
        if "quota" in requested:
            quota_size, quota_objects = extract_quota_limits(payload, keys=("user_quota", "quota"))
            user.quota_max_size_bytes = quota_size
            user.quota_max_objects = quota_objects
        enriched.append(user)
    return enriched


def _prune_users_listing_cache(now: float) -> None:
    expired_keys = [key for key, entry in _USERS_LIST_CACHE.items() if entry.expires_at <= now]
    for key in expired_keys:
        _USERS_LIST_CACHE.pop(key, None)
    while len(_USERS_LIST_CACHE) > USERS_LIST_CACHE_MAX_ENTRIES:
        _USERS_LIST_CACHE.popitem(last=False)


def _prune_rgw_users_payload_cache(now: float) -> None:
    expired_keys = [key for key, entry in _RGW_USERS_PAYLOAD_CACHE.items() if entry.expires_at <= now]
    for key in expired_keys:
        _RGW_USERS_PAYLOAD_CACHE.pop(key, None)
    while len(_RGW_USERS_PAYLOAD_CACHE) > RGW_USERS_PAYLOAD_CACHE_MAX_ENTRIES:
        _RGW_USERS_PAYLOAD_CACHE.popitem(last=False)


def _get_cached_rgw_users_payload(ctx: CephAdminContext) -> list[Any]:
    key = _RgwUsersPayloadCacheKey(endpoint_id=int(getattr(ctx.endpoint, "id", 0) or 0))
    now = monotonic()
    with _RGW_USERS_PAYLOAD_CACHE_LOCK:
        _prune_rgw_users_payload_cache(now)
        cached = _RGW_USERS_PAYLOAD_CACHE.get(key)
        if cached is not None:
            _RGW_USERS_PAYLOAD_CACHE.move_to_end(key)
            return cached.payload
    try:
        payload = ctx.rgw_admin.list_users()
    except RGWAdminError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
    expires_at = monotonic() + USERS_LIST_CACHE_TTL_SECONDS
    with _RGW_USERS_PAYLOAD_CACHE_LOCK:
        _prune_rgw_users_payload_cache(monotonic())
        _RGW_USERS_PAYLOAD_CACHE[key] = _RgwUsersPayloadCacheEntry(
            endpoint_id=key.endpoint_id,
            expires_at=expires_at,
            payload=payload or [],
        )
        _RGW_USERS_PAYLOAD_CACHE.move_to_end(key)
        _prune_rgw_users_payload_cache(monotonic())
    return payload or []


def _get_cached_users_listing(
    key: _UsersListCacheKey,
    builder: Callable[[], list[CephAdminRgwUserSummary]],
) -> list[CephAdminRgwUserSummary]:
    now = monotonic()
    with _USERS_LIST_CACHE_LOCK:
        _prune_users_listing_cache(now)
        cached = _USERS_LIST_CACHE.get(key)
        if cached is not None:
            _USERS_LIST_CACHE.move_to_end(key)
            return cached.items
    items = builder()
    expires_at = monotonic() + USERS_LIST_CACHE_TTL_SECONDS
    with _USERS_LIST_CACHE_LOCK:
        _prune_users_listing_cache(monotonic())
        _USERS_LIST_CACHE[key] = _UsersListCacheEntry(endpoint_id=key.endpoint_id, expires_at=expires_at, items=items)
        _USERS_LIST_CACHE.move_to_end(key)
        _prune_users_listing_cache(monotonic())
    return items


def _invalidate_users_listing_cache(endpoint_id: int | None = None) -> None:
    with _USERS_LIST_CACHE_LOCK:
        if endpoint_id is None:
            _USERS_LIST_CACHE.clear()
        else:
            keys = [key for key in _USERS_LIST_CACHE.keys() if key.endpoint_id == endpoint_id]
            for key in keys:
                _USERS_LIST_CACHE.pop(key, None)
    with _RGW_USERS_PAYLOAD_CACHE_LOCK:
        if endpoint_id is None:
            _RGW_USERS_PAYLOAD_CACHE.clear()
        else:
            keys = [key for key in _RGW_USERS_PAYLOAD_CACHE.keys() if key.endpoint_id == endpoint_id]
            for key in keys:
                _RGW_USERS_PAYLOAD_CACHE.pop(key, None)


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
    access_key_value = (
        entry.get("access_key")
        or entry.get("access-key")
        or entry.get("access_key_id")
        or entry.get("access-key-id")
    )
    access_key = _normalize_optional_str(access_key_value)
    if not access_key:
        return None
    secret_key = _normalize_optional_str(entry.get("secret_key") or entry.get("secret-key"))
    status_text, is_active = _parse_key_status(
        entry.get("status") or entry.get("key_status") or entry.get("key-status") or entry.get("state")
    )
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
        display_name=_normalize_optional_str(
            user_payload.get("display_name")
            or user_payload.get("display-name")
            or payload.get("display_name")
            or payload.get("display-name")
        ),
        email=_normalize_optional_str(user_payload.get("email") or payload.get("email")),
        account_id=account_id,
        account_name=account_name,
        suspended=_parse_suspended(
            user_payload.get("suspended")
            or user_payload.get("suspension")
            or payload.get("suspended")
            or payload.get("suspension")
        ),
        admin=_coerce_bool(user_payload.get("admin") if "admin" in user_payload else payload.get("admin")),
        system=_coerce_bool(user_payload.get("system") if "system" in user_payload else payload.get("system")),
        account_root=_coerce_bool(
            user_payload.get("account_root")
            or user_payload.get("account-root")
            or payload.get("account_root")
            or payload.get("account-root")
        ),
        max_buckets=_parse_int(
            user_payload.get("max_buckets")
            or user_payload.get("max-buckets")
            or payload.get("max_buckets")
            or payload.get("max-buckets")
        ),
        op_mask=_normalize_optional_str(
            user_payload.get("op_mask")
            or user_payload.get("op-mask")
            or payload.get("op_mask")
            or payload.get("op-mask")
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


def _resolve_account_name(account_id: Optional[str], ctx: CephAdminContext) -> Optional[str]:
    if not account_id:
        return None
    try:
        account_payload = ctx.rgw_admin.get_account(account_id, allow_not_found=True)
    except RGWAdminError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
    if not isinstance(account_payload, dict) or account_payload.get("not_found"):
        return None
    return _normalize_optional_str(
        account_payload.get("name") or account_payload.get("display_name") or account_payload.get("account_name")
    )


def _build_metrics_from_buckets(payload: Any) -> CephAdminEntityMetrics:
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
    simple_search = search.strip() if isinstance(search, str) and search.strip() else None
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

        advanced_fields: set[str] = set()
        if parsed_advanced_filter and parsed_advanced_filter.rules:
            advanced_fields = {rule.field for rule in parsed_advanced_filter.rules if rule.field}
        sort_fields = {sort_by} if sort_by else {"uid"}
        needed_for_listing = _includes_for_user_fields(advanced_fields | sort_fields)
        if needed_for_listing:
            results = _enrich_users(results, needed_for_listing, ctx)

        if parsed_advanced_filter and parsed_advanced_filter.rules:
            results = [
                user
                for user in results
                if _match_user_rules(user, parsed_advanced_filter.rules, parsed_advanced_filter.match)
            ]

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
            if value is None:
                return (1, "")
            if isinstance(value, str):
                return (0, value.lower(), (item.uid or "").lower())
            return (0, value, (item.uid or "").lower())

        results.sort(key=sort_key, reverse=sort_dir == "desc")
        if needed_for_listing:
            for user in results:
                _clear_optional_user_details(user)
        return results

    results = _get_cached_users_listing(cache_key, build_listing)
    filtered_results = results
    if simple_search:
        search_value = simple_search.lower()
        if parsed_advanced_filter:
            filtered_results = [user for user in filtered_results if search_value in user.uid.lower()]
        else:
            filtered_results = [
                user
                for user in filtered_results
                if search_value in user.uid.lower()
                or search_value in (user.tenant or "").lower()
            ]

    total = len(filtered_results)
    start = max(page - 1, 0) * page_size
    end = start + page_size
    page_items = _clone_user_list(filtered_results[start:end])
    has_next = end < total
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
    account_name = _resolve_account_name(resolved_account_id, ctx)
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
    account_name = _resolve_account_name(account_id, ctx)
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
    account_name = _resolve_account_name(account_id, ctx)
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
