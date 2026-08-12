# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import logging
from typing import Any, Callable, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import StreamingResponse

from app.models.ceph_admin import (
    CephAdminUserFilterQuery,
    CephAdminUserFilterRule,
    CephAdminRgwUserSummary,
    PaginatedCephAdminUsersResponse,
)
from app.routers.ceph_admin.listing_common import (
    EndpointListCacheKey,
    apply_advanced_filter,
    apply_simple_search,
    coerce_number,
    collect_filter_fields,
    paginate,
    parse_filter_query,
    parse_includes,
    parse_int,
    sort_value,
    stream_listing_response,
)
from app.services.bucket_listing_shared import serialize_filter
from app.routers.ceph_admin.dependencies import CephAdminContext, get_ceph_admin_context
from app.routers.ceph_admin.user_common import (
    coerce_bool,
    optional_account_lookup_enabled,
    parse_suspended,
    split_tenant_uid,
)
from app.routers.ceph_admin.user_listing_cache import (
    get_cached_rgw_users_payload,
    get_cached_users_listing,
)
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
from app.utils.rgw_payloads import extract_bucket_list, extract_rgw_user_payload
from app.utils.usage_stats import compute_usage_ratio_percent, summarize_bucket_usage

router = APIRouter(prefix="/ceph-admin/endpoints/{endpoint_id}/users", tags=["ceph-admin-users"])
logger = logging.getLogger(__name__)


def _clone_user(user: CephAdminRgwUserSummary) -> CephAdminRgwUserSummary:
    return user.model_copy(deep=True)


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
    return parse_filter_query(raw, query_cls=CephAdminUserFilterQuery)


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
        left_bool = coerce_bool(value)
        if left_bool is None:
            # Treat missing suspended flag as active.
            left_bool = False
        if op in ("eq", "neq"):
            right_bool = coerce_bool(rule.value)
            if right_bool is None:
                return False
            return left_bool == right_bool if op == "eq" else left_bool != right_bool
        if op in ("in", "not_in"):
            if not isinstance(rule.value, list):
                return False
            candidates = {coerce_bool(item) for item in rule.value}
            candidates = {item for item in candidates if item is not None}
            result = left_bool in candidates
            return result if op == "in" else not result
        return False

    if value is None:
        return False

    string_fields = {"uid", "tenant", "account_id", "account_name", "full_name", "email"}
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
    *,
    progress: ListingProgressEmitter | None = None,
    progress_stage: str = "detail_enrichment",
    progress_message: str = "Loading user details",
    progress_start: int = 50,
    progress_end: int = 64,
    cancel_check: Callable[[], None] | None = None,
) -> list[CephAdminRgwUserSummary]:
    if not users or not requested:
        return users
    account_name_by_id: dict[str, Optional[str]] = {}
    enriched: list[CephAdminRgwUserSummary] = []
    total = len(users)
    for index, item in enumerate(users, start=1):
        invoke_cancel_check(cancel_check)
        user = _clone_user(item)
        try:
            payload = ctx.rgw_admin.get_user(user.uid, tenant=user.tenant, allow_not_found=True)
        except RGWAdminError as exc:
            raise_http_exception_from_exception(status.HTTP_502_BAD_GATEWAY, exc)
        if payload and not payload.get("not_found"):
            user_payload = extract_rgw_user_payload(payload)
            account_id = normalize_optional_scalar(payload.get("account_id") or user_payload.get("account_id"))
            if "account" in requested:
                user.account_id = account_id
                payload_account_name = normalize_optional_scalar(
                    payload.get("account_name") or user_payload.get("account_name")
                )
                if account_id:
                    if account_id not in account_name_by_id:
                        account_payload = None
                        if optional_account_lookup_enabled(ctx) is not False:
                            try:
                                account_payload = ctx.rgw_admin.get_account(
                                    account_id,
                                    allow_not_found=True,
                                    allow_not_implemented=True,
                                )
                            except RGWAdminError as exc:
                                raise_http_exception_from_exception(status.HTTP_502_BAD_GATEWAY, exc)
                        account_name_by_id[account_id] = normalize_optional_scalar(
                            account_payload.get("name") if isinstance(account_payload, dict) else None
                        )
                    user.account_name = account_name_by_id.get(account_id) or payload_account_name
                else:
                    user.account_name = payload_account_name
            if "profile" in requested:
                user.full_name = normalize_optional_scalar(user_payload.get("display_name") or payload.get("display_name"))
                user.email = normalize_optional_scalar(user_payload.get("email") or payload.get("email"))
            if "status" in requested:
                user.suspended = parse_suspended(user_payload.get("suspended") or payload.get("suspended"))
            if "limits" in requested:
                user.max_buckets = parse_int(user_payload.get("max_buckets") or payload.get("max_buckets"))
            if "quota" in requested:
                quota_size, quota_objects = extract_quota_limits(payload, keys=("user_quota", "quota"))
                user.quota_max_size_bytes = quota_size
                user.quota_max_objects = quota_objects
            if "usage" in requested:
                lookup_uid = f"{user.tenant}${user.uid}" if user.tenant else user.uid
                try:
                    buckets_payload = ctx.rgw_admin.get_all_buckets(uid=lookup_uid, with_stats=True)
                except RGWAdminError as exc:
                    raise_http_exception_from_exception(status.HTTP_502_BAD_GATEWAY, exc)
                _bucket_usage, total_bytes, total_objects, _bucket_count = summarize_bucket_usage(
                    extract_bucket_list(buckets_payload)
                )
                user.used_bytes = total_bytes
                user.object_count = total_objects
        enriched.append(user)
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


def _compute_users_listing(
    *,
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=200),
    search: str | None = Query(None),
    advanced_filter: str | None = Query(None),
    sort_by: str = Query("uid"),
    sort_dir: str = Query("asc"),
    include: list[str] = Query(default=[]),
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
    progress_callback: Callable[[ListingProgressSnapshot], None] | None = None,
    cancel_check: Callable[[], None] | None = None,
) -> PaginatedCephAdminUsersResponse:
    progress = ListingProgressEmitter(progress_callback)
    progress.emit(percent=0, stage="prepare", message="Preparing advanced search", force=True)
    invoke_cancel_check(cancel_check)

    include_set = parse_includes(include)
    requested = include_set & {"account", "profile", "status", "limits", "quota"}
    parsed_advanced_filter = _parse_advanced_filter(advanced_filter)
    advanced_filter_active = bool(parsed_advanced_filter and parsed_advanced_filter.rules)
    cache_key = EndpointListCacheKey(
        endpoint_id=int(getattr(ctx.endpoint, "id", 0) or 0),
        advanced_filter=serialize_filter(parsed_advanced_filter),
        sort_by=sort_by,
        sort_dir=sort_dir,
    )

    def build_listing() -> list[CephAdminRgwUserSummary]:
        progress.emit(percent=10, stage="load_entries", message="Loading RGW users", force=True)
        invoke_cancel_check(cancel_check)
        payload = get_cached_rgw_users_payload(ctx)
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
            tenant, user_uid = split_tenant_uid(uid)
            results.append(CephAdminRgwUserSummary(uid=user_uid if tenant else uid, tenant=tenant))
        progress.emit(
            percent=35,
            stage="scan_entries",
            processed=len(results),
            total=len(results),
            message="RGW user scanning completed",
            force=True,
        )
        invoke_cancel_check(cancel_check)

        advanced_fields = collect_filter_fields(parsed_advanced_filter)
        sort_fields = {sort_by} if sort_by else {"uid"}
        needed_for_listing = _includes_for_user_fields(advanced_fields | sort_fields)
        if needed_for_listing:
            progress.emit(
                percent=50,
                stage="detail_enrichment",
                processed=0,
                total=len(results),
                message="Loading user details",
                force=True,
            )
            results = _enrich_users(
                results,
                needed_for_listing,
                ctx,
                progress=progress,
                progress_stage="detail_enrichment",
                progress_message="Loading user details",
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
        results = apply_advanced_filter(results, parsed_advanced_filter, _match_user_rules)
        invoke_cancel_check(cancel_check)

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
            return sort_value(value, item.uid or "")

        results.sort(key=sort_key, reverse=sort_dir == "desc")
        if needed_for_listing:
            for user in results:
                _clear_optional_user_details(user)
        return results

    results = get_cached_users_listing(cache_key, build_listing)
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
        match_with_filter=lambda user, needle: needle in user.uid.lower(),
        match_without_filter=lambda user, needle: (
            needle in user.uid.lower() or needle in (user.tenant or "").lower()
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
        clone=_clone_user_list,
    )
    if requested and page_items:
        progress.emit(
            percent=92,
            stage="page_enrichment",
            processed=0,
            total=len(page_items),
            message="Loading page details",
            force=True,
        )
        page_items = _enrich_users(
            page_items,
            requested,
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

    return PaginatedCephAdminUsersResponse(
        items=page_items,
        total=total,
        page=page,
        page_size=page_size,
        has_next=has_next,
    )


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
    return _compute_users_listing(
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
async def stream_rgw_users(
    request: Request,
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=200),
    search: str | None = Query(None),
    advanced_filter: str | None = Query(None),
    sort_by: str = Query("uid"),
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
        compute=lambda progress_callback, cancel_check: _compute_users_listing(
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
        failure_message="RGW users streaming search failed",
    )
