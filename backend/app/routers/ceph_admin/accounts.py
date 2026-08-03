# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from collections import OrderedDict
from datetime import datetime, timezone
import logging
from threading import Lock
from typing import Any, Callable, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import StreamingResponse

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
from app.routers.ceph_admin.listing_common import (
    EndpointCacheEntry,
    EndpointListCacheKey,
    EndpointPayloadCacheKey,
    apply_advanced_filter,
    apply_simple_search,
    coerce_number,
    collect_filter_fields,
    fields_set,
    get_or_set_cache,
    invalidate_cache,
    paginate,
    parse_bool,
    parse_filter_query,
    parse_includes,
    parse_int,
    serialize_filter,
    sort_value,
    stream_listing_response,
)
from app.routers.ceph_admin.audit import record_ceph_admin_action
from app.routers.ceph_admin.dependencies import CephAdminContext, get_ceph_admin_context
from app.utils.http_errors import raise_http_exception_from_exception
from app.services.rgw_admin import RGWAdminError
from app.services.bucket_listing_shared import is_advanced_filter_stream_payload
from app.services.listing_progress import (
    ListingProgressEmitter,
    ListingProgressSnapshot,
    interpolate_progress_percent,
    invoke_cancel_check,
)
from app.utils.normalize import normalize_optional_scalar, normalize_text
from app.utils.quota_stats import extract_quota_limits
from app.utils.rgw_payloads import extract_bucket_list
from app.utils.storage_endpoint_features import resolve_feature_flags
from app.utils.usage_stats import compute_usage_ratio_percent, summarize_bucket_usage

router = APIRouter(prefix="/ceph-admin/endpoints/{endpoint_id}/accounts", tags=["ceph-admin-accounts"])
logger = logging.getLogger(__name__)

ACCOUNTS_LIST_CACHE_TTL_SECONDS = 30.0
ACCOUNTS_LIST_CACHE_MAX_ENTRIES = 64
RGW_ACCOUNTS_PAYLOAD_CACHE_MAX_ENTRIES = 16

_ACCOUNTS_LIST_CACHE: OrderedDict[EndpointListCacheKey, EndpointCacheEntry] = OrderedDict()
_ACCOUNTS_LIST_CACHE_LOCK = Lock()
_RGW_ACCOUNTS_PAYLOAD_CACHE: OrderedDict[EndpointPayloadCacheKey, EndpointCacheEntry] = OrderedDict()
_RGW_ACCOUNTS_PAYLOAD_CACHE_LOCK = Lock()


def _clone_account(account: CephAdminRgwAccountSummary) -> CephAdminRgwAccountSummary:
    return account.model_copy(deep=True)


def _clone_account_list(items: list[CephAdminRgwAccountSummary]) -> list[CephAdminRgwAccountSummary]:
    return [_clone_account(item) for item in items]


def _parse_advanced_filter(raw: str | None) -> CephAdminAccountFilterQuery | None:
    return parse_filter_query(raw, query_cls=CephAdminAccountFilterQuery)


def _match_account_field_rule(account: CephAdminRgwAccountSummary, rule: CephAdminAccountFilterRule) -> bool:
    field = rule.field
    op = rule.op
    if field == "quota_usage_size_percent":
        value = compute_usage_ratio_percent(account.used_bytes, account.quota_max_size_bytes)
    elif field == "quota_usage_object_percent":
        value = compute_usage_ratio_percent(account.object_count, account.quota_max_objects)
    else:
        value = getattr(account, field, None)
    if op == "is_null":
        return value is None
    if op == "not_null":
        return value is not None
    if value is None:
        return False

    string_fields = {"account_id", "account_name", "email"}
    if field in string_fields:
        left = normalize_text(str(value))
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
            candidates = {normalize_text(str(item)) for item in rule.value}
            result = left in candidates
            return result if op == "in" else not result
        return False

    left_num = coerce_number(value)
    if left_num is None:
        return False
    if op in ("eq", "neq", "gt", "gte", "lt", "lte"):
        right_num = coerce_number(rule.value)
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
        candidates = {coerce_number(item) for item in rule.value}
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
    if fields & {"account_name", "email"}:
        include.add("profile")
    if fields & {"max_users", "max_buckets"}:
        include.add("limits")
    if fields & {"quota_max_size_bytes", "quota_max_objects", "quota_usage_size_percent", "quota_usage_object_percent"}:
        include.add("quota")
    if fields & {"bucket_count", "user_count"}:
        include.add("stats")
    if fields & {"used_bytes", "object_count", "quota_usage_size_percent", "quota_usage_object_percent"}:
        include.add("usage")
    return include


def _account_field_needs_enrichment(account: CephAdminRgwAccountSummary, field: str) -> bool:
    if field == "account_name":
        return not bool((account.account_name or "").strip())
    if field == "quota_usage_size_percent":
        return account.used_bytes is None or account.quota_max_size_bytes is None
    if field == "quota_usage_object_percent":
        return account.object_count is None or account.quota_max_objects is None
    value = getattr(account, field, None)
    return value is None


def _account_profile_needs_enrichment(account: CephAdminRgwAccountSummary) -> bool:
    return _account_field_needs_enrichment(account, "account_name") or account.email is None


def _extract_count(data: dict[str, Any], keys: tuple[str, ...]) -> Optional[int]:
    for key in keys:
        parsed = parse_int(data.get(key))
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
            parsed = parse_bool(value.get("enabled"))
            if parsed is not None:
                return parsed
    return None


def _build_account_detail(payload: dict[str, Any], account_id_fallback: str) -> CephAdminRgwAccountDetail:
    account_id = normalize_optional_scalar(payload.get("id") or payload.get("account_id")) or account_id_fallback
    account_name = normalize_optional_scalar(payload.get("name") or payload.get("account_name") or payload.get("display_name"))
    email = normalize_optional_scalar(payload.get("email") or payload.get("mail"))
    limits_payload = payload.get("limits") if isinstance(payload.get("limits"), dict) else {}
    max_users = parse_int(payload.get("max_users") or limits_payload.get("max_users"))
    max_buckets = parse_int(payload.get("max_buckets") or limits_payload.get("max_buckets"))
    max_roles = parse_int(payload.get("max_roles") or limits_payload.get("max_roles"))
    max_groups = parse_int(payload.get("max_groups") or limits_payload.get("max_groups"))
    max_access_keys = parse_int(payload.get("max_access_keys") or limits_payload.get("max_access_keys"))
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


def invalidate_accounts_listing_cache(endpoint_id: int | None = None) -> None:
    invalidate_cache(_ACCOUNTS_LIST_CACHE, _ACCOUNTS_LIST_CACHE_LOCK, endpoint_id=endpoint_id)
    invalidate_cache(_RGW_ACCOUNTS_PAYLOAD_CACHE, _RGW_ACCOUNTS_PAYLOAD_CACHE_LOCK, endpoint_id=endpoint_id)


def _enrich_accounts(
    accounts: list[CephAdminRgwAccountSummary],
    requested: set[str],
    ctx: CephAdminContext,
    *,
    progress: ListingProgressEmitter | None = None,
    progress_stage: str = "detail_enrichment",
    progress_message: str = "Loading account details",
    progress_start: int = 50,
    progress_end: int = 64,
    cancel_check: Callable[[], None] | None = None,
) -> list[CephAdminRgwAccountSummary]:
    if not accounts or not requested:
        return accounts
    enriched: list[CephAdminRgwAccountSummary] = []
    total = len(accounts)
    for index, item in enumerate(accounts, start=1):
        invoke_cancel_check(cancel_check)
        account = _clone_account(item)
        try:
            payload = ctx.rgw_admin.get_account(account.account_id, allow_not_found=True)
        except RGWAdminError as exc:
            raise_http_exception_from_exception(status.HTTP_502_BAD_GATEWAY, exc)
        if payload and not payload.get("not_found"):
            if "profile" in requested:
                if not account.account_name:
                    account.account_name = normalize_optional_scalar(
                        payload.get("account_name") or payload.get("name") or payload.get("display_name")
                    )
                account.email = normalize_optional_scalar(payload.get("email") or payload.get("mail"))
            if "limits" in requested:
                limits_payload = payload.get("limits") if isinstance(payload.get("limits"), dict) else {}
                account.max_users = parse_int(payload.get("max_users") or limits_payload.get("max_users"))
                account.max_buckets = parse_int(payload.get("max_buckets") or limits_payload.get("max_buckets"))
            if "quota" in requested:
                quota_size, quota_objects = extract_quota_limits(payload, keys=("quota", "account_quota"))
                account.quota_max_size_bytes = quota_size
                account.quota_max_objects = quota_objects
            if "stats" in requested:
                account.bucket_count = _extract_bucket_count(payload)
                account.user_count = _extract_user_count(payload)
            if "usage" in requested:
                try:
                    buckets_payload = ctx.rgw_admin.get_all_buckets(account_id=account.account_id, with_stats=True)
                except RGWAdminError as exc:
                    raise_http_exception_from_exception(status.HTTP_502_BAD_GATEWAY, exc)
                _bucket_usage, total_bytes, total_objects, _bucket_count = summarize_bucket_usage(
                    extract_bucket_list(buckets_payload)
                )
                account.used_bytes = total_bytes
                account.object_count = total_objects
        enriched.append(account)
        if progress is not None:
            progress.emit(
                percent=interpolate_progress_percent(
                    progress_start,
                    progress_end,
                    processed=index,
                    total=total,
                ),
                stage=progress_stage,
                processed=index,
                total=total,
                message=progress_message,
            )
        invoke_cancel_check(cancel_check)
    return enriched


def _get_cached_rgw_accounts_payload(ctx: CephAdminContext) -> list[Any]:
    key = EndpointPayloadCacheKey(endpoint_id=int(getattr(ctx.endpoint, "id", 0) or 0))

    def _fetch_payload() -> list[Any]:
        try:
            try:
                payload = ctx.rgw_admin.list_accounts(include_details=False)
            except TypeError:
                payload = ctx.rgw_admin.list_accounts()
        except RGWAdminError as exc:
            raise_http_exception_from_exception(status.HTTP_502_BAD_GATEWAY, exc)
        return payload or []

    return get_or_set_cache(
        _RGW_ACCOUNTS_PAYLOAD_CACHE,
        _RGW_ACCOUNTS_PAYLOAD_CACHE_LOCK,
        key,
        ttl_seconds=ACCOUNTS_LIST_CACHE_TTL_SECONDS,
        max_entries=RGW_ACCOUNTS_PAYLOAD_CACHE_MAX_ENTRIES,
        builder=_fetch_payload,
    )


def _get_cached_accounts_listing(
    key: EndpointListCacheKey,
    builder: Callable[[], list[CephAdminRgwAccountSummary]],
) -> list[CephAdminRgwAccountSummary]:
    return get_or_set_cache(
        _ACCOUNTS_LIST_CACHE,
        _ACCOUNTS_LIST_CACHE_LOCK,
        key,
        ttl_seconds=ACCOUNTS_LIST_CACHE_TTL_SECONDS,
        max_entries=ACCOUNTS_LIST_CACHE_MAX_ENTRIES,
        builder=builder,
    )


def _compute_accounts_listing(
    *,
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=200),
    search: str | None = Query(None),
    advanced_filter: str | None = Query(None),
    sort_by: str = Query("account_id"),
    sort_dir: str = Query("asc"),
    include: list[str] = Query(default=[]),
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
    progress_callback: Callable[[ListingProgressSnapshot], None] | None = None,
    cancel_check: Callable[[], None] | None = None,
) -> PaginatedCephAdminAccountsResponse:
    progress = ListingProgressEmitter(progress_callback)
    progress.emit(percent=0, stage="prepare", message="Preparing advanced search", force=True)
    invoke_cancel_check(cancel_check)

    include_set = parse_includes(include)
    requested = include_set & {"profile", "limits", "quota", "stats"}
    parsed_advanced_filter = _parse_advanced_filter(advanced_filter)
    advanced_filter_active = bool(parsed_advanced_filter and parsed_advanced_filter.rules)
    cache_key = EndpointListCacheKey(
        endpoint_id=int(getattr(ctx.endpoint, "id", 0) or 0),
        advanced_filter=serialize_filter(parsed_advanced_filter),
        sort_by=sort_by,
        sort_dir=sort_dir,
    )

    def build_listing() -> list[CephAdminRgwAccountSummary]:
        progress.emit(percent=10, stage="load_entries", message="Loading RGW accounts", force=True)
        invoke_cancel_check(cancel_check)
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
                account_name = normalize_optional_scalar(
                    entry.get("account_name") or entry.get("name") or entry.get("display_name")
                )
                email = normalize_optional_scalar(entry.get("email") or entry.get("mail"))
                limits_payload = entry.get("limits") if isinstance(entry.get("limits"), dict) else {}
                max_users = parse_int(entry.get("max_users") or limits_payload.get("max_users"))
                max_buckets = parse_int(entry.get("max_buckets") or limits_payload.get("max_buckets"))
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
        progress.emit(
            percent=35,
            stage="scan_entries",
            processed=len(results),
            total=len(results),
            message="RGW account scanning completed",
            force=True,
        )
        invoke_cancel_check(cancel_check)

        advanced_fields = collect_filter_fields(parsed_advanced_filter)
        sort_fields = {sort_by} if sort_by else {"account_id"}
        listing_fields = {
            field
            for field in (advanced_fields | sort_fields)
            if any(_account_field_needs_enrichment(item, field) for item in results)
        }
        needed_for_listing = _includes_for_account_fields(listing_fields)
        if needed_for_listing:
            progress.emit(
                percent=50,
                stage="detail_enrichment",
                processed=0,
                total=len(results),
                message="Loading account details",
                force=True,
            )
            results = _enrich_accounts(
                results,
                needed_for_listing,
                ctx,
                progress=progress,
                progress_stage="detail_enrichment",
                progress_message="Loading account details",
                progress_start=50,
                progress_end=64,
                cancel_check=cancel_check,
            )
            invoke_cancel_check(cancel_check)

        if advanced_filter_active:
            progress.emit(
                percent=65,
                stage="expensive_filters",
                processed=0,
                total=len(results),
                message="Applying advanced filters",
                force=True,
            )
        results = apply_advanced_filter(results, parsed_advanced_filter, _match_account_rules)
        invoke_cancel_check(cancel_check)

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
            return sort_value(value, item.account_id or "")

        results.sort(key=sort_key, reverse=sort_dir == "desc")
        return results

    results = _get_cached_accounts_listing(cache_key, build_listing)
    progress.emit(
        percent=75,
        stage="listing_ready",
        processed=len(results),
        total=len(results),
        message="Base listing ready",
        force=True,
    )
    invoke_cancel_check(cancel_check)
    filtered_results = apply_simple_search(
        results,
        search=search,
        parsed_filter=parsed_advanced_filter,
        match_with_filter=lambda account, needle: needle in account.account_id.lower(),
        match_without_filter=lambda account, needle: (
            needle in account.account_id.lower() or needle in (account.account_name or "").lower()
        ),
    )
    if (
        not filtered_results
        and isinstance(search, str)
        and search.strip()
        and parsed_advanced_filter is None
        and any(not (account.account_name or "").strip() for account in results)
    ):
        progress.emit(
            percent=82,
            stage="profile_enrichment",
            processed=0,
            total=len(results),
            message="Loading account profiles",
            force=True,
        )
        searchable_results = _enrich_accounts(
            results,
            {"profile"},
            ctx,
            progress=progress,
            progress_stage="profile_enrichment",
            progress_message="Loading account profiles",
            progress_start=82,
            progress_end=84,
            cancel_check=cancel_check,
        )
        invoke_cancel_check(cancel_check)
        filtered_results = apply_simple_search(
            searchable_results,
            search=search,
            parsed_filter=parsed_advanced_filter,
            match_with_filter=lambda account, needle: needle in account.account_id.lower(),
            match_without_filter=lambda account, needle: (
                needle in account.account_id.lower() or needle in (account.account_name or "").lower()
            ),
        )
    progress.emit(
        percent=85,
        stage="paginate",
        processed=len(filtered_results),
        total=len(filtered_results),
        message="Preparing result page",
        force=True,
    )
    invoke_cancel_check(cancel_check)
    page_items, total, has_next = paginate(
        filtered_results,
        page=page,
        page_size=page_size,
        clone=_clone_account_list,
    )
    requested_for_page = set(requested)
    if "profile" in requested_for_page and not any(_account_profile_needs_enrichment(item) for item in page_items):
        requested_for_page.discard("profile")
    if any(_account_field_needs_enrichment(item, "account_name") for item in page_items):
        requested_for_page.add("profile")
    if requested_for_page and page_items:
        progress.emit(
            percent=92,
            stage="page_enrichment",
            processed=0,
            total=len(page_items),
            message="Loading page details",
            force=True,
        )
        page_items = _enrich_accounts(
            page_items,
            requested_for_page,
            ctx,
            progress=progress,
            progress_stage="page_enrichment",
            progress_message="Loading page details",
            progress_start=92,
            progress_end=99,
            cancel_check=cancel_check,
        )
        invoke_cancel_check(cancel_check)

    progress.emit(
        percent=100,
        stage="finalize",
        processed=total,
        total=total,
        message="Search completed",
        force=True,
    )

    return PaginatedCephAdminAccountsResponse(
        items=page_items,
        total=total,
        page=page,
        page_size=page_size,
        has_next=has_next,
    )


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
    return _compute_accounts_listing(
        page=page,
        page_size=page_size,
        search=search,
        advanced_filter=advanced_filter,
        sort_by=sort_by,
        sort_dir=sort_dir,
        include=include,
        ctx=ctx,
    )


@router.get("/stream")
async def stream_rgw_accounts(
    request: Request,
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=200),
    search: str | None = Query(None),
    advanced_filter: str | None = Query(None),
    sort_by: str = Query("account_id"),
    sort_dir: str = Query("asc"),
    include: list[str] = Query(default=[]),
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> StreamingResponse:
    if not is_advanced_filter_stream_payload(advanced_filter):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="advanced_filter must be provided as a JSON payload for streaming search",
        )

    return stream_listing_response(
        request,
        compute=lambda progress_callback, cancel_check: _compute_accounts_listing(
            page=page,
            page_size=page_size,
            search=search,
            advanced_filter=advanced_filter,
            sort_by=sort_by,
            sort_dir=sort_dir,
            include=include,
            ctx=ctx,
            progress_callback=progress_callback,
            cancel_check=cancel_check,
        ),
        logger=logger,
        failure_message="RGW accounts streaming search failed",
    )


def _load_account_payload(account_id: str, ctx: CephAdminContext) -> dict[str, Any]:
    normalized_account_id = account_id.strip()
    if not normalized_account_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="account_id is required")
    try:
        payload = ctx.rgw_admin.get_account(normalized_account_id, allow_not_found=True)
    except RGWAdminError as exc:
        raise_http_exception_from_exception(status.HTTP_502_BAD_GATEWAY, exc)
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
        raise_http_exception_from_exception(status.HTTP_502_BAD_GATEWAY, exc)
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
            normalize_optional_scalar(create_result.get("id"))
            or normalize_optional_scalar(create_result.get("account_id"))
            or account_id
        )
        account_payload = create_result.get("account")
        if not account_id and isinstance(account_payload, dict):
            account_id = (
                normalize_optional_scalar(account_payload.get("id"))
                or normalize_optional_scalar(account_payload.get("account_id"))
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
            raise_http_exception_from_exception(status.HTTP_502_BAD_GATEWAY, exc)
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
            raise_http_exception_from_exception(status.HTTP_502_BAD_GATEWAY, exc)
        if isinstance(quota_result, dict) and (quota_result.get("not_found") or quota_result.get("not_implemented")):
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="RGW bucket quota update is not supported on this cluster",
            )

    invalidate_accounts_listing_cache(int(getattr(ctx.endpoint, "id", 0) or 0))
    account_payload = _load_account_payload(account_id, ctx)
    account_detail = _build_account_detail(account_payload, account_id_fallback=account_id)
    record_ceph_admin_action(
        ctx,
        action="rgw_account.create",
        entity_type="rgw_account",
        entity_id=account_id,
        metadata={
            "requested_account_id": requested_account_id,
            "quota_updated": payload.quota_enabled is not None
            or payload.quota_max_size_bytes is not None
            or payload.quota_max_objects is not None,
            "bucket_quota_updated": payload.bucket_quota_enabled is not None
            or payload.bucket_quota_max_size_bytes is not None
            or payload.bucket_quota_max_objects is not None,
        },
    )
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

    field_set = fields_set(update)
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
            raise_http_exception_from_exception(status.HTTP_502_BAD_GATEWAY, exc)

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
            raise_http_exception_from_exception(status.HTTP_502_BAD_GATEWAY, exc)

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
            raise_http_exception_from_exception(status.HTTP_502_BAD_GATEWAY, exc)

    invalidate_accounts_listing_cache(int(getattr(ctx.endpoint, "id", 0) or 0))
    payload = _load_account_payload(normalized_account_id, ctx)
    record_ceph_admin_action(
        ctx,
        action="rgw_account.update",
        entity_type="rgw_account",
        entity_id=normalized_account_id,
        metadata={"fields": sorted(field_set)},
    )
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
        raise_http_exception_from_exception(status.HTTP_502_BAD_GATEWAY, exc)

    bucket_usage, total_bytes, total_objects, bucket_count = summarize_bucket_usage(extract_bucket_list(payload))
    bucket_usage.sort(key=lambda item: item.get("used_bytes") or 0, reverse=True)
    return CephAdminEntityMetrics(
        total_bytes=total_bytes,
        total_objects=total_objects,
        bucket_count=bucket_count,
        bucket_usage=bucket_usage,
        generated_at=datetime.now(timezone.utc).replace(microsecond=0),
    )


@router.get("/{account_id}")
def get_rgw_account(
    account_id: str,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> dict[str, Any]:
    return _load_account_payload(account_id, ctx)
