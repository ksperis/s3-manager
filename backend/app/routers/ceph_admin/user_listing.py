# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Any, Callable, Optional

from fastapi import status

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
    parse_int,
)
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
from app.services.bucket_listing_shared import listing_sort_key, serialize_filter
from app.services.listing_progress import (
    ListingProgressEmitter,
    ListingProgressSnapshot,
    interpolate_progress_percent,
    invoke_cancel_check,
)
from app.services.listing_rule_matching import (
    match_boolean_rule,
    match_numeric_rule,
    match_text_rule,
)
from app.services.rgw_admin import RGWAdminError
from app.utils.http_errors import raise_http_exception_from_exception
from app.utils.normalize import normalize_optional_scalar
from app.utils.quota_stats import extract_quota_limits
from app.utils.rgw_payloads import extract_bucket_list, extract_rgw_user_payload
from app.utils.usage_stats import compute_usage_ratio_percent, summarize_bucket_usage


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


class _UserDetailsEnricher:
    def __init__(
        self,
        *,
        users: list[CephAdminRgwUserSummary],
        requested: set[str],
        ctx: CephAdminContext,
        progress: ListingProgressEmitter | None,
        progress_stage: str,
        progress_message: str,
        progress_start: int,
        progress_end: int,
        cancel_check: Callable[[], None] | None,
    ) -> None:
        self.users = users
        self.requested = requested
        self.ctx = ctx
        self.progress = progress
        self.progress_stage = progress_stage
        self.progress_message = progress_message
        self.progress_start = progress_start
        self.progress_end = progress_end
        self.cancel_check = cancel_check
        self.account_name_by_id: dict[str, Optional[str]] = {}

    def run(self) -> list[CephAdminRgwUserSummary]:
        enriched: list[CephAdminRgwUserSummary] = []
        total = len(self.users)
        for index, item in enumerate(self.users, start=1):
            invoke_cancel_check(self.cancel_check)
            enriched.append(self._enrich_user(item))
            if self.progress is not None:
                self.progress.emit(
                    percent=interpolate_progress_percent(
                        self.progress_start,
                        self.progress_end,
                        processed=index,
                        total=total,
                    ),
                    stage=self.progress_stage,
                    processed=index,
                    total=total,
                    message=self.progress_message,
                )
            invoke_cancel_check(self.cancel_check)
        return enriched

    def _enrich_user(
        self,
        item: CephAdminRgwUserSummary,
    ) -> CephAdminRgwUserSummary:
        user = _clone_user(item)
        try:
            payload = self.ctx.rgw_admin.get_user(
                user.uid,
                tenant=user.tenant,
                allow_not_found=True,
            )
        except RGWAdminError as exc:
            raise_http_exception_from_exception(status.HTTP_502_BAD_GATEWAY, exc)
        if not payload or payload.get("not_found"):
            return user
        user_payload = extract_rgw_user_payload(payload)
        self._apply_payload(user, payload, user_payload)
        return user

    def _apply_payload(
        self,
        user: CephAdminRgwUserSummary,
        payload: dict[str, Any],
        user_payload: dict[str, Any],
    ) -> None:
        if "account" in self.requested:
            account_id = normalize_optional_scalar(
                payload.get("account_id") or user_payload.get("account_id")
            )
            user.account_id = account_id
            user.account_name = self._resolve_account_name(
                account_id,
                normalize_optional_scalar(
                    payload.get("account_name")
                    or user_payload.get("account_name")
                ),
            )
        if "profile" in self.requested:
            user.full_name = normalize_optional_scalar(
                user_payload.get("display_name") or payload.get("display_name")
            )
            user.email = normalize_optional_scalar(
                user_payload.get("email") or payload.get("email")
            )
        if "status" in self.requested:
            user.suspended = parse_suspended(
                user_payload.get("suspended") or payload.get("suspended")
            )
        if "limits" in self.requested:
            user.max_buckets = parse_int(
                user_payload.get("max_buckets") or payload.get("max_buckets")
            )
        if "quota" in self.requested:
            quota_size, quota_objects = extract_quota_limits(
                payload,
                keys=("user_quota", "quota"),
            )
            user.quota_max_size_bytes = quota_size
            user.quota_max_objects = quota_objects
        if "usage" in self.requested:
            self._apply_usage(user)

    def _resolve_account_name(
        self,
        account_id: str | None,
        payload_account_name: str | None,
    ) -> str | None:
        if not account_id:
            return payload_account_name
        if account_id not in self.account_name_by_id:
            account_payload = None
            if optional_account_lookup_enabled(self.ctx) is not False:
                try:
                    account_payload = self.ctx.rgw_admin.get_account(
                        account_id,
                        allow_not_found=True,
                        allow_not_implemented=True,
                    )
                except RGWAdminError as exc:
                    raise_http_exception_from_exception(
                        status.HTTP_502_BAD_GATEWAY,
                        exc,
                    )
            self.account_name_by_id[account_id] = normalize_optional_scalar(
                account_payload.get("name")
                if isinstance(account_payload, dict)
                else None
            )
        return self.account_name_by_id.get(account_id) or payload_account_name

    def _apply_usage(self, user: CephAdminRgwUserSummary) -> None:
        lookup_uid = f"{user.tenant}${user.uid}" if user.tenant else user.uid
        try:
            buckets_payload = self.ctx.rgw_admin.get_all_buckets(
                uid=lookup_uid,
                with_stats=True,
            )
        except RGWAdminError as exc:
            raise_http_exception_from_exception(status.HTTP_502_BAD_GATEWAY, exc)
        _usage, total_bytes, total_objects, _count = summarize_bucket_usage(
            extract_bucket_list(buckets_payload)
        )
        user.used_bytes = total_bytes
        user.object_count = total_objects


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
    return _UserDetailsEnricher(
        users=users,
        requested=requested,
        ctx=ctx,
        progress=progress,
        progress_stage=progress_stage,
        progress_message=progress_message,
        progress_start=progress_start,
        progress_end=progress_end,
        cancel_check=cancel_check,
    ).run()


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
        self._emit_listing_ready(results)
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
        enriched = _enrich_users(
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

    def _emit_listing_ready(self, results: list[CephAdminRgwUserSummary]) -> None:
        self.progress.emit(
            percent=75,
            stage="listing_ready",
            processed=len(results),
            total=len(results),
            message="Base listing ready",
            force=True,
        )
        invoke_cancel_check(self.cancel_check)

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
        enriched = _enrich_users(
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
