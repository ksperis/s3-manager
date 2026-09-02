# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from dataclasses import dataclass
import logging
from typing import Any, Callable, Protocol

from app.db import StorageEndpoint
from app.models.ceph_admin import (
    CephAdminBucketFilterQuery,
    CephAdminBucketFilterRule,
    CephAdminBucketSummary,
    PaginatedCephAdminBucketsResponse,
)
from app.services import rgw_bucket_metadata
from app.services.bucket_listing_enrichment import (
    BUCKET_FEATURE_INCLUDES,
    COLUMN_DETAIL_KEYS,
    enrich_buckets,
)
from app.services.bucket_listing_owner_metadata import (
    OWNER_QUOTA_FIELDS,
    OWNER_STATUS_FIELDS,
    OWNER_USAGE_FIELDS,
    OWNER_USAGE_PERCENT_FIELDS,
    apply_owner_enrichment,
    backfill_bucket_owner_metadata,
    determine_owner_name_lookup_scope,
    filter_requires_owner_usage,
    request_requires_owner_metadata,
    request_requires_tenant_metadata,
    resolve_owner_names_for_buckets,
)
from app.services.bucket_listing_rule_matching import (
    EXPENSIVE_FIELD_RULES,
    extract_name_candidates,
    match_bucket_feature_rule,
    match_bucket_field_rule,
    request_requires_bucket_stats,
)
from app.services.bucket_ui_tags_service import BucketUiTagsService, PhysicalBucketTarget
from app.utils.tagging import TAG_DOMAIN_BUCKET_UI_CEPH_ADMIN
from app.services.bucket_feature_param_matching import match_bucket_feature_param_rules
from app.services.bucket_feature_param_snapshot_loader import (
    bucket_identity_key,
    load_bucket_feature_param_snapshots,
)
from app.services.bucket_listing_shared import parse_filter, parse_includes, serialize_filter
from app.services.bucket_owner_enrichment import BucketOwnerUsage, compute_bucket_owner_usage
from app.services.bucket_configuration_service import BucketConfigurationService
from app.services.ceph_admin_bucket_listing_cache import (
    CephAdminBucketListCacheKey,
    CephAdminBucketListingSnapshot,
    clone_ceph_admin_bucket_list,
    get_cached_bucket_listing,
    get_cached_rgw_bucket_entries,
)
from app.services.listing_progress import (
    ListingProgressEmitter,
    ListingProgressSnapshot,
    invoke_cancel_check,
)
from app.services.rgw_admin import RGWAdminClient, RGWAdminError
from app.services.s3_execution_context import S3ExecutionContext
from app.utils.http_errors import is_upstream_timeout

logger = logging.getLogger(__name__)

_BUCKET_STATS_UNAVAILABLE_WARNING = (
    "Bucket stats are unavailable via Ceph Admin credentials on this endpoint. "
    "Showing owner metadata without usage or quota values."
)
class CephAdminBucketListingContext(Protocol):
    endpoint: StorageEndpoint
    rgw_admin: RGWAdminClient
    access_key: str
    secret_key: str


class RequiredBucketStatsUnavailableError(RuntimeError):
    """Raised when a listing contract requires unavailable RGW bucket statistics."""


def _build_s3_context(ctx: CephAdminBucketListingContext) -> S3ExecutionContext:
    return S3ExecutionContext.from_ceph_admin_endpoint(
        ctx.endpoint,
        access_key=ctx.access_key,
        secret_key=ctx.secret_key,
    )


def _progress_options(
    *,
    progress: ListingProgressEmitter,
    include_progress_hooks: bool,
    cancel_check: Callable[[], None] | None,
    stage: str,
    message: str,
    start: int,
    end: int,
) -> dict[str, Any]:
    if not include_progress_hooks:
        return {}
    return {
        "progress": progress,
        "progress_stage": stage,
        "progress_message": message,
        "progress_start": start,
        "progress_end": end,
        "cancel_check": cancel_check,
    }


@dataclass(frozen=True)
class _CephAdminBucketListingRequest:
    simple_filter: str | None
    advanced_filter: CephAdminBucketFilterQuery | None
    sort_by: str
    sort_dir: str
    with_stats: bool
    stats_required: bool
    wants_owner_name: bool
    wants_owner_suspended: bool
    wants_owner_quota: bool
    wants_owner_quota_usage: bool
    owner_usage_required: bool
    needs_owner_metadata: bool
    needs_tenant_metadata: bool
    requested_features: frozenset[str]
    requested_detail_fields: frozenset[str]
    include_tags: bool
    ui_tag_ids: tuple[int, ...]
    ui_tag_match: str

    @classmethod
    def parse(
        cls,
        *,
        raw_filter: str | None,
        raw_advanced_filter: str | None,
        sort_by: str,
        sort_dir: str,
        include: list[str],
        with_stats: bool,
        ui_tag_ids: list[int] | None = None,
        ui_tag_match: str = "any",
        with_ui_tags: bool = False,
    ) -> _CephAdminBucketListingRequest:
        if raw_advanced_filter:
            simple_filter = (
                raw_filter.strip()
                if isinstance(raw_filter, str) and raw_filter.strip()
                else None
            )
            _, advanced_filter = parse_filter(raw_advanced_filter)
        else:
            simple_filter, advanced_filter = parse_filter(raw_filter)
        simple_filter = (
            simple_filter.strip()
            if isinstance(simple_filter, str) and simple_filter.strip()
            else None
        )
        stats_required = request_requires_bucket_stats(advanced_filter, sort_by)
        include_set = parse_includes(include)
        wants_owner_name = "owner_name" in include_set
        wants_owner_suspended = "owner_suspended" in include_set
        wants_owner_quota = "owner_quota" in include_set
        wants_owner_quota_usage = "owner_quota_usage" in include_set
        owner_usage_required = wants_owner_quota_usage or filter_requires_owner_usage(advanced_filter)
        return cls(
            simple_filter=simple_filter,
            advanced_filter=advanced_filter,
            sort_by=sort_by,
            sort_dir=sort_dir,
            with_stats=with_stats or stats_required,
            stats_required=stats_required,
            wants_owner_name=wants_owner_name,
            wants_owner_suspended=wants_owner_suspended,
            wants_owner_quota=wants_owner_quota,
            wants_owner_quota_usage=wants_owner_quota_usage,
            owner_usage_required=owner_usage_required,
            needs_owner_metadata=request_requires_owner_metadata(
                advanced_filter,
                sort_by,
                simple_filter if not advanced_filter else None,
            ) or with_ui_tags,
            needs_tenant_metadata=request_requires_tenant_metadata(
                advanced_filter,
                sort_by,
                simple_filter if not advanced_filter else None,
            ) or with_ui_tags,
            requested_features=frozenset(include_set & BUCKET_FEATURE_INCLUDES),
            requested_detail_fields=frozenset(include_set & COLUMN_DETAIL_KEYS),
            include_tags="tags" in include_set,
            ui_tag_ids=tuple(dict.fromkeys(int(item) for item in (ui_tag_ids or []) if int(item) > 0)),
            ui_tag_match="all" if ui_tag_match == "all" else "any",
        )

    def cache_key(self, ctx: CephAdminBucketListingContext) -> CephAdminBucketListCacheKey:
        return CephAdminBucketListCacheKey(
            endpoint_id=int(getattr(ctx.endpoint, "id", 0) or 0),
            advanced_filter=serialize_filter(self.advanced_filter),
            sort_by=self.sort_by,
            sort_dir=self.sort_dir,
            with_stats=self.with_stats,
            with_owner_metadata=self.needs_owner_metadata,
            with_owner_usage=self.owner_usage_required,
        )


@dataclass(frozen=True)
class _LoadedBucketEntries:
    entries: list[dict]
    effective_with_stats: bool
    stats_available: bool
    stats_warning: str | None


@dataclass(frozen=True)
class _AdvancedFilterPlan:
    query: CephAdminBucketFilterQuery
    field_rules: list[CephAdminBucketFilterRule]
    feature_state_rules: list[CephAdminBucketFilterRule]
    feature_param_rules: list[CephAdminBucketFilterRule]
    expensive_field_rules: list[CephAdminBucketFilterRule]
    cheap_field_rules: list[CephAdminBucketFilterRule]
    filter_features: set[str]
    requires_tag_lookup: bool
    requires_owner_name_lookup: bool
    requires_owner_suspended_lookup: bool
    requires_owner_quota_lookup: bool
    requires_owner_usage_lookup: bool

    @classmethod
    def from_query(cls, query: CephAdminBucketFilterQuery) -> _AdvancedFilterPlan:
        field_rules = [rule for rule in query.rules if rule.field]
        feature_state_rules = [rule for rule in query.rules if rule.feature and rule.state is not None]
        feature_param_rules = [rule for rule in query.rules if rule.feature and rule.param is not None]
        expensive_field_rules = [rule for rule in field_rules if rule.field in EXPENSIVE_FIELD_RULES]
        cheap_field_rules = [rule for rule in field_rules if rule.field not in EXPENSIVE_FIELD_RULES]
        return cls(
            query=query,
            field_rules=field_rules,
            feature_state_rules=feature_state_rules,
            feature_param_rules=feature_param_rules,
            expensive_field_rules=expensive_field_rules,
            cheap_field_rules=cheap_field_rules,
            filter_features={rule.feature for rule in feature_state_rules if rule.feature},
            requires_tag_lookup=any(rule.field == "tag" for rule in expensive_field_rules),
            requires_owner_name_lookup=any(rule.field == "owner_name" for rule in expensive_field_rules),
            requires_owner_suspended_lookup=any(rule.field in OWNER_STATUS_FIELDS for rule in expensive_field_rules),
            requires_owner_quota_lookup=any(
                rule.field in (OWNER_QUOTA_FIELDS | OWNER_USAGE_PERCENT_FIELDS)
                for rule in expensive_field_rules
            ),
            requires_owner_usage_lookup=any(
                rule.field in (OWNER_USAGE_FIELDS | OWNER_USAGE_PERCENT_FIELDS)
                for rule in expensive_field_rules
            ),
        )

    @property
    def has_expensive_rules(self) -> bool:
        return bool(self.expensive_field_rules or self.feature_state_rules or self.feature_param_rules)


class _CephAdminBucketSnapshotBuilder:
    def __init__(
        self,
        *,
        ctx: CephAdminBucketListingContext,
        request: _CephAdminBucketListingRequest,
        progress: ListingProgressEmitter,
        include_progress_hooks: bool,
        cancel_check: Callable[[], None] | None,
    ) -> None:
        self.ctx = ctx
        self.request = request
        self.progress = progress
        self.include_progress_hooks = include_progress_hooks
        self.cancel_check = cancel_check

    def build(self) -> CephAdminBucketListingSnapshot:
        invoke_cancel_check(self.cancel_check)
        loaded = self._load_entries()
        results = self._build_summaries(loaded)
        results = self._backfill_owner_metadata(results)
        owner_usage_by_key = (
            compute_bucket_owner_usage(results)
            if loaded.effective_with_stats and results
            else None
        )
        results = self._apply_advanced_filter(results, owner_usage_by_key)
        invoke_cancel_check(self.cancel_check)
        results = self._sort_results(results)
        return CephAdminBucketListingSnapshot(
            items=results,
            stats_available=loaded.stats_available,
            stats_warning=loaded.stats_warning,
            owner_usage_by_key=owner_usage_by_key,
        )

    def _load_entries(self) -> _LoadedBucketEntries:
        name_candidates = (
            None
            if self.request.owner_usage_required
            else extract_name_candidates(self.request.advanced_filter)
        )
        try:
            entries = self._fetch_entries(self.request.with_stats, name_candidates)
        except RGWAdminError as exc:
            if not self.request.with_stats:
                raise
            if is_upstream_timeout(exc):
                raise
            if self.request.stats_required:
                raise RequiredBucketStatsUnavailableError(
                    "Bucket stats are unavailable via Ceph Admin credentials for this request"
                ) from exc
            logger.warning(
                "Ceph admin bucket listing stats fallback on endpoint=%s error=%s",
                getattr(getattr(self.ctx, "endpoint", None), "id", "unknown"),
                exc,
            )
            self.progress.emit(
                percent=12,
                stage="fetch_rgw_fallback",
                message="Bucket stats unavailable, retrying without stats",
                force=True,
            )
            entries = self._fetch_entries(False, name_candidates)
            return _LoadedBucketEntries(
                entries=entries,
                effective_with_stats=False,
                stats_available=False,
                stats_warning=_BUCKET_STATS_UNAVAILABLE_WARNING,
            )
        return _LoadedBucketEntries(
            entries=entries,
            effective_with_stats=self.request.with_stats,
            stats_available=True,
            stats_warning=None,
        )

    def _fetch_entries(
        self,
        request_with_stats: bool,
        name_candidates: list[str] | None,
    ) -> list[dict]:
        self.progress.emit(percent=10, stage="fetch_rgw", message="Loading buckets from RGW", force=True)
        if name_candidates is None:
            return get_cached_rgw_bucket_entries(self.ctx, with_stats=request_with_stats)
        if not name_candidates:
            return []
        allowed_names = set(name_candidates)
        return [
            entry
            for entry in get_cached_rgw_bucket_entries(self.ctx, with_stats=request_with_stats)
            if rgw_bucket_metadata.extract_bucket_name(entry) in allowed_names
        ]

    def _build_summaries(self, loaded: _LoadedBucketEntries) -> list[CephAdminBucketSummary]:
        entries = loaded.entries
        self.progress.emit(
            percent=15,
            stage="fetch_rgw",
            processed=len(entries),
            total=len(entries),
            message="RGW bucket payload loaded",
            force=True,
        )
        results: list[CephAdminBucketSummary] = []
        total_entries = len(entries)
        for index, entry in enumerate(entries, start=1):
            invoke_cancel_check(self.cancel_check)
            summary = rgw_bucket_metadata.build_bucket_summary(entry)
            if summary:
                if not loaded.effective_with_stats:
                    summary.used_bytes = None
                    summary.object_count = None
                    summary.quota_max_size_bytes = None
                    summary.quota_max_objects = None
                results.append(summary)
            percent = 15 + int((index / total_entries) * 45) if total_entries > 0 else 60
            self.progress.emit(
                percent=percent,
                stage="scan_entries",
                processed=index,
                total=total_entries,
                message="Scanning RGW bucket entries",
            )
        self.progress.emit(
            percent=60,
            stage="scan_entries",
            processed=total_entries,
            total=total_entries,
            message="Bucket scanning completed",
            force=True,
        )
        invoke_cancel_check(self.cancel_check)
        return results

    def _backfill_owner_metadata(
        self,
        results: list[CephAdminBucketSummary],
    ) -> list[CephAdminBucketSummary]:
        if not self.request.needs_owner_metadata or not results:
            return results
        self.progress.emit(
            percent=63,
            stage="owner_backfill",
            processed=0,
            total=len(results),
            message="Loading bucket owner metadata",
            force=True,
        )
        return backfill_bucket_owner_metadata(
            self.ctx,
            results,
            include_tenant=self.request.needs_tenant_metadata,
            **_progress_options(
                progress=self.progress,
                include_progress_hooks=self.include_progress_hooks,
                cancel_check=self.cancel_check,
                stage="owner_backfill",
                message="Loading bucket owner metadata",
                start=63,
                end=65,
            ),
        )

    def _apply_advanced_filter(
        self,
        results: list[CephAdminBucketSummary],
        owner_usage_by_key: dict[str, BucketOwnerUsage] | None,
    ) -> list[CephAdminBucketSummary]:
        if not self.request.advanced_filter or not self.request.advanced_filter.rules:
            self.progress.emit(
                percent=90,
                stage="expensive_filters",
                message="No expensive filters",
                force=True,
            )
            return results

        self.progress.emit(
            percent=65,
            stage="expensive_filters",
            message="Applying advanced filters",
            force=True,
        )
        plan = _AdvancedFilterPlan.from_query(self.request.advanced_filter)
        results = self._apply_cheap_field_rules(results, plan)
        if plan.has_expensive_rules:
            results = self._apply_expensive_rules(results, plan, owner_usage_by_key)
            self._clear_transient_enrichment(results)
        self.progress.emit(
            percent=90,
            stage="expensive_filters",
            message="Advanced filters applied",
            force=True,
        )
        return results

    @staticmethod
    def _apply_cheap_field_rules(
        results: list[CephAdminBucketSummary],
        plan: _AdvancedFilterPlan,
    ) -> list[CephAdminBucketSummary]:
        if not plan.cheap_field_rules:
            return results
        if plan.query.match == "all":
            return [
                bucket
                for bucket in results
                if all(match_bucket_field_rule(bucket, rule) for rule in plan.cheap_field_rules)
            ]
        if not plan.has_expensive_rules:
            return [
                bucket
                for bucket in results
                if any(match_bucket_field_rule(bucket, rule) for rule in plan.cheap_field_rules)
            ]
        return results

    def _apply_expensive_rules(
        self,
        results: list[CephAdminBucketSummary],
        plan: _AdvancedFilterPlan,
        owner_usage_by_key: dict[str, BucketOwnerUsage] | None,
    ) -> list[CephAdminBucketSummary]:
        field_matched: list[CephAdminBucketSummary] = []
        candidates = results
        if not plan.feature_param_rules and plan.query.match == "any" and plan.cheap_field_rules:
            field_matched, candidates = self._partition_cheap_matches(results, plan.cheap_field_rules)

        service = BucketConfigurationService()
        account = _build_s3_context(self.ctx)
        candidates = self._enrich_expensive_candidates(
            candidates,
            plan,
            owner_usage_by_key,
            service,
            account,
        )
        if plan.feature_param_rules:
            return self._filter_feature_param_candidates(candidates, plan, service, account)

        matched = self._filter_nonparam_candidates(candidates, plan)
        return field_matched + matched

    @staticmethod
    def _partition_cheap_matches(
        results: list[CephAdminBucketSummary],
        rules: list[CephAdminBucketFilterRule],
    ) -> tuple[list[CephAdminBucketSummary], list[CephAdminBucketSummary]]:
        matched: list[CephAdminBucketSummary] = []
        unresolved: list[CephAdminBucketSummary] = []
        for bucket in results:
            target = matched if any(match_bucket_field_rule(bucket, rule) for rule in rules) else unresolved
            target.append(bucket)
        return matched, unresolved

    def _enrich_expensive_candidates(
        self,
        candidates: list[CephAdminBucketSummary],
        plan: _AdvancedFilterPlan,
        owner_usage_by_key: dict[str, BucketOwnerUsage] | None,
        service: BucketConfigurationService,
        account: S3ExecutionContext,
    ) -> list[CephAdminBucketSummary]:
        if plan.requires_owner_name_lookup and candidates:
            self._enrich_owner_names(candidates)
        if (
            plan.requires_owner_suspended_lookup
            or plan.requires_owner_quota_lookup
            or plan.requires_owner_usage_lookup
        ) and candidates:
            candidates = apply_owner_enrichment(
                self.ctx,
                candidates,
                include_suspended=plan.requires_owner_suspended_lookup,
                include_quota=plan.requires_owner_quota_lookup,
                include_usage=plan.requires_owner_usage_lookup,
                usage_by_key=owner_usage_by_key,
            )
        if not candidates or not (plan.filter_features or plan.requires_tag_lookup):
            return candidates

        progress_end = 82 if plan.feature_param_rules else 88
        self.progress.emit(
            percent=75,
            stage="bucket_enrichment",
            processed=0,
            total=len(candidates),
            message="Loading bucket details",
            force=True,
        )
        return enrich_buckets(
            candidates,
            {feature for feature in plan.filter_features if feature != "tags"},
            include_tags=plan.requires_tag_lookup or ("tags" in plan.filter_features),
            service=service,
            account=account,
            **_progress_options(
                progress=self.progress,
                include_progress_hooks=self.include_progress_hooks,
                cancel_check=self.cancel_check,
                stage="bucket_enrichment",
                message="Loading bucket details",
                start=75,
                end=progress_end,
            ),
        )

    def _enrich_owner_names(self, candidates: list[CephAdminBucketSummary]) -> None:
        owner_scope = determine_owner_name_lookup_scope(self.request.advanced_filter)
        owner_name_by_key = resolve_owner_names_for_buckets(
            self.ctx,
            candidates,
            owner_scope=owner_scope,
        )
        for bucket in candidates:
            if not bucket.owner:
                bucket.owner_name = None
                continue
            owner_key = f"{bucket.tenant or ''}:{bucket.owner}"
            bucket.owner_name = owner_name_by_key.get(owner_key)

    def _filter_feature_param_candidates(
        self,
        candidates: list[CephAdminBucketSummary],
        plan: _AdvancedFilterPlan,
        service: BucketConfigurationService,
        account: S3ExecutionContext,
    ) -> list[CephAdminBucketSummary]:
        if candidates:
            self.progress.emit(
                percent=82,
                stage="feature_param_enrichment",
                processed=0,
                total=len(candidates),
                message="Loading bucket feature parameters",
                force=True,
            )
        snapshots, available_keys = load_bucket_feature_param_snapshots(
            candidates,
            plan.feature_param_rules,
            service=service,
            account=account,
            **_progress_options(
                progress=self.progress,
                include_progress_hooks=self.include_progress_hooks,
                cancel_check=self.cancel_check,
                stage="feature_param_enrichment",
                message="Loading bucket feature parameters",
                start=82,
                end=88,
            ),
        )
        return [
            bucket
            for bucket in candidates
            if self._matches_feature_param_candidate(bucket, plan, snapshots, available_keys)
        ]

    @staticmethod
    def _matches_feature_param_candidate(
        bucket: CephAdminBucketSummary,
        plan: _AdvancedFilterPlan,
        snapshots: dict[str, dict[str, object]],
        available_keys: set[str],
    ) -> bool:
        bucket_key = bucket_identity_key(bucket)
        if bucket_key not in available_keys:
            return False
        snapshot = snapshots.get(bucket_key, {})
        if plan.query.match == "all":
            field_match = (
                all(match_bucket_field_rule(bucket, rule) for rule in plan.field_rules)
                if plan.field_rules
                else True
            )
            state_match = (
                all(match_bucket_feature_rule(bucket, rule) for rule in plan.feature_state_rules)
                if plan.feature_state_rules
                else True
            )
            return field_match and state_match and match_bucket_feature_param_rules(
                plan.feature_param_rules,
                plan.query.match,
                snapshot,
            )
        field_match = (
            any(match_bucket_field_rule(bucket, rule) for rule in plan.field_rules)
            if plan.field_rules
            else False
        )
        state_match = (
            any(match_bucket_feature_rule(bucket, rule) for rule in plan.feature_state_rules)
            if plan.feature_state_rules
            else False
        )
        return field_match or state_match or match_bucket_feature_param_rules(
            plan.feature_param_rules,
            plan.query.match,
            snapshot,
        )

    @staticmethod
    def _filter_nonparam_candidates(
        candidates: list[CephAdminBucketSummary],
        plan: _AdvancedFilterPlan,
    ) -> list[CephAdminBucketSummary]:
        if plan.query.match == "all":
            return [
                bucket
                for bucket in candidates
                if (
                    all(match_bucket_field_rule(bucket, rule) for rule in plan.expensive_field_rules)
                    if plan.expensive_field_rules
                    else True
                )
                and (
                    all(match_bucket_feature_rule(bucket, rule) for rule in plan.feature_state_rules)
                    if plan.feature_state_rules
                    else True
                )
            ]
        return [
            bucket
            for bucket in candidates
            if (
                any(match_bucket_field_rule(bucket, rule) for rule in plan.expensive_field_rules)
                if plan.expensive_field_rules
                else False
            )
            or (
                any(match_bucket_feature_rule(bucket, rule) for rule in plan.feature_state_rules)
                if plan.feature_state_rules
                else False
            )
        ]

    @staticmethod
    def _clear_transient_enrichment(results: list[CephAdminBucketSummary]) -> None:
        for bucket in results:
            bucket.features = None
            bucket.tags = None
            bucket.column_details = None

    def _sort_value(self, bucket: CephAdminBucketSummary) -> str | int | None:
        if self.request.sort_by == "tenant":
            value: str | int | None = bucket.tenant or ""
        elif self.request.sort_by == "owner":
            value = bucket.owner or ""
        elif self.request.sort_by == "used_bytes":
            value = bucket.used_bytes if bucket.used_bytes is not None else 0
        elif self.request.sort_by == "object_count":
            value = bucket.object_count if bucket.object_count is not None else 0
        else:
            value = bucket.name
        return value.lower() if isinstance(value, str) else value

    def _sort_results(
        self,
        results: list[CephAdminBucketSummary],
    ) -> list[CephAdminBucketSummary]:
        sortable: list[tuple[object, CephAdminBucketSummary]] = []
        missing_values: list[CephAdminBucketSummary] = []
        for bucket in results:
            value = self._sort_value(bucket)
            if value is None:
                missing_values.append(bucket)
            else:
                sortable.append((value, bucket))
        sortable.sort(key=lambda item: item[0], reverse=self.request.sort_dir == "desc")
        return [bucket for _, bucket in sortable] + missing_values


class _CephAdminBucketPageBuilder:
    def __init__(
        self,
        *,
        ctx: CephAdminBucketListingContext,
        request: _CephAdminBucketListingRequest,
        listing: CephAdminBucketListingSnapshot,
        progress: ListingProgressEmitter,
        include_progress_hooks: bool,
        cancel_check: Callable[[], None] | None,
        bucket_ui_tags_service: BucketUiTagsService | None,
        actor_user_id: int | None,
    ) -> None:
        self.ctx = ctx
        self.request = request
        self.listing = listing
        self.progress = progress
        self.include_progress_hooks = include_progress_hooks
        self.cancel_check = cancel_check
        self.bucket_ui_tags_service = bucket_ui_tags_service
        self.actor_user_id = actor_user_id

    def build(self, *, page: int, page_size: int) -> PaginatedCephAdminBucketsResponse:
        self.progress.emit(
            percent=92,
            stage="sort_paginate",
            message="Sorting and paginating results",
            force=True,
        )
        filtered_results = self._apply_simple_filter(self.listing.items)
        filtered_results = self._apply_ui_tags(filtered_results)
        invoke_cancel_check(self.cancel_check)
        total = len(filtered_results)
        start = max(page - 1, 0) * page_size
        end = start + page_size
        page_items = clone_ceph_admin_bucket_list(filtered_results[start:end])
        page_items = self._backfill_owner_metadata(page_items)
        page_items = self._enrich_bucket_details(page_items)
        self._enrich_owner_names(page_items)
        page_items = self._enrich_owner_attributes(page_items)
        invoke_cancel_check(self.cancel_check)
        response = PaginatedCephAdminBucketsResponse(
            items=page_items,
            total=total,
            page=page,
            page_size=page_size,
            has_next=end < total,
            stats_available=self.listing.stats_available,
            stats_warning=self.listing.stats_warning,
        )
        self.progress.emit(
            percent=100,
            stage="finalize",
            processed=total,
            total=total,
            message="Search completed",
            force=True,
        )
        return response

    def _apply_ui_tags(
        self,
        results: list[CephAdminBucketSummary],
    ) -> list[CephAdminBucketSummary]:
        if self.bucket_ui_tags_service is None or self.actor_user_id is None:
            return results
        results = clone_ceph_admin_bucket_list(results)
        targets = [
            PhysicalBucketTarget.create(self.ctx.endpoint.id, bucket.tenant, bucket.name)
            for bucket in results
        ]
        tags_by_target = self.bucket_ui_tags_service.get_tags_for_targets(
            domain_kind=TAG_DOMAIN_BUCKET_UI_CEPH_ADMIN,
            actor_user_id=self.actor_user_id,
            targets=targets,
        )
        requested = set(self.request.ui_tag_ids)
        matched: list[CephAdminBucketSummary] = []
        for bucket, target in zip(results, targets):
            bucket.ui_tags = list(tags_by_target.get(target, []))
            if not requested:
                matched.append(bucket)
                continue
            assigned = {tag.id for tag in bucket.ui_tags}
            include = requested.issubset(assigned) if self.request.ui_tag_match == "all" else bool(requested & assigned)
            if include:
                matched.append(bucket)
        return matched

    def _apply_simple_filter(
        self,
        results: list[CephAdminBucketSummary],
    ) -> list[CephAdminBucketSummary]:
        if not self.request.simple_filter:
            return results
        filter_value = self.request.simple_filter.lower()
        if self.request.advanced_filter:
            return [bucket for bucket in results if filter_value in bucket.name.lower()]
        return [
            bucket
            for bucket in results
            if filter_value in bucket.name.lower()
            or filter_value in (bucket.tenant or "").lower()
            or filter_value in (bucket.owner or "").lower()
        ]

    def _backfill_owner_metadata(
        self,
        page_items: list[CephAdminBucketSummary],
    ) -> list[CephAdminBucketSummary]:
        if not page_items:
            return page_items
        self.progress.emit(
            percent=94,
            stage="page_enrichment",
            processed=0,
            total=len(page_items),
            message="Loading page bucket metadata",
            force=True,
        )
        return backfill_bucket_owner_metadata(
            self.ctx,
            page_items,
            include_tenant=(
                self.request.wants_owner_name
                or self.request.wants_owner_suspended
                or self.request.wants_owner_quota
                or self.request.wants_owner_quota_usage
            ),
            **_progress_options(
                progress=self.progress,
                include_progress_hooks=self.include_progress_hooks,
                cancel_check=self.cancel_check,
                stage="page_enrichment",
                message="Loading page bucket metadata",
                start=94,
                end=96,
            ),
        )

    def _enrich_bucket_details(
        self,
        page_items: list[CephAdminBucketSummary],
    ) -> list[CephAdminBucketSummary]:
        requested = set(self.request.requested_features) | set(self.request.requested_detail_fields)
        if not requested and not self.request.include_tags:
            return page_items
        self.progress.emit(
            percent=96,
            stage="page_enrichment",
            processed=0,
            total=len(page_items),
            message="Loading page bucket details",
            force=True,
        )
        return enrich_buckets(
            page_items,
            requested,
            include_tags=self.request.include_tags,
            service=BucketConfigurationService(),
            account=_build_s3_context(self.ctx),
            **_progress_options(
                progress=self.progress,
                include_progress_hooks=self.include_progress_hooks,
                cancel_check=self.cancel_check,
                stage="page_enrichment",
                message="Loading page bucket details",
                start=96,
                end=99,
            ),
        )

    def _enrich_owner_names(self, page_items: list[CephAdminBucketSummary]) -> None:
        if not self.request.wants_owner_name or not page_items:
            return
        owner_name_by_key = resolve_owner_names_for_buckets(self.ctx, page_items, owner_scope="any")
        for bucket in page_items:
            if not bucket.owner:
                bucket.owner_name = None
                continue
            owner_key = f"{bucket.tenant or ''}:{bucket.owner}"
            bucket.owner_name = owner_name_by_key.get(owner_key, bucket.owner_name)

    def _enrich_owner_attributes(
        self,
        page_items: list[CephAdminBucketSummary],
    ) -> list[CephAdminBucketSummary]:
        if not page_items or not (
            self.request.wants_owner_suspended
            or self.request.wants_owner_quota
            or self.request.wants_owner_quota_usage
        ):
            return page_items
        return apply_owner_enrichment(
            self.ctx,
            page_items,
            include_suspended=self.request.wants_owner_suspended,
            include_quota=self.request.wants_owner_quota or self.request.wants_owner_quota_usage,
            include_usage=self.request.wants_owner_quota_usage,
            usage_by_key=self.listing.owner_usage_by_key,
        )


def compute_ceph_admin_bucket_listing(
    *,
    page: int,
    page_size: int,
    filter: str | None,
    advanced_filter: str | None,
    sort_by: str,
    sort_dir: str,
    include: list[str],
    with_stats: bool,
    ctx: CephAdminBucketListingContext,
    ui_tag_ids: list[int] | None = None,
    ui_tag_match: str = "any",
    bucket_ui_tags_service: BucketUiTagsService | None = None,
    actor_user_id: int | None = None,
    progress_callback: Callable[[ListingProgressSnapshot], None] | None = None,
    cancel_check: Callable[[], None] | None = None,
) -> PaginatedCephAdminBucketsResponse:
    progress = ListingProgressEmitter(progress_callback)
    include_progress_hooks = progress_callback is not None or cancel_check is not None
    invoke_cancel_check(cancel_check)
    progress.emit(percent=5, stage="prepare", message="Preparing advanced search", force=True)
    listing_request = _CephAdminBucketListingRequest.parse(
        raw_filter=filter,
        raw_advanced_filter=advanced_filter,
        sort_by=sort_by,
        sort_dir=sort_dir,
        include=include,
        with_stats=with_stats,
        ui_tag_ids=ui_tag_ids,
        ui_tag_match=ui_tag_match,
        with_ui_tags=bucket_ui_tags_service is not None,
    )
    invoke_cancel_check(cancel_check)
    snapshot_builder = _CephAdminBucketSnapshotBuilder(
        ctx=ctx,
        request=listing_request,
        progress=progress,
        include_progress_hooks=include_progress_hooks,
        cancel_check=cancel_check,
    )
    invoke_cancel_check(cancel_check)
    listing = get_cached_bucket_listing(listing_request.cache_key(ctx), snapshot_builder.build)
    return _CephAdminBucketPageBuilder(
        ctx=ctx,
        request=listing_request,
        listing=listing,
        progress=progress,
        include_progress_hooks=include_progress_hooks,
        cancel_check=cancel_check,
        bucket_ui_tags_service=bucket_ui_tags_service,
        actor_user_id=actor_user_id,
    ).build(page=page, page_size=page_size)
