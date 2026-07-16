# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import logging
from collections import OrderedDict
from concurrent.futures import Future, ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from threading import Lock
from time import monotonic
from typing import Any, Callable, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.db import S3Account
from app.models.bucket import (
    BucketAcl,
    BucketAclUpdate,
    BucketCorsUpdate,
    BucketEncryptionConfiguration,
    BucketLifecycleConfig,
    BucketLoggingConfiguration,
    BucketNotificationConfiguration,
    BucketObjectLock,
    BucketObjectLockUpdate,
    BucketPolicyIn,
    BucketPolicyOut,
    BucketReplicationConfiguration,
    BucketProperties,
    BucketPublicAccessBlock,
    BucketTag,
    BucketFeatureStatus,
    BucketQuotaUpdate,
    BucketTagsUpdate,
    BucketVersioningUpdate,
    BucketVersioningStatus,
    BucketWebsiteConfiguration,
)
from app.models.bucket_config_backup import (
    BucketConfigBackupRequest,
    BucketConfigBackupResponse,
    BucketConfigBackupSource,
)
from app.models.ceph_admin import (
    CephAdminBucketCompareRequest,
    CephAdminBucketCompareResult,
    CephAdminBucketFilterQuery,
    CephAdminBucketFilterRule,
    CephAdminBucketListingRequest,
    CephAdminBucketSummary,
    PaginatedCephAdminBucketsResponse,
)
from app.models.browser import ListBrowserObjectsResponse
from app.routers.ceph_admin import bucket_listing_cache as _bucket_listing_cache
from app.routers.ceph_admin.audit import record_ceph_admin_action
from app.routers.ceph_admin.dependencies import CephAdminContext, _resolve_storage_endpoint, get_ceph_admin_context
from app.routers.ceph_admin.bucket_listing_cache import (
    _BUCKET_LIST_CACHE,
    _BUCKET_LIST_CACHE_LOCK,
    _BUCKET_LIST_INFLIGHT,
    _RGW_BUCKET_PAYLOAD_CACHE,
    _RGW_BUCKET_PAYLOAD_CACHE_LOCK,
    _RGW_BUCKET_PAYLOAD_ENDPOINT_LOCKS,
    _RGW_BUCKET_PAYLOAD_ENDPOINT_LOCKS_LOCK,
    _BucketListCacheKey,
    _BucketListingSnapshot,
    _clone_bucket_list,
)
from app.routers.ceph_admin.bucket_listing_enrichment import (
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
    _build_bucket_summary,
    _determine_owner_name_lookup_scope,
    _enrich_buckets,
    _extract_bucket_name,
    _extract_name_candidates,
    _filter_requires_owner_usage,
    _feature_status_active,
    _feature_status_inactive,
    _load_feature_param_snapshots,
    _match_feature_param_rules,
    _match_feature_rule,
    _match_field_rule,
    _owner_kind_from_owner,
    _request_requires_bucket_stats,
    _request_requires_owner_metadata,
    _request_requires_tenant_metadata,
    _resolve_bucket_owner_identity,
    _resolve_owner_names_for_buckets,
)
from app.routers.ceph_admin.listing_common import (
    ListingCancelled as _BucketListingCancelled,
    ListingProgressEmitter as _BucketListingProgressEmitter,
    ListingProgressSnapshot as _BucketListingProgressSnapshot,
    interpolate_progress_percent as _common_interpolate_progress_percent,
    invoke_cancel_check as _invoke_cancel_check,
    normalize_optional_str as _common_normalize_optional_str,
    normalize_text as _common_normalize_text,
    serialize_filter as _common_serialize_filter,
    stream_listing_response as _common_stream_listing_response,
)
from app.routers.http_errors import raise_bad_gateway_from_runtime, raise_bad_request_from_value_error
from app.services import bucket_config_actions
from app.services.bucket_notification_state import (
    account_sns_feature_enabled,
    is_bucket_notification_configuration_configured,
)
from app.services.bucket_config_backup_service import (
    BucketConfigBackupService,
    quota_from_bucket_summary,
)
from app.services.bucket_listing_shared import (
    _filter_requires_stats as _shared_filter_requires_stats,
    _is_advanced_filter_stream_payload as _shared_is_advanced_filter_stream_payload,
    _parse_filter as _shared_parse_filter,
    parse_includes,
)
from app.services.bucket_owner_enrichment import (
    BucketOwnerMetadataService,
    BucketOwnerUsage,
    compute_bucket_owner_usage,
    invalidate_bucket_owner_metadata_cache,
)
from app.services.buckets_service import BucketsService
from app.services.browser_service import BrowserService, get_browser_service
from app.services.rgw_admin import RGWAdminError
from app.utils.rgw import extract_bucket_list, is_rgw_account_id
from app.utils.storage_endpoint_features import resolve_feature_flags
from app.utils.usage_stats import compute_usage_ratio_percent, extract_usage_stats

router = APIRouter(prefix="/ceph-admin/endpoints/{endpoint_id}/buckets", tags=["ceph-admin-buckets"])
logger = logging.getLogger(__name__)

_BUCKET_STATS_UNAVAILABLE_WARNING = (
    "Bucket stats are unavailable via Ceph Admin credentials on this endpoint. "
    "Showing owner metadata without usage or quota values."
)


def _build_endpoint_account(ctx: CephAdminContext) -> S3Account:
    account = S3Account(
        name=f"ceph-admin:{ctx.endpoint.id}",
        rgw_account_id=None,
        email=None,
        rgw_user_uid=None,
    )
    account.storage_endpoint = ctx.endpoint  # type: ignore[assignment]
    account.set_session_credentials(ctx.access_key, ctx.secret_key)
    return account


def _build_endpoint_account_from_credentials(endpoint_id: int, endpoint, access_key: str, secret_key: str) -> S3Account:
    account = S3Account(
        name=f"ceph-admin:{endpoint_id}",
        rgw_account_id=None,
        email=None,
        rgw_user_uid=None,
    )
    account.storage_endpoint = endpoint  # type: ignore[assignment]
    account.set_session_credentials(access_key, secret_key)
    return account


def _serialize_filter(query: CephAdminBucketFilterQuery | None) -> str | None:
    return _common_serialize_filter(query)


def _sync_bucket_listing_cache_clock() -> None:
    _bucket_listing_cache.monotonic = monotonic


def _get_cached_rgw_bucket_entries(ctx: CephAdminContext, with_stats: bool) -> list[dict]:
    _sync_bucket_listing_cache_clock()
    return _bucket_listing_cache._get_cached_rgw_bucket_entries(ctx, with_stats)


def _get_cached_bucket_listing(
    key: _BucketListCacheKey,
    builder: Callable[[], _BucketListingSnapshot],
) -> _BucketListingSnapshot:
    _sync_bucket_listing_cache_clock()
    return _bucket_listing_cache._get_cached_bucket_listing(key, builder)


def _invalidate_bucket_listing_cache(endpoint_id: int) -> None:
    return _bucket_listing_cache._invalidate_bucket_listing_cache(endpoint_id)


def _require_sse_feature(ctx: CephAdminContext) -> None:
    if not resolve_feature_flags(ctx.endpoint).sse_enabled:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Server-side encryption is disabled for this endpoint",
        )


def _require_replication_feature(ctx: CephAdminContext) -> None:
    if not resolve_feature_flags(ctx.endpoint).replication_enabled:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Bucket replication is disabled for this endpoint",
        )


def _record_bucket_config_mutation(
    ctx: CephAdminContext,
    bucket_name: str,
    *,
    config_area: str,
    operation: Literal["update", "delete"],
    metadata: dict[str, Any] | None = None,
) -> None:
    _invalidate_bucket_listing_cache(ctx.endpoint.id)
    record_ceph_admin_action(
        ctx,
        action=f"bucket_config.{config_area}.{operation}",
        entity_type="bucket",
        entity_id=bucket_name,
        metadata=bucket_config_actions.bucket_config_audit_metadata(
            config_area=config_area,
            operation=operation,
            metadata=metadata,
        ),
    )


def _ceph_admin_bucket_config_account(ctx: CephAdminContext) -> tuple[BucketsService, S3Account]:
    return BucketsService(), _build_endpoint_account(ctx)


def _run_bucket_config_update(
    ctx: CephAdminContext,
    bucket_name: str,
    *,
    config_area: str,
    action: Callable[..., tuple[Any, dict[str, Any]]],
    **kwargs: Any,
) -> Any:
    service, account = _ceph_admin_bucket_config_account(ctx)
    return bucket_config_actions.apply_bucket_config_update(
        service=service,
        account=account,
        bucket_name=bucket_name,
        action=action,
        audit_recorder=lambda metadata: _record_bucket_config_mutation(
            ctx,
            bucket_name,
            config_area=config_area,
            operation="update",
            metadata=metadata,
        ),
        **kwargs,
    )


def _run_bucket_config_delete(
    ctx: CephAdminContext,
    bucket_name: str,
    *,
    config_area: str,
    action: Callable[..., None],
) -> Response:
    service, account = _ceph_admin_bucket_config_account(ctx)
    return bucket_config_actions.apply_bucket_config_delete(
        service=service,
        account=account,
        bucket_name=bucket_name,
        action=action,
        audit_recorder=lambda metadata: _record_bucket_config_mutation(
            ctx,
            bucket_name,
            config_area=config_area,
            operation="delete",
            metadata=metadata,
        ),
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
    progress_callback: Callable[[_BucketListingProgressSnapshot], None] | None = None,
    cancel_check: Callable[[], None] | None = None,
) -> PaginatedCephAdminBucketsResponse:
    progress = _BucketListingProgressEmitter(progress_callback)
    include_progress_hooks = progress_callback is not None or cancel_check is not None
    _invoke_cancel_check(cancel_check)
    progress.emit(percent=5, stage="prepare", message="Preparing advanced search", force=True)

    if advanced_filter:
        simple_filter = filter.strip() if isinstance(filter, str) and filter.strip() else None
        _, advanced_filter = _shared_parse_filter(advanced_filter)
    else:
        simple_filter, advanced_filter = _shared_parse_filter(filter)
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

    cache_key = _BucketListCacheKey(
        endpoint_id=int(getattr(ctx.endpoint, "id", 0) or 0),
        advanced_filter=_serialize_filter(advanced_filter),
        sort_by=sort_by,
        sort_dir=sort_dir,
        with_stats=with_stats,
        with_owner_metadata=needs_owner_metadata,
        with_owner_usage=owner_usage_required_for_request,
    )
    _invoke_cancel_check(cancel_check)

    def build_listing() -> _BucketListingSnapshot:
        _invoke_cancel_check(cancel_check)
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
                    for entry in _get_cached_rgw_bucket_entries(ctx, with_stats=request_with_stats)
                    if _extract_bucket_name(entry) in allowed_names
                ]
            return _get_cached_rgw_bucket_entries(ctx, with_stats=request_with_stats)

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
            _invoke_cancel_check(cancel_check)
            summary = _build_bucket_summary(entry)
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
        _invoke_cancel_check(cancel_check)

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
                results = [bucket for bucket in results if all(_match_field_rule(bucket, rule) for rule in cheap_field_rules)]
            elif (
                cheap_field_rules
                and match_mode == "any"
                and not expensive_field_rules
                and not feature_state_rules
                and not feature_param_rules
            ):
                results = [bucket for bucket in results if any(_match_field_rule(bucket, rule) for rule in cheap_field_rules)]

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
                account = _build_endpoint_account(ctx)
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
                        expensive_candidates = _enrich_buckets(
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
                    feature_param_snapshots, feature_param_available_keys = _load_feature_param_snapshots(
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
                                (all(_match_field_rule(bucket, rule) for rule in field_rules) if field_rules else True)
                                and (all(_match_feature_rule(bucket, rule) for rule in feature_state_rules) if feature_state_rules else True)
                                and _match_feature_param_rules(feature_param_rules, match_mode, snapshot)
                            )
                        else:
                            field_match = any(_match_field_rule(bucket, rule) for rule in field_rules) if field_rules else False
                            state_match = (
                                any(_match_feature_rule(bucket, rule) for rule in feature_state_rules)
                                if feature_state_rules
                                else False
                            )
                            param_match = _match_feature_param_rules(feature_param_rules, match_mode, snapshot)
                            matches = field_match or state_match or param_match
                        if matches:
                            filtered.append(bucket)
                    results = filtered
                else:
                    field_matched: list[CephAdminBucketSummary] = []
                    if match_mode == "any" and cheap_field_rules:
                        unresolved: list[CephAdminBucketSummary] = []
                        for bucket in results:
                            if any(_match_field_rule(bucket, rule) for rule in cheap_field_rules):
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
                        expensive_candidates = _enrich_buckets(
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
                            if (all(_match_field_rule(bucket, rule) for rule in expensive_field_rules) if expensive_field_rules else True)
                            and (all(_match_feature_rule(bucket, rule) for rule in feature_state_rules) if feature_state_rules else True)
                        ]
                    elif cheap_field_rules:
                        expensive_matched = [
                            bucket
                            for bucket in expensive_candidates
                            if (any(_match_field_rule(bucket, rule) for rule in expensive_field_rules) if expensive_field_rules else False)
                            or (any(_match_feature_rule(bucket, rule) for rule in feature_state_rules) if feature_state_rules else False)
                        ]
                        results = field_matched + expensive_matched
                    else:
                        results = [
                            bucket
                            for bucket in expensive_candidates
                            if (any(_match_field_rule(bucket, rule) for rule in expensive_field_rules) if expensive_field_rules else False)
                            or (any(_match_feature_rule(bucket, rule) for rule in feature_state_rules) if feature_state_rules else False)
                        ]

                for bucket in results:
                    bucket.features = None
                    bucket.tags = None
                    bucket.column_details = None
            progress.emit(percent=90, stage="expensive_filters", message="Advanced filters applied", force=True)
        else:
            progress.emit(percent=90, stage="expensive_filters", message="No expensive filters", force=True)
        _invoke_cancel_check(cancel_check)

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
        return _BucketListingSnapshot(
            items=results,
            stats_available=stats_available,
            stats_warning=stats_warning,
            owner_usage_by_key=owner_usage_by_key,
        )

    _invoke_cancel_check(cancel_check)
    listing = _get_cached_bucket_listing(cache_key, build_listing)
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

    _invoke_cancel_check(cancel_check)
    total = len(filtered_results)
    start = max(page - 1, 0) * page_size
    end = start + page_size
    page_items = _clone_bucket_list(filtered_results[start:end])
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
        account = _build_endpoint_account(ctx)
        progress.emit(
            percent=96,
            stage="page_enrichment",
            processed=0,
            total=len(page_items),
            message="Loading page bucket details",
            force=True,
        )
        page_items = _enrich_buckets(
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

    _invoke_cancel_check(cancel_check)
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
    if not _shared_is_advanced_filter_stream_payload(advanced_filter):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="advanced_filter must be provided as a JSON payload for streaming search",
        )

    return _common_stream_listing_response(
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


@router.post("/cache/refresh")
def refresh_bucket_listing_cache(
    endpoint_id: int,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> dict[str, object]:
    resolved_endpoint_id = int(getattr(ctx.endpoint, "id", endpoint_id) or endpoint_id)
    _invalidate_bucket_listing_cache(resolved_endpoint_id)
    invalidate_bucket_owner_metadata_cache(resolved_endpoint_id)
    return {"refreshed": True, "endpoint_id": resolved_endpoint_id}


@router.post("/config-backup", response_model=BucketConfigBackupResponse)
def backup_bucket_configs(
    payload: BucketConfigBackupRequest,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> BucketConfigBackupResponse:
    service = BucketConfigBackupService(BucketsService())
    account = _build_endpoint_account(ctx)

    def quota_loader(bucket_name: str) -> dict[str, int | None]:
        try:
            raw = ctx.rgw_admin.get_bucket_info(bucket_name, stats=True, allow_not_found=True)
        except RGWAdminError as exc:
            raise RuntimeError(f"Unable to fetch bucket quota: {exc}") from exc
        if not isinstance(raw, dict):
            raise RuntimeError("Unable to fetch bucket quota: bucket not found")
        summary = _build_bucket_summary(raw)
        return quota_from_bucket_summary(summary)

    return service.build_backup(
        account=account,
        bucket_names=payload.buckets,
        features=payload.features,
        source=BucketConfigBackupSource(
            surface="ceph-admin",
            endpoint_id=ctx.endpoint.id,
            endpoint_name=ctx.endpoint.name,
        ),
        quota_loader=quota_loader,
    )


@router.post("/compare", response_model=CephAdminBucketCompareResult)
def compare_bucket_pair(
    endpoint_id: int,
    payload: CephAdminBucketCompareRequest,
    db: Session = Depends(get_db),
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> CephAdminBucketCompareResult:
    source_account = _build_endpoint_account(ctx)
    target_endpoint = _resolve_storage_endpoint(db, payload.target_endpoint_id)
    target_access_key = getattr(target_endpoint, "ceph_admin_access_key", None)
    target_secret_key = getattr(target_endpoint, "ceph_admin_secret_key", None)
    if not target_access_key or not target_secret_key:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Target endpoint Ceph Admin credentials are not configured",
        )
    target_account = _build_endpoint_account_from_credentials(
        payload.target_endpoint_id,
        target_endpoint,
        target_access_key,
        target_secret_key,
    )

    service = BucketsService()
    content_diff = None
    config_diff = None
    try:
        if payload.include_content:
            content_diff = service.compare_bucket_content(
                payload.source_bucket,
                source_account,
                payload.target_bucket,
                target_account,
                ignore_modified_after=payload.ignore_modified_after,
            )
        if payload.include_config:
            config_diff = service.compare_bucket_configuration(
                payload.source_bucket,
                source_account,
                payload.target_bucket,
                target_account,
                include_sections=set(payload.config_features) if payload.config_features is not None else None,
            )
    except RuntimeError as exc:
        raise_bad_gateway_from_runtime(exc)

    has_differences = bool(
        (
            content_diff is not None
            and (
                content_diff.different_count > 0
                or content_diff.only_source_count > 0
                or content_diff.only_target_count > 0
            )
        )
        or (config_diff.changed if config_diff else False)
    )
    return CephAdminBucketCompareResult(
        source_endpoint_id=endpoint_id,
        target_endpoint_id=payload.target_endpoint_id,
        source_bucket=payload.source_bucket,
        target_bucket=payload.target_bucket,
        has_differences=has_differences,
        content_diff=content_diff,
        config_diff=config_diff,
    )


@router.get("/{bucket_name}/objects", response_model=ListBrowserObjectsResponse)
def list_bucket_objects(
    bucket_name: str,
    prefix: str = "",
    continuation_token: str | None = None,
    max_keys: int = Query(default=1000, ge=1, le=1000),
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
    service: BrowserService = Depends(get_browser_service),
) -> ListBrowserObjectsResponse:
    try:
        return service.list_objects(
            bucket_name,
            _build_endpoint_account(ctx),
            prefix=prefix,
            continuation_token=continuation_token,
            max_keys=max_keys,
        )
    except RuntimeError as exc:
        raise_bad_gateway_from_runtime(exc)


@router.get("/{bucket_name}/properties", response_model=BucketProperties)
def bucket_properties(
    bucket_name: str,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> BucketProperties:
    service = BucketsService()
    account = _build_endpoint_account(ctx)
    return bucket_config_actions.get_bucket_properties_config(
        service=service,
        account=account,
        bucket_name=bucket_name,
    )


@router.get("/{bucket_name}/versioning", response_model=BucketVersioningStatus)
def get_versioning(
    bucket_name: str,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> BucketVersioningStatus:
    service = BucketsService()
    account = _build_endpoint_account(ctx)
    return bucket_config_actions.get_bucket_versioning_config(
        service=service,
        account=account,
        bucket_name=bucket_name,
    )


@router.put("/{bucket_name}/versioning", status_code=status.HTTP_200_OK)
def update_versioning(
    bucket_name: str,
    payload: BucketVersioningUpdate,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
):
    return _run_bucket_config_update(
        ctx,
        bucket_name,
        config_area="versioning",
        action=bucket_config_actions.update_bucket_versioning_config,
        payload=payload,
    )


@router.put("/{bucket_name}/quota", status_code=status.HTTP_200_OK)
def update_quota(
    bucket_name: str,
    payload: BucketQuotaUpdate,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
):
    service = BucketsService()
    account = _build_endpoint_account(ctx)
    try:
        bucket_info = ctx.rgw_admin.get_bucket_info(bucket_name, stats=False, allow_not_found=True)
    except RGWAdminError as exc:
        raise_bad_gateway_from_runtime(exc)
    if not bucket_info or (isinstance(bucket_info, dict) and bucket_info.get("not_found")):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Bucket not found")

    owner_account_id, owner_uid = _resolve_bucket_owner_identity(bucket_info)
    if not owner_account_id and not owner_uid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unable to resolve bucket owner for quota update",
        )
    account.rgw_account_id = owner_account_id
    account.rgw_user_uid = owner_uid

    try:
        service.set_bucket_quota(bucket_name, account, payload, rgw_admin=ctx.rgw_admin)
        _invalidate_bucket_listing_cache(ctx.endpoint.id)
        record_ceph_admin_action(
            ctx,
            action="bucket_quota.update",
            entity_type="bucket",
            entity_id=bucket_name,
            metadata=bucket_config_actions.bucket_config_audit_metadata(
                config_area="quota",
                operation="update",
                metadata={
                    "owner_account_id": owner_account_id,
                    "owner_uid": owner_uid,
                    "quota": payload.model_dump(exclude_none=True),
                },
            ),
        )
        return {"message": "Bucket quota updated"}
    except ValueError as exc:
        raise_bad_request_from_value_error(exc)
    except RuntimeError as exc:
        raise_bad_gateway_from_runtime(exc)


@router.get("/{bucket_name}/lifecycle", response_model=BucketLifecycleConfig)
def get_lifecycle(
    bucket_name: str,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> BucketLifecycleConfig:
    service = BucketsService()
    account = _build_endpoint_account(ctx)
    return bucket_config_actions.get_bucket_lifecycle_config(
        service=service,
        account=account,
        bucket_name=bucket_name,
    )


@router.put("/{bucket_name}/lifecycle", response_model=BucketLifecycleConfig)
def put_lifecycle(
    bucket_name: str,
    payload: BucketLifecycleConfig,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> BucketLifecycleConfig:
    return _run_bucket_config_update(
        ctx,
        bucket_name,
        config_area="lifecycle",
        action=bucket_config_actions.put_bucket_lifecycle_config,
        payload=payload,
    )


@router.delete("/{bucket_name}/lifecycle", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def delete_lifecycle(
    bucket_name: str,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> Response:
    return _run_bucket_config_delete(
        ctx,
        bucket_name,
        config_area="lifecycle",
        action=bucket_config_actions.delete_bucket_lifecycle_config,
    )


@router.get("/{bucket_name}/cors")
def get_cors(
    bucket_name: str,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
):
    service = BucketsService()
    account = _build_endpoint_account(ctx)
    return bucket_config_actions.get_bucket_cors_config(
        service=service,
        account=account,
        bucket_name=bucket_name,
    )


@router.put("/{bucket_name}/cors")
def put_cors(
    bucket_name: str,
    payload: BucketCorsUpdate,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
):
    return _run_bucket_config_update(
        ctx,
        bucket_name,
        config_area="cors",
        action=bucket_config_actions.put_bucket_cors_config,
        payload=payload,
    )


@router.delete("/{bucket_name}/cors", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def delete_cors(
    bucket_name: str,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> Response:
    return _run_bucket_config_delete(
        ctx,
        bucket_name,
        config_area="cors",
        action=bucket_config_actions.delete_bucket_cors_config,
    )


@router.get("/{bucket_name}/policy", response_model=BucketPolicyOut)
def get_policy(
    bucket_name: str,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> BucketPolicyOut:
    service = BucketsService()
    account = _build_endpoint_account(ctx)
    return bucket_config_actions.get_bucket_policy_config(
        service=service,
        account=account,
        bucket_name=bucket_name,
    )


@router.put("/{bucket_name}/policy", response_model=BucketPolicyOut)
def put_policy(
    bucket_name: str,
    payload: BucketPolicyIn,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> BucketPolicyOut:
    return _run_bucket_config_update(
        ctx,
        bucket_name,
        config_area="policy",
        action=bucket_config_actions.put_bucket_policy_config,
        payload=payload,
    )


@router.delete("/{bucket_name}/policy", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def delete_policy(
    bucket_name: str,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> Response:
    return _run_bucket_config_delete(
        ctx,
        bucket_name,
        config_area="policy",
        action=bucket_config_actions.delete_bucket_policy_config,
    )


@router.get("/{bucket_name}/notifications", response_model=BucketNotificationConfiguration)
def get_notifications(
    bucket_name: str,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> BucketNotificationConfiguration:
    service = BucketsService()
    account = _build_endpoint_account(ctx)
    return bucket_config_actions.get_bucket_notifications_config(
        service=service,
        account=account,
        bucket_name=bucket_name,
    )


@router.put("/{bucket_name}/notifications", response_model=BucketNotificationConfiguration)
def put_notifications(
    bucket_name: str,
    payload: BucketNotificationConfiguration,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> BucketNotificationConfiguration:
    return _run_bucket_config_update(
        ctx,
        bucket_name,
        config_area="notifications",
        action=bucket_config_actions.put_bucket_notifications_config,
        payload=payload,
    )


@router.delete("/{bucket_name}/notifications", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def delete_notifications(
    bucket_name: str,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> Response:
    return _run_bucket_config_delete(
        ctx,
        bucket_name,
        config_area="notifications",
        action=bucket_config_actions.delete_bucket_notifications_config,
    )


@router.get("/{bucket_name}/replication", response_model=BucketReplicationConfiguration)
def get_replication(
    bucket_name: str,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> BucketReplicationConfiguration:
    _require_replication_feature(ctx)
    service = BucketsService()
    account = _build_endpoint_account(ctx)
    return bucket_config_actions.get_bucket_replication_config(
        service=service,
        account=account,
        bucket_name=bucket_name,
    )


@router.put("/{bucket_name}/replication", response_model=BucketReplicationConfiguration)
def put_replication(
    bucket_name: str,
    payload: BucketReplicationConfiguration,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> BucketReplicationConfiguration:
    _require_replication_feature(ctx)
    return _run_bucket_config_update(
        ctx,
        bucket_name,
        config_area="replication",
        action=bucket_config_actions.put_bucket_replication_config,
        payload=payload,
    )


@router.delete("/{bucket_name}/replication", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def delete_replication(
    bucket_name: str,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> Response:
    _require_replication_feature(ctx)
    return _run_bucket_config_delete(
        ctx,
        bucket_name,
        config_area="replication",
        action=bucket_config_actions.delete_bucket_replication_config,
    )


@router.get("/{bucket_name}/logging", response_model=BucketLoggingConfiguration)
def get_logging(
    bucket_name: str,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> BucketLoggingConfiguration:
    service = BucketsService()
    account = _build_endpoint_account(ctx)
    return bucket_config_actions.get_bucket_logging_config(
        service=service,
        account=account,
        bucket_name=bucket_name,
    )


@router.put("/{bucket_name}/logging", response_model=BucketLoggingConfiguration)
def put_logging(
    bucket_name: str,
    payload: BucketLoggingConfiguration,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> BucketLoggingConfiguration:
    return _run_bucket_config_update(
        ctx,
        bucket_name,
        config_area="logging",
        action=bucket_config_actions.put_bucket_logging_config,
        payload=payload,
    )


@router.delete("/{bucket_name}/logging", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def delete_logging(
    bucket_name: str,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> Response:
    return _run_bucket_config_delete(
        ctx,
        bucket_name,
        config_area="logging",
        action=bucket_config_actions.delete_bucket_logging_config,
    )


@router.get("/{bucket_name}/website", response_model=BucketWebsiteConfiguration)
def get_website(
    bucket_name: str,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> BucketWebsiteConfiguration:
    service = BucketsService()
    account = _build_endpoint_account(ctx)
    return bucket_config_actions.get_bucket_website_config(
        service=service,
        account=account,
        bucket_name=bucket_name,
    )


@router.put("/{bucket_name}/website", response_model=BucketWebsiteConfiguration)
def put_website(
    bucket_name: str,
    payload: BucketWebsiteConfiguration,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> BucketWebsiteConfiguration:
    return _run_bucket_config_update(
        ctx,
        bucket_name,
        config_area="website",
        action=bucket_config_actions.put_bucket_website_config,
        payload=payload,
    )


@router.delete("/{bucket_name}/website", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def delete_website(
    bucket_name: str,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> Response:
    return _run_bucket_config_delete(
        ctx,
        bucket_name,
        config_area="website",
        action=bucket_config_actions.delete_bucket_website_config,
    )


@router.get("/{bucket_name}/tags")
def get_tags(
    bucket_name: str,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
):
    service = BucketsService()
    account = _build_endpoint_account(ctx)
    return bucket_config_actions.get_bucket_tags_config(
        service=service,
        account=account,
        bucket_name=bucket_name,
    )


@router.put("/{bucket_name}/tags")
def put_tags(
    bucket_name: str,
    payload: BucketTagsUpdate,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
):
    return _run_bucket_config_update(
        ctx,
        bucket_name,
        config_area="tags",
        action=bucket_config_actions.put_bucket_tags_config,
        payload=payload,
    )


@router.delete("/{bucket_name}/tags", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def delete_tags(
    bucket_name: str,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> Response:
    return _run_bucket_config_delete(
        ctx,
        bucket_name,
        config_area="tags",
        action=bucket_config_actions.delete_bucket_tags_config,
    )


@router.get("/{bucket_name}/acl", response_model=BucketAcl)
def get_acl(
    bucket_name: str,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> BucketAcl:
    service = BucketsService()
    account = _build_endpoint_account(ctx)
    return bucket_config_actions.get_bucket_acl_config(
        service=service,
        account=account,
        bucket_name=bucket_name,
    )


@router.put("/{bucket_name}/acl", response_model=BucketAcl)
def put_acl(
    bucket_name: str,
    payload: BucketAclUpdate,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> BucketAcl:
    return _run_bucket_config_update(
        ctx,
        bucket_name,
        config_area="acl",
        action=bucket_config_actions.put_bucket_acl_config,
        payload=payload,
    )


@router.get("/{bucket_name}/public-access-block", response_model=BucketPublicAccessBlock)
def get_public_access_block(
    bucket_name: str,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> BucketPublicAccessBlock:
    service = BucketsService()
    account = _build_endpoint_account(ctx)
    return bucket_config_actions.get_bucket_public_access_block_config(
        service=service,
        account=account,
        bucket_name=bucket_name,
    )


@router.put("/{bucket_name}/public-access-block", response_model=BucketPublicAccessBlock)
def put_public_access_block(
    bucket_name: str,
    payload: BucketPublicAccessBlock,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> BucketPublicAccessBlock:
    return _run_bucket_config_update(
        ctx,
        bucket_name,
        config_area="public_access_block",
        action=bucket_config_actions.put_bucket_public_access_block_config,
        payload=payload,
    )


@router.get("/{bucket_name}/object-lock", response_model=BucketObjectLock)
def get_object_lock(
    bucket_name: str,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> BucketObjectLock:
    service = BucketsService()
    account = _build_endpoint_account(ctx)
    return bucket_config_actions.get_bucket_object_lock_config(
        service=service,
        account=account,
        bucket_name=bucket_name,
    )


@router.put("/{bucket_name}/object-lock", response_model=BucketObjectLock)
def put_object_lock(
    bucket_name: str,
    payload: BucketObjectLockUpdate,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> BucketObjectLock:
    return _run_bucket_config_update(
        ctx,
        bucket_name,
        config_area="object_lock",
        action=bucket_config_actions.put_bucket_object_lock_config,
        payload=payload,
    )


@router.get("/{bucket_name}/encryption", response_model=BucketEncryptionConfiguration)
def get_bucket_encryption(
    bucket_name: str,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> BucketEncryptionConfiguration:
    _require_sse_feature(ctx)
    service = BucketsService()
    account = _build_endpoint_account(ctx)
    return bucket_config_actions.get_bucket_encryption_config(
        service=service,
        account=account,
        bucket_name=bucket_name,
    )


@router.put("/{bucket_name}/encryption", response_model=BucketEncryptionConfiguration)
def put_bucket_encryption(
    bucket_name: str,
    payload: BucketEncryptionConfiguration,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> BucketEncryptionConfiguration:
    _require_sse_feature(ctx)
    return _run_bucket_config_update(
        ctx,
        bucket_name,
        config_area="encryption",
        action=bucket_config_actions.put_bucket_encryption_config,
        payload=payload,
    )


@router.delete("/{bucket_name}/encryption", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def delete_bucket_encryption(
    bucket_name: str,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> Response:
    _require_sse_feature(ctx)
    return _run_bucket_config_delete(
        ctx,
        bucket_name,
        config_area="encryption",
        action=bucket_config_actions.delete_bucket_encryption_config,
    )
