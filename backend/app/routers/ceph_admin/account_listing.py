# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Any, Callable

from fastapi import status

from app.models.ceph_admin import (
    CephAdminAccountFilterQuery,
    CephAdminAccountFilterRule,
    CephAdminRgwAccountSummary,
    PaginatedCephAdminAccountsResponse,
)
from app.routers.ceph_admin.account_common import (
    extract_bucket_count,
    extract_user_count,
)
from app.routers.ceph_admin.account_listing_cache import (
    get_cached_accounts_listing,
    get_cached_rgw_accounts_payload,
)
from app.routers.ceph_admin.dependencies import CephAdminContext
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
)
from app.services.bucket_listing_shared import listing_sort_key, serialize_filter
from app.services.listing_progress import (
    ListingProgressEmitter,
    ListingProgressSnapshot,
    emit_listing_ready,
    interpolate_progress_percent,
    invoke_cancel_check,
)
from app.services.listing_rule_matching import match_numeric_rule, match_text_rule
from app.services.rgw_admin import RGWAdminError
from app.utils.http_errors import raise_http_exception_from_exception
from app.utils.normalize import normalize_optional_scalar
from app.utils.quota_stats import extract_quota_limits
from app.utils.rgw_payloads import extract_bucket_list
from app.utils.usage_stats import compute_usage_ratio_percent, summarize_bucket_usage


def _clone_account(account: CephAdminRgwAccountSummary) -> CephAdminRgwAccountSummary:
    return account.model_copy(deep=True)


def _clone_account_list(
    items: list[CephAdminRgwAccountSummary],
) -> list[CephAdminRgwAccountSummary]:
    return [_clone_account(item) for item in items]


def _parse_advanced_filter(raw: str | None) -> CephAdminAccountFilterQuery | None:
    return parse_filter_query(raw, query_cls=CephAdminAccountFilterQuery)


def _match_account_field_rule(
    account: CephAdminRgwAccountSummary,
    rule: CephAdminAccountFilterRule,
) -> bool:
    field = rule.field
    op = rule.op
    if field == "quota_usage_size_percent":
        value = compute_usage_ratio_percent(
            account.used_bytes,
            account.quota_max_size_bytes,
        )
    elif field == "quota_usage_object_percent":
        value = compute_usage_ratio_percent(
            account.object_count,
            account.quota_max_objects,
        )
    else:
        value = getattr(account, field, None)
    if op == "is_null":
        return value is None
    if op == "not_null":
        return value is not None
    if value is None:
        return False
    if field in {"account_id", "account_name", "email"}:
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
    if fields & {
        "quota_max_size_bytes",
        "quota_max_objects",
        "quota_usage_size_percent",
        "quota_usage_object_percent",
    }:
        include.add("quota")
    if fields & {"bucket_count", "user_count"}:
        include.add("stats")
    if fields & {
        "used_bytes",
        "object_count",
        "quota_usage_size_percent",
        "quota_usage_object_percent",
    }:
        include.add("usage")
    return include


def _account_field_needs_enrichment(
    account: CephAdminRgwAccountSummary,
    field: str,
) -> bool:
    if field == "account_name":
        return not bool((account.account_name or "").strip())
    if field == "quota_usage_size_percent":
        return account.used_bytes is None or account.quota_max_size_bytes is None
    if field == "quota_usage_object_percent":
        return account.object_count is None or account.quota_max_objects is None
    return getattr(account, field, None) is None


def _account_profile_needs_enrichment(
    account: CephAdminRgwAccountSummary,
) -> bool:
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
            payload = ctx.rgw_admin.get_account(
                account.account_id,
                allow_not_found=True,
            )
        except RGWAdminError as exc:
            raise_http_exception_from_exception(status.HTTP_502_BAD_GATEWAY, exc)
        if payload and not payload.get("not_found"):
            _apply_account_detail_payload(account, payload, requested, ctx)
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


def _apply_account_detail_payload(
    account: CephAdminRgwAccountSummary,
    payload: dict[str, Any],
    requested: set[str],
    ctx: CephAdminContext,
) -> None:
    if "profile" in requested:
        if not account.account_name:
            account.account_name = normalize_optional_scalar(
                payload.get("account_name")
                or payload.get("name")
                or payload.get("display_name")
            )
        account.email = normalize_optional_scalar(
            payload.get("email") or payload.get("mail")
        )
    if "limits" in requested:
        limits = payload.get("limits") if isinstance(payload.get("limits"), dict) else {}
        account.max_users = parse_int(payload.get("max_users") or limits.get("max_users"))
        account.max_buckets = parse_int(
            payload.get("max_buckets") or limits.get("max_buckets")
        )
    if "quota" in requested:
        quota_size, quota_objects = extract_quota_limits(
            payload,
            keys=("quota", "account_quota"),
        )
        account.quota_max_size_bytes = quota_size
        account.quota_max_objects = quota_objects
    if "stats" in requested:
        account.bucket_count = extract_bucket_count(payload)
        account.user_count = extract_user_count(payload)
    if "usage" in requested:
        try:
            buckets_payload = ctx.rgw_admin.get_all_buckets(
                account_id=account.account_id,
                with_stats=True,
            )
        except RGWAdminError as exc:
            raise_http_exception_from_exception(status.HTTP_502_BAD_GATEWAY, exc)
        _usage, total_bytes, total_objects, _count = summarize_bucket_usage(
            extract_bucket_list(buckets_payload)
        )
        account.used_bytes = total_bytes
        account.object_count = total_objects


def _account_from_entry(entry: object) -> CephAdminRgwAccountSummary | None:
    if not isinstance(entry, dict):
        account_id = str(entry or "").strip()
        return CephAdminRgwAccountSummary(account_id=account_id) if account_id else None

    account_id = str(entry.get("account_id") or entry.get("id") or "").strip()
    if not account_id:
        return None
    limits = entry.get("limits") if isinstance(entry.get("limits"), dict) else {}
    quota_size, quota_objects = extract_quota_limits(
        entry,
        keys=("quota", "account_quota"),
    )
    return CephAdminRgwAccountSummary(
        account_id=account_id,
        account_name=normalize_optional_scalar(
            entry.get("account_name") or entry.get("name") or entry.get("display_name")
        ),
        email=normalize_optional_scalar(entry.get("email") or entry.get("mail")),
        max_users=parse_int(entry.get("max_users") or limits.get("max_users")),
        max_buckets=parse_int(entry.get("max_buckets") or limits.get("max_buckets")),
        quota_max_size_bytes=quota_size,
        quota_max_objects=quota_objects,
        bucket_count=extract_bucket_count(entry),
        user_count=extract_user_count(entry),
    )


def _account_sort_key(
    account: CephAdminRgwAccountSummary,
    sort_by: str,
) -> tuple[int, Any, str]:
    if sort_by in {"account_name", "name"}:
        value: Any = account.account_name or account.account_id
    elif sort_by in {
        "email",
        "max_users",
        "max_buckets",
        "quota_max_size_bytes",
        "quota_max_objects",
        "bucket_count",
        "user_count",
    }:
        value = getattr(account, sort_by)
    else:
        value = account.account_id
    return listing_sort_key(value, account.account_id or "")


class _AccountListingPipeline:
    def __init__(
        self,
        *,
        page: int,
        page_size: int,
        search: str | None,
        advanced_filter: str | None,
        sort_by: str,
        sort_dir: str,
        include: list[str],
        ctx: CephAdminContext,
        progress_callback: Callable[[ListingProgressSnapshot], None] | None,
        cancel_check: Callable[[], None] | None,
    ) -> None:
        self.page = page
        self.page_size = page_size
        self.search = search
        self.raw_advanced_filter = advanced_filter
        self.sort_by = sort_by
        self.sort_dir = sort_dir
        self.include = include
        self.ctx = ctx
        self.progress = ListingProgressEmitter(progress_callback)
        self.cancel_check = cancel_check
        self.parsed_filter: CephAdminAccountFilterQuery | None = None
        self.advanced_filter_active = False
        self.requested: set[str] = set()
        self.cache_key: EndpointListCacheKey | None = None

    def run(self) -> PaginatedCephAdminAccountsResponse:
        self.progress.emit(
            percent=0,
            stage="prepare",
            message="Preparing advanced search",
            force=True,
        )
        invoke_cancel_check(self.cancel_check)
        self._prepare_query()

        if self.cache_key is None:
            raise RuntimeError("Account listing cache key is not initialized")
        results = get_cached_accounts_listing(self.cache_key, self._build_listing)
        emit_listing_ready(
            self.progress,
            item_count=len(results),
            cancel_check=self.cancel_check,
        )
        filtered_results = self._apply_search(results)
        page_items, total, has_next = self._paginate(filtered_results)
        page_items = self._enrich_page(page_items)
        self.progress.emit(
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
            page=self.page,
            page_size=self.page_size,
            has_next=has_next,
        )

    def _prepare_query(self) -> None:
        self.requested = parse_includes(self.include) & {
            "profile",
            "limits",
            "quota",
            "stats",
        }
        self.parsed_filter = _parse_advanced_filter(self.raw_advanced_filter)
        self.advanced_filter_active = bool(
            self.parsed_filter and self.parsed_filter.rules
        )
        self.cache_key = EndpointListCacheKey(
            endpoint_id=int(getattr(self.ctx.endpoint, "id", 0) or 0),
            advanced_filter=serialize_filter(self.parsed_filter),
            sort_by=self.sort_by,
            sort_dir=self.sort_dir,
        )

    def _build_listing(self) -> list[CephAdminRgwAccountSummary]:
        self.progress.emit(
            percent=10,
            stage="load_entries",
            message="Loading RGW accounts",
            force=True,
        )
        invoke_cancel_check(self.cancel_check)
        payload = get_cached_rgw_accounts_payload(self.ctx)
        results = [
            account
            for entry in payload or []
            if (account := _account_from_entry(entry)) is not None
        ]
        self.progress.emit(
            percent=35,
            stage="scan_entries",
            processed=len(results),
            total=len(results),
            message="RGW account scanning completed",
            force=True,
        )
        invoke_cancel_check(self.cancel_check)
        results = self._enrich_for_listing(results)
        if self.advanced_filter_active:
            self.progress.emit(
                percent=65,
                stage="expensive_filters",
                processed=0,
                total=len(results),
                message="Applying advanced filters",
                force=True,
            )
        results = apply_advanced_filter(
            results,
            self.parsed_filter,
            _match_account_rules,
        )
        invoke_cancel_check(self.cancel_check)
        results.sort(
            key=lambda account: _account_sort_key(account, self.sort_by),
            reverse=self.sort_dir == "desc",
        )
        return results

    def _enrich_for_listing(
        self,
        results: list[CephAdminRgwAccountSummary],
    ) -> list[CephAdminRgwAccountSummary]:
        fields = collect_filter_fields(self.parsed_filter) | {
            self.sort_by or "account_id"
        }
        fields_needing_enrichment = {
            field
            for field in fields
            if any(_account_field_needs_enrichment(item, field) for item in results)
        }
        requested = _includes_for_account_fields(fields_needing_enrichment)
        if not requested:
            return results
        self.progress.emit(
            percent=50,
            stage="detail_enrichment",
            processed=0,
            total=len(results),
            message="Loading account details",
            force=True,
        )
        enriched = _enrich_accounts(
            results,
            requested,
            self.ctx,
            progress=self.progress,
            progress_stage="detail_enrichment",
            progress_message="Loading account details",
            progress_start=50,
            progress_end=64,
            cancel_check=self.cancel_check,
        )
        invoke_cancel_check(self.cancel_check)
        return enriched

    def _apply_search(
        self,
        results: list[CephAdminRgwAccountSummary],
    ) -> list[CephAdminRgwAccountSummary]:
        filtered = self._search(results)
        if not self._needs_profile_search_fallback(results, filtered):
            return filtered
        self.progress.emit(
            percent=82,
            stage="profile_enrichment",
            processed=0,
            total=len(results),
            message="Loading account profiles",
            force=True,
        )
        searchable = _enrich_accounts(
            results,
            {"profile"},
            self.ctx,
            progress=self.progress,
            progress_stage="profile_enrichment",
            progress_message="Loading account profiles",
            progress_start=82,
            progress_end=84,
            cancel_check=self.cancel_check,
        )
        invoke_cancel_check(self.cancel_check)
        return self._search(searchable)

    def _search(
        self,
        results: list[CephAdminRgwAccountSummary],
    ) -> list[CephAdminRgwAccountSummary]:
        return apply_simple_search(
            results,
            search=self.search,
            parsed_filter=self.parsed_filter,
            match_with_filter=lambda account, needle: (
                needle in account.account_id.lower()
            ),
            match_without_filter=lambda account, needle: (
                needle in account.account_id.lower()
                or needle in (account.account_name or "").lower()
            ),
        )

    def _needs_profile_search_fallback(
        self,
        results: list[CephAdminRgwAccountSummary],
        filtered: list[CephAdminRgwAccountSummary],
    ) -> bool:
        return bool(
            not filtered
            and isinstance(self.search, str)
            and self.search.strip()
            and self.parsed_filter is None
            and any(not (account.account_name or "").strip() for account in results)
        )

    def _paginate(
        self,
        filtered_results: list[CephAdminRgwAccountSummary],
    ) -> tuple[list[CephAdminRgwAccountSummary], int, bool]:
        self.progress.emit(
            percent=85,
            stage="paginate",
            processed=len(filtered_results),
            total=len(filtered_results),
            message="Preparing result page",
            force=True,
        )
        invoke_cancel_check(self.cancel_check)
        return paginate(
            filtered_results,
            page=self.page,
            page_size=self.page_size,
            clone=_clone_account_list,
        )

    def _enrich_page(
        self,
        page_items: list[CephAdminRgwAccountSummary],
    ) -> list[CephAdminRgwAccountSummary]:
        requested = set(self.requested)
        if "profile" in requested and not any(
            _account_profile_needs_enrichment(item) for item in page_items
        ):
            requested.discard("profile")
        if any(
            _account_field_needs_enrichment(item, "account_name")
            for item in page_items
        ):
            requested.add("profile")
        if not requested or not page_items:
            return page_items
        self.progress.emit(
            percent=92,
            stage="page_enrichment",
            processed=0,
            total=len(page_items),
            message="Loading page details",
            force=True,
        )
        enriched = _enrich_accounts(
            page_items,
            requested,
            self.ctx,
            progress=self.progress,
            progress_stage="page_enrichment",
            progress_message="Loading page details",
            progress_start=92,
            progress_end=99,
            cancel_check=self.cancel_check,
        )
        invoke_cancel_check(self.cancel_check)
        return enriched


def compute_accounts_listing(
    *,
    page: int,
    page_size: int,
    search: str | None,
    advanced_filter: str | None,
    sort_by: str,
    sort_dir: str,
    include: list[str],
    ctx: CephAdminContext,
    progress_callback: Callable[[ListingProgressSnapshot], None] | None = None,
    cancel_check: Callable[[], None] | None = None,
) -> PaginatedCephAdminAccountsResponse:
    return _AccountListingPipeline(
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
    ).run()
