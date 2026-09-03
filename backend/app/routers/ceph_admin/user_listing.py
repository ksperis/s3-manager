# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Any, Callable

from app.models.ceph_admin import (
    CephAdminRgwUserSummary,
    CephAdminUserFilterQuery,
    CephAdminUserFilterRule,
    PaginatedCephAdminUsersResponse,
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
)
from app.routers.ceph_admin.user_common import (
    coerce_bool,
    split_tenant_uid,
)
from app.routers.ceph_admin.user_listing_enrichment import enrich_users
from app.routers.ceph_admin.user_listing_cache import (
    get_cached_rgw_users_payload,
    get_cached_users_listing,
)
from app.services.bucket_listing_shared import listing_sort_key, serialize_filter
from app.services.listing_progress import (
    ListingProgressEmitter,
    ListingProgressSnapshot,
    emit_listing_ready,
    invoke_cancel_check,
)
from app.services.listing_rule_matching import (
    match_boolean_rule,
    match_numeric_rule,
    match_text_rule,
)
from app.utils.usage_stats import compute_usage_ratio_percent


def _clone_user(user: CephAdminRgwUserSummary) -> CephAdminRgwUserSummary:
    return user.model_copy(deep=True)


def _clone_user_list(
    items: list[CephAdminRgwUserSummary],
) -> list[CephAdminRgwUserSummary]:
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


def _match_user_field_rule(
    user: CephAdminRgwUserSummary,
    rule: CephAdminUserFilterRule,
) -> bool:
    field = rule.field
    op = rule.op
    if field == "quota_usage_size_percent":
        value = compute_usage_ratio_percent(
            user.used_bytes,
            user.quota_max_size_bytes,
        )
    elif field == "quota_usage_object_percent":
        value = compute_usage_ratio_percent(
            user.object_count,
            user.quota_max_objects,
        )
    else:
        value = getattr(user, field, None)
    if op == "is_null":
        return value is None
    if op == "not_null":
        return value is not None
    if field == "suspended":
        return match_boolean_rule(
            value,
            op,
            rule.value,
            coerce=coerce_bool,
            default_if_none=False,
        )
    if value is None:
        return False
    if field in {
        "uid",
        "tenant",
        "account_id",
        "account_name",
        "full_name",
        "email",
    }:
        return match_text_rule(value, op, rule.value)
    return match_numeric_rule(value, op, rule.value, coerce=coerce_number)


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
    if fields & {
        "quota_max_size_bytes",
        "quota_max_objects",
        "quota_usage_size_percent",
        "quota_usage_object_percent",
    }:
        include.add("quota")
    if fields & {
        "used_bytes",
        "object_count",
        "quota_usage_size_percent",
        "quota_usage_object_percent",
    }:
        include.add("usage")
    return include


def _user_from_entry(entry: object) -> CephAdminRgwUserSummary | None:
    if isinstance(entry, dict):
        raw_uid = entry.get("user") or entry.get("uid") or entry.get("id")
    else:
        raw_uid = entry
    uid = str(raw_uid or "").strip()
    if not uid:
        return None
    tenant, user_uid = split_tenant_uid(uid)
    return CephAdminRgwUserSummary(uid=user_uid if tenant else uid, tenant=tenant)


def _user_sort_key(
    user: CephAdminRgwUserSummary,
    sort_by: str,
) -> tuple[int, Any, str]:
    if sort_by == "tenant":
        value: Any = user.tenant or ""
    elif sort_by == "account_name":
        value = user.account_name or user.account_id or ""
    elif sort_by in {"full_name", "email"}:
        value = getattr(user, sort_by) or ""
    elif sort_by == "suspended":
        value = -1 if user.suspended is None else int(bool(user.suspended))
    elif sort_by in {"max_buckets", "quota_max_size_bytes", "quota_max_objects"}:
        value = getattr(user, sort_by)
    else:
        value = user.uid
    return listing_sort_key(value, user.uid or "")


class _UserListingPipeline:
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
        self.parsed_filter: CephAdminUserFilterQuery | None = None
        self.advanced_filter_active = False
        self.requested: set[str] = set()
        self.cache_key: EndpointListCacheKey | None = None

    def run(self) -> PaginatedCephAdminUsersResponse:
        self.progress.emit(
            percent=0,
            stage="prepare",
            message="Preparing advanced search",
            force=True,
        )
        invoke_cancel_check(self.cancel_check)
        self._prepare_query()
        if self.cache_key is None:
            raise RuntimeError("User listing cache key is not initialized")

        results = get_cached_users_listing(self.cache_key, self._build_listing)
        emit_listing_ready(
            self.progress,
            item_count=len(results),
            cancel_check=self.cancel_check,
        )
        filtered_results = self._search(results)
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
        return PaginatedCephAdminUsersResponse(
            items=page_items,
            total=total,
            page=self.page,
            page_size=self.page_size,
            has_next=has_next,
        )

    def _prepare_query(self) -> None:
        self.requested = parse_includes(self.include) & {
            "account",
            "profile",
            "status",
            "limits",
            "quota",
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

    def _build_listing(self) -> list[CephAdminRgwUserSummary]:
        self.progress.emit(
            percent=10,
            stage="load_entries",
            message="Loading RGW users",
            force=True,
        )
        invoke_cancel_check(self.cancel_check)
        payload = get_cached_rgw_users_payload(self.ctx)
        results = [
            user
            for entry in payload or []
            if (user := _user_from_entry(entry)) is not None
        ]
        self.progress.emit(
            percent=35,
            stage="scan_entries",
            processed=len(results),
            total=len(results),
            message="RGW user scanning completed",
            force=True,
        )
        invoke_cancel_check(self.cancel_check)
        requested = _includes_for_user_fields(
            collect_filter_fields(self.parsed_filter) | {self.sort_by or "uid"}
        )
        results = self._enrich_for_listing(results, requested)
        if self.advanced_filter_active:
            self.progress.emit(
                percent=65,
                stage="expensive_filters",
                processed=0,
                total=len(results),
                message="Applying advanced filters",
                force=True,
            )
        results = apply_advanced_filter(results, self.parsed_filter, _match_user_rules)
        invoke_cancel_check(self.cancel_check)
        results.sort(
            key=lambda user: _user_sort_key(user, self.sort_by),
            reverse=self.sort_dir == "desc",
        )
        if requested:
            for user in results:
                _clear_optional_user_details(user)
        return results

    def _enrich_for_listing(
        self,
        results: list[CephAdminRgwUserSummary],
        requested: set[str],
    ) -> list[CephAdminRgwUserSummary]:
        if not requested:
            return results
        self.progress.emit(
            percent=50,
            stage="detail_enrichment",
            processed=0,
            total=len(results),
            message="Loading user details",
            force=True,
        )
        enriched = enrich_users(
            results,
            requested,
            self.ctx,
            progress=self.progress,
            progress_stage="detail_enrichment",
            progress_message="Loading user details",
            progress_start=50,
            progress_end=64,
            cancel_check=self.cancel_check,
        )
        invoke_cancel_check(self.cancel_check)
        return enriched

    def _search(
        self,
        results: list[CephAdminRgwUserSummary],
    ) -> list[CephAdminRgwUserSummary]:
        return apply_simple_search(
            results,
            search=self.search,
            parsed_filter=self.parsed_filter,
            match_with_filter=lambda user, needle: needle in user.uid.lower(),
            match_without_filter=lambda user, needle: (
                needle in user.uid.lower() or needle in (user.tenant or "").lower()
            ),
        )

    def _paginate(
        self,
        filtered_results: list[CephAdminRgwUserSummary],
    ) -> tuple[list[CephAdminRgwUserSummary], int, bool]:
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
            clone=_clone_user_list,
        )

    def _enrich_page(
        self,
        page_items: list[CephAdminRgwUserSummary],
    ) -> list[CephAdminRgwUserSummary]:
        if not self.requested or not page_items:
            return page_items
        self.progress.emit(
            percent=92,
            stage="page_enrichment",
            processed=0,
            total=len(page_items),
            message="Loading page details",
            force=True,
        )
        enriched = enrich_users(
            page_items,
            self.requested,
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


def compute_users_listing(
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
) -> PaginatedCephAdminUsersResponse:
    return _UserListingPipeline(
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
