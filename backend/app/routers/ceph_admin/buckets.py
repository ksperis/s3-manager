# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import StreamingResponse
from app.core.sensitive_data import sanitize_error_detail
from app.models.ceph_admin import (
    CephAdminBucketFilterQuery,
    CephAdminBucketListingRequest,
    CephAdminBucketSummary,
    PaginatedCephAdminBucketsResponse,
)
from app.routers.ceph_admin import bucket_config, bucket_tools
from app.routers.ceph_admin.dependencies import (
    CephAdminContext,
    build_ceph_admin_s3_context,
    get_ceph_admin_context,
)
from app.services.ceph_admin_bucket_listing_cache import (
    CephAdminBucketListCacheKey,
    CephAdminBucketListingSnapshot,
    clone_ceph_admin_bucket_list,
    get_cached_bucket_listing,
    get_cached_rgw_bucket_entries,
)
from app.services.bucket_listing_enrichment import (
    _COLUMN_DETAIL_KEYS,
    _EXPENSIVE_FIELD_RULES,
    _OWNER_ENRICHED_FIELDS,
    _OWNER_QUOTA_FIELDS,
    _OWNER_STATUS_FIELDS,
    _OWNER_USAGE_FIELDS,
    _OWNER_USAGE_PERCENT_FIELDS,
    _apply_owner_enrichment,
    _backfill_bucket_owner_metadata,
    _bucket_identity_key,
    _determine_owner_name_lookup_scope,
    enrich_buckets,
    _extract_name_candidates,
    _filter_requires_owner_usage,
    _feature_status_active,
    _feature_status_inactive,
    load_bucket_feature_param_snapshots,
    match_bucket_feature_param_rules,
    match_bucket_feature_rule,
    match_bucket_field_rule,
    _request_requires_bucket_stats,
    _request_requires_owner_metadata,
    _request_requires_tenant_metadata,
    _resolve_owner_names_for_buckets,
)
from app.services import rgw_bucket_metadata
from app.routers.ceph_admin.listing_common import (
    serialize_filter,
    stream_listing_response,
)
from app.utils.http_errors import raise_bad_gateway_from_runtime
from app.services.bucket_listing_shared import (
    BucketListingFilterError,
    is_advanced_filter_stream_payload,
    parse_filter,
    parse_includes,
)
from app.services.listing_progress import (
    ListingProgressEmitter,
    ListingProgressSnapshot,
    invoke_cancel_check,
)
from app.services.bucket_owner_enrichment import (
    BucketOwnerUsage,
    compute_bucket_owner_usage,
)
from app.services.buckets_service import BucketsService
from app.services.rgw_admin import RGWAdminError

router = APIRouter(prefix="/ceph-admin/endpoints/{endpoint_id}/buckets", tags=["ceph-admin-buckets"])
router.include_router(bucket_config.router)
router.include_router(bucket_tools.router)
logger = logging.getLogger(__name__)

_BUCKET_STATS_UNAVAILABLE_WARNING = (
    "Bucket stats are unavailable via Ceph Admin credentials on this endpoint. "
    "Showing owner metadata without usage or quota values."
)


@router.get("", response_model=PaginatedCephAdminBucketsResponse)
def list_buckets(
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=200),
    filter: str | None = Query(None),
    advanced_filter: str | None = Query(None),
    sort_by: str = Query("name"),
    sort_dir: str = Query("asc"),
    include: list[str] = Query(default=[]),
    with_stats: bool = True,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> PaginatedCephAdminBucketsResponse:
    return _compute_bucket_listing(
        page=page,
        page_size=page_size,
        filter=filter,
        advanced_filter=advanced_filter,
        sort_by=sort_by,
        sort_dir=sort_dir,
        include=include,
        with_stats=with_stats,
        ctx=ctx,
    )


@router.post("/query", response_model=PaginatedCephAdminBucketsResponse)
def query_buckets(
    payload: CephAdminBucketListingRequest,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> PaginatedCephAdminBucketsResponse:
    return _compute_bucket_listing(
        page=payload.page,
        page_size=payload.page_size,
        filter=payload.filter,
        advanced_filter=payload.advanced_filter,
        sort_by=payload.sort_by,
        sort_dir=payload.sort_dir,
        include=payload.include,
        with_stats=payload.with_stats,
        ctx=ctx,
    )


def _compute_bucket_listing(
    *,
    page: int,
    page_size: int,
    filter: str | None,
    advanced_filter: str | None,
    sort_by: str,
    sort_dir: str,
    include: list[str],
    with_stats: bool,
    ctx: CephAdminContext,
    progress_callback: Callable[[ListingProgressSnapshot], None] | None = None,
    cancel_check: Callable[[], None] | None = None,
) -> PaginatedCephAdminBucketsResponse:
    progress = ListingProgressEmitter(progress_callback)
    include_progress_hooks = progress_callback is not None or cancel_check is not None
    invoke_cancel_check(cancel_check)
    progress.emit(percent=5, stage="prepare", message="Preparing advanced search", force=True)

    try:
        if advanced_filter:
            simple_filter = filter.strip() if isinstance(filter, str) and filter.strip() else None
            _, advanced_filter = parse_filter(advanced_filter)
        else:
            simple_filter, advanced_filter = parse_filter(filter)
    except BucketListingFilterError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=sanitize_error_detail(str(exc))) from exc
    simple_filter = simple_filter.strip() if isinstance(simple_filter, str) and simple_filter.strip() else None
    stats_required_for_request = _request_requires_bucket_stats(advanced_filter, sort_by)
    if stats_required_for_request:
        with_stats = True

    include_set = parse_includes(include)
    wants_owner_name = "owner_name" in include_set
    wants_owner_suspended = "owner_suspended" in include_set
    wants_owner_quota = "owner_quota" in include_set
    wants_owner_quota_usage = "owner_quota_usage" in include_set
    owner_usage_required_for_request = wants_owner_quota_usage or _filter_requires_owner_usage(advanced_filter)
    needs_owner_metadata = _request_requires_owner_metadata(
        advanced_filter,
        sort_by,
        simple_filter if not advanced_filter else None,
    )
    needs_tenant_metadata = _request_requires_tenant_metadata(
        advanced_filter,
        sort_by,
        simple_filter if not advanced_filter else None,
    )
    requested_features = include_set & {
        "tags",
        "versioning",
        "object_lock",
        "block_public_access",
        "lifecycle_rules",
        "static_website",
        "bucket_policy",
        "cors",
        "access_logging",
        "notifications",
        "server_side_encryption",
    }
    requested_detail_fields = include_set & _COLUMN_DETAIL_KEYS

    cache_key = CephAdminBucketListCacheKey(
        endpoint_id=int(getattr(ctx.endpoint, "id", 0) or 0),
        advanced_filter=serialize_filter(advanced_filter),
        sort_by=sort_by,
        sort_dir=sort_dir,
        with_stats=with_stats,
        with_owner_metadata=needs_owner_metadata,
        with_owner_usage=owner_usage_required_for_request,
    )
    invoke_cancel_check(cancel_check)

    def build_listing() -> CephAdminBucketListingSnapshot:
        invoke_cancel_check(cancel_check)
        name_candidates = None if owner_usage_required_for_request else _extract_name_candidates(advanced_filter)
        effective_with_stats = with_stats
        stats_available = True
        stats_warning: str | None = None
        owner_usage_by_key: dict[str, BucketOwnerUsage] | None = None

        def load_entries(request_with_stats: bool) -> list[dict]:
            progress.emit(percent=10, stage="fetch_rgw", message="Loading buckets from RGW", force=True)
            if name_candidates is not None:
                if not name_candidates:
                    return []
                allowed_names = set(name_candidates)
                return [
                    entry
                    for entry in get_cached_rgw_bucket_entries(ctx, with_stats=request_with_stats)
                    if rgw_bucket_metadata.extract_bucket_name(entry) in allowed_names
                ]
            return get_cached_rgw_bucket_entries(ctx, with_stats=request_with_stats)

        try:
            entries = load_entries(with_stats)
        except RGWAdminError as exc:
            if not with_stats:
                raise_bad_gateway_from_runtime(exc)
            if stats_required_for_request:
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail="Bucket stats are unavailable via Ceph Admin credentials for this request",
                ) from exc
            logger.warning(
                "Ceph admin bucket listing stats fallback on endpoint=%s error=%s",
                getattr(getattr(ctx, "endpoint", None), "id", "unknown"),
                exc,
            )
            effective_with_stats = False
            stats_available = False
            stats_warning = _BUCKET_STATS_UNAVAILABLE_WARNING
            try:
                progress.emit(
                    percent=12,
                    stage="fetch_rgw_fallback",
                    message="Bucket stats unavailable, retrying without stats",
                    force=True,
                )
                entries = load_entries(False)
            except RGWAdminError as fallback_exc:
                raise_bad_gateway_from_runtime(fallback_exc)

        progress.emit(
            percent=15,
            stage="fetch_rgw",
            processed=len(entries),
            total=len(entries),
            message="RGW bucket payload loaded",
            force=True,
        )

        results: list[CephAdminBucketSummary] = []
        total_entries = len(entries)
        for idx, entry in enumerate(entries, start=1):
            invoke_cancel_check(cancel_check)
            summary = rgw_bucket_metadata.build_bucket_summary(entry)
            if summary:
                if not effective_with_stats:
                    summary.used_bytes = None
                    summary.object_count = None
                    summary.quota_max_size_bytes = None
                    summary.quota_max_objects = None
                results.append(summary)
            percent = 15 + int((idx / total_entries) * 45) if total_entries > 0 else 60
            progress.emit(
                percent=percent,
                stage="scan_entries",
                processed=idx,
                total=total_entries,
                message="Scanning RGW bucket entries",
            )
        progress.emit(
            percent=60,
            stage="scan_entries",
            processed=total_entries,
            total=total_entries,
            message="Bucket scanning completed",
            force=True,
        )
        invoke_cancel_check(cancel_check)

        if needs_owner_metadata and results:
            progress.emit(
                percent=63,
                stage="owner_backfill",
                processed=0,
                total=len(results),
                message="Loading bucket owner metadata",
                force=True,
            )
            results = _backfill_bucket_owner_metadata(
                ctx,
                results,
                include_tenant=needs_tenant_metadata,
                **(
                    {
                        "progress": progress,
                        "progress_stage": "owner_backfill",
                        "progress_message": "Loading bucket owner metadata",
                        "progress_start": 63,
                        "progress_end": 65,
                        "cancel_check": cancel_check,
                    }
                    if include_progress_hooks
                    else {}
                ),
            )

        if effective_with_stats and results:
            owner_usage_by_key = compute_bucket_owner_usage(results)

        if advanced_filter and advanced_filter.rules:
            progress.emit(percent=65, stage="expensive_filters", message="Applying advanced filters", force=True)
            field_rules = [rule for rule in advanced_filter.rules if rule.field]
            feature_state_rules = [rule for rule in advanced_filter.rules if rule.feature and rule.state is not None]
            feature_param_rules = [rule for rule in advanced_filter.rules if rule.feature and rule.param is not None]
            match_mode = advanced_filter.match
            expensive_field_rules = [rule for rule in field_rules if rule.field in _EXPENSIVE_FIELD_RULES]
            cheap_field_rules = [rule for rule in field_rules if rule.field not in _EXPENSIVE_FIELD_RULES]

            if cheap_field_rules and match_mode == "all":
                results = [bucket for bucket in results if all(match_bucket_field_rule(bucket, rule) for rule in cheap_field_rules)]
            elif (
                cheap_field_rules
                and match_mode == "any"
                and not expensive_field_rules
                and not feature_state_rules
                and not feature_param_rules
            ):
                results = [bucket for bucket in results if any(match_bucket_field_rule(bucket, rule) for rule in cheap_field_rules)]

            if expensive_field_rules or feature_state_rules or feature_param_rules:
                filter_features = {rule.feature for rule in feature_state_rules if rule.feature}
                requires_tag_lookup = any(rule.field == "tag" for rule in expensive_field_rules)
                requires_owner_name_lookup = any(rule.field == "owner_name" for rule in expensive_field_rules)
                requires_owner_suspended_lookup = any(rule.field in _OWNER_STATUS_FIELDS for rule in expensive_field_rules)
                requires_owner_quota_lookup = any(
                    rule.field in (_OWNER_QUOTA_FIELDS | _OWNER_USAGE_PERCENT_FIELDS) for rule in expensive_field_rules
                )
                requires_owner_usage_lookup = any(
                    rule.field in (_OWNER_USAGE_FIELDS | _OWNER_USAGE_PERCENT_FIELDS) for rule in expensive_field_rules
                )
                service = BucketsService()
                account = build_ceph_admin_s3_context(ctx)
                expensive_candidates = results

                if feature_param_rules:
                    if requires_owner_name_lookup and expensive_candidates:
                        owner_scope = _determine_owner_name_lookup_scope(advanced_filter)
                        owner_name_by_key = _resolve_owner_names_for_buckets(
                            ctx,
                            expensive_candidates,
                            owner_scope=owner_scope,
                        )
                        for bucket in expensive_candidates:
                            if not bucket.owner:
                                bucket.owner_name = None
                                continue
                            owner_key = f"{bucket.tenant or ''}:{bucket.owner}"
                            bucket.owner_name = owner_name_by_key.get(owner_key)
                    if (
                        requires_owner_suspended_lookup
                        or requires_owner_quota_lookup
                        or requires_owner_usage_lookup
                    ) and expensive_candidates:
                        expensive_candidates = _apply_owner_enrichment(
                            ctx,
                            expensive_candidates,
                            include_suspended=requires_owner_suspended_lookup,
                            include_quota=requires_owner_quota_lookup,
                            include_usage=requires_owner_usage_lookup,
                            usage_by_key=owner_usage_by_key,
                        )

                    if expensive_candidates and (filter_features or requires_tag_lookup):
                        progress.emit(
                            percent=75,
                            stage="bucket_enrichment",
                            processed=0,
                            total=len(expensive_candidates),
                            message="Loading bucket details",
                            force=True,
                        )
                        expensive_candidates = enrich_buckets(
                            expensive_candidates,
                            {feature for feature in filter_features if feature != "tags"},
                            include_tags=requires_tag_lookup or ("tags" in filter_features),
                            service=service,
                            account=account,
                            **(
                                {
                                    "progress": progress,
                                    "progress_stage": "bucket_enrichment",
                                    "progress_message": "Loading bucket details",
                                    "progress_start": 75,
                                    "progress_end": 82,
                                    "cancel_check": cancel_check,
                                }
                                if include_progress_hooks
                                else {}
                            ),
                        )

                    if expensive_candidates and feature_param_rules:
                        progress.emit(
                            percent=82,
                            stage="feature_param_enrichment",
                            processed=0,
                            total=len(expensive_candidates),
                            message="Loading bucket feature parameters",
                            force=True,
                        )
                    feature_param_snapshots, feature_param_available_keys = load_bucket_feature_param_snapshots(
                        expensive_candidates,
                        feature_param_rules,
                        service=service,
                        account=account,
                        **(
                            {
                                "progress": progress,
                                "progress_stage": "feature_param_enrichment",
                                "progress_message": "Loading bucket feature parameters",
                                "progress_start": 82,
                                "progress_end": 88,
                                "cancel_check": cancel_check,
                            }
                            if include_progress_hooks
                            else {}
                        ),
                    )

                    filtered: list[CephAdminBucketSummary] = []
                    for bucket in expensive_candidates:
                        bucket_key = _bucket_identity_key(bucket)
                        if bucket_key not in feature_param_available_keys:
                            continue
                        snapshot = feature_param_snapshots.get(bucket_key, {})
                        if match_mode == "all":
                            matches = (
                                (all(match_bucket_field_rule(bucket, rule) for rule in field_rules) if field_rules else True)
                                and (all(match_bucket_feature_rule(bucket, rule) for rule in feature_state_rules) if feature_state_rules else True)
                                and match_bucket_feature_param_rules(feature_param_rules, match_mode, snapshot)
                            )
                        else:
                            field_match = any(match_bucket_field_rule(bucket, rule) for rule in field_rules) if field_rules else False
                            state_match = (
                                any(match_bucket_feature_rule(bucket, rule) for rule in feature_state_rules)
                                if feature_state_rules
                                else False
                            )
                            param_match = match_bucket_feature_param_rules(feature_param_rules, match_mode, snapshot)
                            matches = field_match or state_match or param_match
                        if matches:
                            filtered.append(bucket)
                    results = filtered
                else:
                    field_matched: list[CephAdminBucketSummary] = []
                    if match_mode == "any" and cheap_field_rules:
                        unresolved: list[CephAdminBucketSummary] = []
                        for bucket in results:
                            if any(match_bucket_field_rule(bucket, rule) for rule in cheap_field_rules):
                                field_matched.append(bucket)
                            else:
                                unresolved.append(bucket)
                        expensive_candidates = unresolved

                    if requires_owner_name_lookup and expensive_candidates:
                        owner_scope = _determine_owner_name_lookup_scope(advanced_filter)
                        owner_name_by_key = _resolve_owner_names_for_buckets(
                            ctx,
                            expensive_candidates,
                            owner_scope=owner_scope,
                        )
                        for bucket in expensive_candidates:
                            if not bucket.owner:
                                bucket.owner_name = None
                                continue
                            owner_key = f"{bucket.tenant or ''}:{bucket.owner}"
                            bucket.owner_name = owner_name_by_key.get(owner_key)
                    if (
                        requires_owner_suspended_lookup
                        or requires_owner_quota_lookup
                        or requires_owner_usage_lookup
                    ) and expensive_candidates:
                        expensive_candidates = _apply_owner_enrichment(
                            ctx,
                            expensive_candidates,
                            include_suspended=requires_owner_suspended_lookup,
                            include_quota=requires_owner_quota_lookup,
                            include_usage=requires_owner_usage_lookup,
                            usage_by_key=owner_usage_by_key,
                        )

                    if expensive_candidates and (filter_features or requires_tag_lookup):
                        progress.emit(
                            percent=75,
                            stage="bucket_enrichment",
                            processed=0,
                            total=len(expensive_candidates),
                            message="Loading bucket details",
                            force=True,
                        )
                        expensive_candidates = enrich_buckets(
                            expensive_candidates,
                            {feature for feature in filter_features if feature != "tags"},
                            include_tags=requires_tag_lookup or ("tags" in filter_features),
                            service=service,
                            account=account,
                            **(
                                {
                                    "progress": progress,
                                    "progress_stage": "bucket_enrichment",
                                    "progress_message": "Loading bucket details",
                                    "progress_start": 75,
                                    "progress_end": 88,
                                    "cancel_check": cancel_check,
                                }
                                if include_progress_hooks
                                else {}
                            ),
                        )

                    if match_mode == "all":
                        results = [
                            bucket
                            for bucket in expensive_candidates
                            if (all(match_bucket_field_rule(bucket, rule) for rule in expensive_field_rules) if expensive_field_rules else True)
                            and (all(match_bucket_feature_rule(bucket, rule) for rule in feature_state_rules) if feature_state_rules else True)
                        ]
                    elif cheap_field_rules:
                        expensive_matched = [
                            bucket
                            for bucket in expensive_candidates
                            if (any(match_bucket_field_rule(bucket, rule) for rule in expensive_field_rules) if expensive_field_rules else False)
                            or (any(match_bucket_feature_rule(bucket, rule) for rule in feature_state_rules) if feature_state_rules else False)
                        ]
                        results = field_matched + expensive_matched
                    else:
                        results = [
                            bucket
                            for bucket in expensive_candidates
                            if (any(match_bucket_field_rule(bucket, rule) for rule in expensive_field_rules) if expensive_field_rules else False)
                            or (any(match_bucket_feature_rule(bucket, rule) for rule in feature_state_rules) if feature_state_rules else False)
                        ]

                for bucket in results:
                    bucket.features = None
                    bucket.tags = None
                    bucket.column_details = None
            progress.emit(percent=90, stage="expensive_filters", message="Advanced filters applied", force=True)
        else:
            progress.emit(percent=90, stage="expensive_filters", message="No expensive filters", force=True)
        invoke_cancel_check(cancel_check)

        def sort_value(bucket: CephAdminBucketSummary):
            if sort_by == "tenant":
                value = bucket.tenant or ""
            elif sort_by == "owner":
                value = bucket.owner or ""
            elif sort_by == "used_bytes":
                value = bucket.used_bytes if bucket.used_bytes is not None else 0
            elif sort_by == "object_count":
                value = bucket.object_count if bucket.object_count is not None else 0
            else:
                value = bucket.name
            if isinstance(value, str):
                return value.lower()
            return value

        sortable: list[tuple[object, CephAdminBucketSummary]] = []
        missing_values: list[CephAdminBucketSummary] = []
        for bucket in results:
            value = sort_value(bucket)
            if value is None:
                missing_values.append(bucket)
            else:
                sortable.append((value, bucket))

        sortable.sort(key=lambda item: item[0], reverse=sort_dir == "desc")
        results = [bucket for _, bucket in sortable] + missing_values
        return CephAdminBucketListingSnapshot(
            items=results,
            stats_available=stats_available,
            stats_warning=stats_warning,
            owner_usage_by_key=owner_usage_by_key,
        )

    invoke_cancel_check(cancel_check)
    listing = get_cached_bucket_listing(cache_key, build_listing)
    results = listing.items
    progress.emit(percent=92, stage="sort_paginate", message="Sorting and paginating results", force=True)

    filtered_results = results
    if simple_filter:
        filter_value = simple_filter.lower()
        if advanced_filter:
            filtered_results = [bucket for bucket in filtered_results if filter_value in bucket.name.lower()]
        else:
            filtered_results = [
                bucket
                for bucket in filtered_results
                if filter_value in bucket.name.lower()
                or filter_value in (bucket.tenant or "").lower()
                or filter_value in (bucket.owner or "").lower()
            ]

    invoke_cancel_check(cancel_check)
    total = len(filtered_results)
    start = max(page - 1, 0) * page_size
    end = start + page_size
    page_items = clone_ceph_admin_bucket_list(filtered_results[start:end])
    if page_items:
        progress.emit(
            percent=94,
            stage="page_enrichment",
            processed=0,
            total=len(page_items),
            message="Loading page bucket metadata",
            force=True,
        )
        page_items = _backfill_bucket_owner_metadata(
            ctx,
            page_items,
            include_tenant=wants_owner_name or wants_owner_suspended or wants_owner_quota or wants_owner_quota_usage,
            **(
                {
                    "progress": progress,
                    "progress_stage": "page_enrichment",
                    "progress_message": "Loading page bucket metadata",
                    "progress_start": 94,
                    "progress_end": 96,
                    "cancel_check": cancel_check,
                }
                if include_progress_hooks
                else {}
            ),
        )

    requested = ({feature for feature in requested_features if feature != "tags"} | requested_detail_fields)
    if requested or ("tags" in requested_features):
        service = BucketsService()
        account = build_ceph_admin_s3_context(ctx)
        progress.emit(
            percent=96,
            stage="page_enrichment",
            processed=0,
            total=len(page_items),
            message="Loading page bucket details",
            force=True,
        )
        page_items = enrich_buckets(
            page_items,
            requested,
            include_tags="tags" in requested_features,
            service=service,
            account=account,
            **(
                {
                    "progress": progress,
                    "progress_stage": "page_enrichment",
                    "progress_message": "Loading page bucket details",
                    "progress_start": 96,
                    "progress_end": 99,
                    "cancel_check": cancel_check,
                }
                if include_progress_hooks
                else {}
            ),
        )

    if wants_owner_name and page_items:
        owner_name_by_key = _resolve_owner_names_for_buckets(ctx, page_items, owner_scope="any")
        for bucket in page_items:
            if not bucket.owner:
                bucket.owner_name = None
                continue
            owner_key = f"{bucket.tenant or ''}:{bucket.owner}"
            bucket.owner_name = owner_name_by_key.get(owner_key, bucket.owner_name)
    if page_items and (wants_owner_suspended or wants_owner_quota or wants_owner_quota_usage):
        page_items = _apply_owner_enrichment(
            ctx,
            page_items,
            include_suspended=wants_owner_suspended,
            include_quota=wants_owner_quota or wants_owner_quota_usage,
            include_usage=wants_owner_quota_usage,
            usage_by_key=listing.owner_usage_by_key,
        )

    invoke_cancel_check(cancel_check)
    has_next = end < total
    response = PaginatedCephAdminBucketsResponse(
        items=page_items,
        total=total,
        page=page,
        page_size=page_size,
        has_next=has_next,
        stats_available=listing.stats_available,
        stats_warning=listing.stats_warning,
    )
    progress.emit(percent=100, stage="finalize", processed=total, total=total, message="Search completed", force=True)
    return response


@router.get("/stream")
async def stream_buckets(
    request: Request,
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=200),
    filter: str | None = Query(None),
    advanced_filter: str | None = Query(None),
    sort_by: str = Query("name"),
    sort_dir: str = Query("asc"),
    include: list[str] = Query(default=[]),
    with_stats: bool = True,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> StreamingResponse:
    if not is_advanced_filter_stream_payload(advanced_filter):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="advanced_filter must be provided as a JSON payload for streaming search",
        )

    return stream_listing_response(
        request,
        compute=lambda progress_callback, cancel_check: _compute_bucket_listing(
            page=page,
            page_size=page_size,
            filter=filter,
            advanced_filter=advanced_filter,
            sort_by=sort_by,
            sort_dir=sort_dir,
            include=include,
            with_stats=with_stats,
            ctx=ctx,
            progress_callback=progress_callback,
            cancel_check=cancel_check,
        ),
        logger=logger,
        failure_message="Bucket streaming search failed",
    )
