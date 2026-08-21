# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import logging
from typing import Any, Callable, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import StreamingResponse

from app.models.ceph_admin import (
    CephAdminAccountFilterQuery,
    CephAdminAccountFilterRule,
    CephAdminRgwAccountSummary,
    PaginatedCephAdminAccountsResponse,
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
    stream_listing_response,
)
from app.services.bucket_listing_shared import (
    is_advanced_filter_stream_payload,
    listing_sort_key,
    serialize_filter,
)
from app.services.listing_rule_matching import match_numeric_rule, match_text_rule
from app.routers.ceph_admin.account_listing_cache import (
    get_cached_accounts_listing,
    get_cached_rgw_accounts_payload,
)
from app.routers.ceph_admin.account_common import extract_bucket_count, extract_user_count
from app.routers.ceph_admin.dependencies import CephAdminContext, get_ceph_admin_context
from app.utils.http_errors import raise_http_exception_from_exception
from app.services.rgw_admin import RGWAdminError
from app.services.listing_progress import (
    ListingProgressEmitter,
    ListingProgressSnapshot,
    interpolate_progress_percent,
    invoke_cancel_check,
)
from app.utils.normalize import normalize_optional_scalar
from app.utils.quota_stats import extract_quota_limits
from app.utils.rgw_payloads import extract_bucket_list
from app.utils.usage_stats import compute_usage_ratio_percent, summarize_bucket_usage

router = APIRouter(prefix="/ceph-admin/endpoints/{endpoint_id}/accounts", tags=["ceph-admin-accounts"])
logger = logging.getLogger(__name__)

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
        return match_text_rule(value, op, rule.value)

    return match_numeric_rule(value, op, rule.value, coerce=coerce_number)


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
                account.bucket_count = extract_bucket_count(payload)
                account.user_count = extract_user_count(payload)
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
        payload = get_cached_rgw_accounts_payload(ctx)
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
                bucket_count = extract_bucket_count(entry)
                user_count = extract_user_count(entry)
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
            return listing_sort_key(value, item.account_id or "")

        results.sort(key=sort_key, reverse=sort_dir == "desc")
        return results

    results = get_cached_accounts_listing(cache_key, build_listing)
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
