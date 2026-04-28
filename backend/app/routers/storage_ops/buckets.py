# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
import logging
import uuid
from dataclasses import dataclass
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app.core.database import get_db
from app.db import S3Account, User
from app.models.ceph_admin import CephAdminBucketFilterQuery, CephAdminBucketListingRequest
from app.models.storage_ops import PaginatedStorageOpsBucketsResponse, StorageOpsBucketSummary, StorageOpsContextKind
from app.services.bucket_listing_shared import (
    _enrich_buckets,
    _format_sse_event,
    _is_advanced_filter_stream_payload,
    _load_feature_param_snapshots,
    _match_feature_param_rules,
    _match_feature_rule,
    _match_field_rule,
    _parse_filter,
    _filter_requires_stats,
    parse_includes,
)
from app.services.bucket_owner_enrichment import BucketOwnerMetadataService
from app.routers.ceph_admin.listing_common import normalize_text, sort_value
from app.routers.dependencies import get_account_context, get_current_storage_ops_admin
from app.routers.execution_contexts import list_execution_contexts
from app.services.bucket_listing_cache import get_cached_bucket_listing_for_account
from app.services.buckets_service import BucketsService, get_buckets_service
from app.services.connection_identity_service import ConnectionIdentityService

router = APIRouter(prefix="/storage-ops/buckets", tags=["storage-ops-buckets"])
logger = logging.getLogger(__name__)

BUCKET_REF_SEPARATOR = "::"
STORAGE_OPS_CONTEXT_LISTING_MAX_WORKERS = 6
CONTEXT_IDENTITY_FIELDS = {"context_name", "context_kind", "endpoint_name"}
OWNER_QUOTA_FIELDS = {"owner_quota_max_size_bytes", "owner_quota_max_objects"}
OWNER_USAGE_FIELDS = {"owner_used_bytes", "owner_object_count"}
OWNER_USAGE_PERCENT_FIELDS = {"owner_quota_usage_size_percent", "owner_quota_usage_object_percent"}
OWNER_ENRICHED_FIELDS = {"owner_name"} | OWNER_QUOTA_FIELDS | OWNER_USAGE_FIELDS | OWNER_USAGE_PERCENT_FIELDS


@dataclass(frozen=True)
class _StorageOpsContextRef:
    context_id: str
    context_name: str
    context_kind: StorageOpsContextKind
    endpoint_name: str | None


@dataclass(frozen=True)
class _StorageOpsResolvedContext:
    ref: _StorageOpsContextRef
    account: S3Account


@dataclass(frozen=True)
class _StorageOpsContextOwner:
    owner: str | None
    tenant: str | None = None


def _encode_bucket_ref(context_id: str, bucket_name: str) -> str:
    return f"{context_id}{BUCKET_REF_SEPARATOR}{bucket_name}"


def _match_simple_search(bucket: StorageOpsBucketSummary, normalized_search: str) -> bool:
    candidates = [
        bucket.bucket_name or bucket.name,
        bucket.owner,
        bucket.owner_name,
        bucket.tenant,
        bucket.context_id,
        bucket.context_name,
        bucket.context_kind,
        bucket.endpoint_name,
    ]
    for candidate in candidates:
        if candidate and normalized_search in normalize_text(str(candidate)):
            return True
    tags = bucket.tags or []
    for tag in tags:
        if normalized_search in normalize_text(tag.key) or normalized_search in normalize_text(tag.value):
            return True
    return False


def _collect_context_refs(user: User, db: Session) -> list[_StorageOpsContextRef]:
    contexts = list_execution_contexts(workspace="manager", user=user, db=db)
    refs: list[_StorageOpsContextRef] = []
    seen: set[str] = set()
    for context in contexts:
        if context.kind not in {"account", "connection", "legacy_user"}:
            continue
        if context.id in seen:
            continue
        seen.add(context.id)
        context_kind: StorageOpsContextKind
        if context.kind == "legacy_user":
            context_kind = "s3_user"
        else:
            context_kind = context.kind
        refs.append(
            _StorageOpsContextRef(
                context_id=context.id,
                context_name=context.display_name,
                context_kind=context_kind,
                endpoint_name=context.endpoint_name,
            )
        )
    return refs


def _split_rules(
    parsed_filter: CephAdminBucketFilterQuery | None,
) -> tuple[list, list, list, str]:
    if not parsed_filter or not parsed_filter.rules:
        return [], [], [], "all"
    field_rules = [rule for rule in parsed_filter.rules if rule.field]
    feature_state_rules = [rule for rule in parsed_filter.rules if rule.feature and rule.state is not None]
    feature_param_rules = [rule for rule in parsed_filter.rules if rule.feature and rule.param is not None]
    return field_rules, feature_state_rules, feature_param_rules, parsed_filter.match


def _context_probe_bucket(ref: _StorageOpsContextRef) -> StorageOpsBucketSummary:
    return StorageOpsBucketSummary(
        name="",
        bucket_name="",
        tenant=None,
        owner=None,
        owner_name=None,
        context_id=ref.context_id,
        context_name=ref.context_name,
        context_kind=ref.context_kind,
        endpoint_name=ref.endpoint_name,
    )


def _filter_context_refs_by_advanced_filter(
    refs: list[_StorageOpsContextRef],
    parsed_filter: CephAdminBucketFilterQuery | None,
) -> list[_StorageOpsContextRef]:
    if not refs or not parsed_filter or not parsed_filter.rules:
        return refs

    context_rules = [rule for rule in parsed_filter.rules if rule.field in CONTEXT_IDENTITY_FIELDS]
    if not context_rules:
        return refs

    has_non_context_rules = any(
        (rule.field and rule.field not in CONTEXT_IDENTITY_FIELDS) or rule.feature
        for rule in parsed_filter.rules
    )

    if parsed_filter.match == "all":
        filtered: list[_StorageOpsContextRef] = []
        for ref in refs:
            probe = _context_probe_bucket(ref)
            if all(_match_storage_ops_field_rule(probe, rule) for rule in context_rules):
                filtered.append(ref)
        return filtered

    # For "any", context-only rules can reduce context fan-out safely.
    if not has_non_context_rules:
        filtered = []
        for ref in refs:
            probe = _context_probe_bucket(ref)
            if any(_match_storage_ops_field_rule(probe, rule) for rule in context_rules):
                filtered.append(ref)
        return filtered
    return refs


def _build_cheap_field_prefilter(
    parsed_filter: CephAdminBucketFilterQuery | None,
) -> tuple[CephAdminBucketFilterQuery | None, bool]:
    if not parsed_filter or not parsed_filter.rules:
        return None, False

    rules = parsed_filter.rules
    cheap_field_rules = [rule for rule in rules if rule.field and rule.field not in ({"tag"} | OWNER_ENRICHED_FIELDS)]
    has_feature_rules = any(rule.feature for rule in rules)
    has_tag_rule = any(rule.field == "tag" for rule in rules)
    has_owner_enriched_rule = any(rule.field in OWNER_ENRICHED_FIELDS for rule in rules)
    if not cheap_field_rules:
        return None, False

    if parsed_filter.match == "all":
        cheap_filter = parsed_filter.model_copy(update={"rules": cheap_field_rules})
        is_complete = not has_feature_rules and not has_tag_rule and not has_owner_enriched_rule and len(cheap_field_rules) == len(rules)
        return cheap_filter, is_complete

    # For "any", cheap prefilter is only complete/safe when there are no expensive rules.
    if has_feature_rules or has_tag_rule or has_owner_enriched_rule:
        return None, False
    cheap_filter = parsed_filter.model_copy(update={"rules": cheap_field_rules})
    return cheap_filter, True


def _match_storage_ops_field_rule(bucket: StorageOpsBucketSummary, rule) -> bool:
    if rule.field != "name":
        return _match_field_rule(bucket, rule)
    op = rule.op or ""
    if op in {"is_null", "not_null"}:
        return _match_field_rule(bucket, rule)
    encoded_name = _encode_bucket_ref(bucket.context_id, bucket.bucket_name or bucket.name)
    encoded_bucket = bucket.model_copy(update={"name": encoded_name})
    actual_match = _match_field_rule(bucket, rule)
    encoded_match = _match_field_rule(encoded_bucket, rule)
    if op in {"neq", "not_in"}:
        return actual_match and encoded_match
    return actual_match or encoded_match


def _apply_advanced_filter_for_context(
    buckets: list[StorageOpsBucketSummary],
    parsed_filter: CephAdminBucketFilterQuery | None,
    *,
    service: BucketsService,
    account,
) -> list[StorageOpsBucketSummary]:
    if not parsed_filter or not parsed_filter.rules or not buckets:
        return buckets
    field_rules, feature_state_rules, feature_param_rules, match_mode = _split_rules(parsed_filter)
    if not feature_param_rules:
        def base_match(bucket: StorageOpsBucketSummary) -> bool:
            results: list[bool] = []
            results.extend(_match_storage_ops_field_rule(bucket, rule) for rule in field_rules)
            results.extend(_match_feature_rule(bucket, rule) for rule in feature_state_rules)
            if not results:
                return True
            return all(results) if match_mode == "all" else any(results)

        return [bucket for bucket in buckets if base_match(bucket)]

    def _base_match(bucket: StorageOpsBucketSummary, mode: str) -> bool:
        if not field_rules and not feature_state_rules:
            return mode == "all"
        base_results = [
            *(_match_storage_ops_field_rule(bucket, rule) for rule in field_rules),
            *(_match_feature_rule(bucket, rule) for rule in feature_state_rules),
        ]
        return all(base_results) if mode == "all" else any(base_results)

    if match_mode == "all":
        base_candidates = [bucket for bucket in buckets if _base_match(bucket, "all")]
        if not base_candidates:
            return []
        snapshots_by_key, _available_keys = _load_feature_param_snapshots(
            base_candidates,
            feature_param_rules,
            service,
            account,
        )
        filtered: list[StorageOpsBucketSummary] = []
        for bucket in base_candidates:
            key = f"{bucket.tenant or ''}:{bucket.name}"
            snapshot = snapshots_by_key.get(key, {})
            if _match_feature_param_rules(feature_param_rules, "all", snapshot):
                filtered.append(bucket)
        return filtered

    pre_matched: list[StorageOpsBucketSummary] = []
    param_candidates: list[StorageOpsBucketSummary] = []
    for bucket in buckets:
        if _base_match(bucket, "any"):
            pre_matched.append(bucket)
        else:
            param_candidates.append(bucket)
    if not param_candidates:
        return pre_matched

    snapshots_by_key, _available_keys = _load_feature_param_snapshots(
        param_candidates,
        feature_param_rules,
        service,
        account,
    )
    filtered = list(pre_matched)
    for bucket in param_candidates:
        key = f"{bucket.tenant or ''}:{bucket.name}"
        snapshot = snapshots_by_key.get(key, {})
        if _match_feature_param_rules(feature_param_rules, "any", snapshot):
            filtered.append(bucket)
    return filtered


def _sort_buckets(
    buckets: list[StorageOpsBucketSummary],
    *,
    sort_by: str,
    sort_dir: str,
) -> list[StorageOpsBucketSummary]:
    if not buckets:
        return []
    field = sort_by if sort_by in {"name", "tenant", "owner", "used_bytes", "object_count"} else "name"
    reverse = sort_dir == "desc"

    def _value(bucket: StorageOpsBucketSummary):
        if field == "name":
            return bucket.bucket_name or bucket.name
        return getattr(bucket, field, None)

    return sorted(
        buckets,
        key=lambda bucket: sort_value(_value(bucket), bucket.bucket_name or bucket.name),
        reverse=reverse,
    )


def _resolve_context_accounts(
    *,
    refs: list[_StorageOpsContextRef],
    request: Request,
    db: Session,
    user: User,
) -> list[_StorageOpsResolvedContext]:
    resolved: list[_StorageOpsResolvedContext] = []
    for ref in refs:
        try:
            account = get_account_context(request=request, account_ref=ref.context_id, actor=user, db=db)
        except HTTPException as exc:
            if exc.status_code not in {status.HTTP_403_FORBIDDEN, status.HTTP_404_NOT_FOUND}:
                raise
            continue
        resolved.append(_StorageOpsResolvedContext(ref=ref, account=account))
    return resolved


def _collect_filter_fields(parsed_filter: CephAdminBucketFilterQuery | None) -> set[str]:
    if not parsed_filter or not parsed_filter.rules:
        return set()
    return {rule.field for rule in parsed_filter.rules if rule.field}


def _resolve_context_owner(account: S3Account) -> _StorageOpsContextOwner:
    account_id = str(getattr(account, "rgw_account_id", "") or "").strip()
    if account_id:
        return _StorageOpsContextOwner(owner=account_id)
    user_uid = str(getattr(account, "rgw_user_uid", "") or "").strip()
    if user_uid:
        return _StorageOpsContextOwner(owner=user_uid, tenant=account_id or None)
    source_connection = getattr(account, "_source_connection", None)
    if source_connection is None:
        return _StorageOpsContextOwner(owner=None)
    resolution = ConnectionIdentityService().resolve_rgw_identity(source_connection)
    if resolution.rgw_user_uid:
        return _StorageOpsContextOwner(owner=resolution.rgw_user_uid, tenant=resolution.rgw_account_id)
    return _StorageOpsContextOwner(owner=resolution.rgw_account_id)


def _apply_page_owner_enrichment(
    *,
    page_items: list[StorageOpsBucketSummary],
    resolved_contexts_by_id: dict[str, _StorageOpsResolvedContext],
    include_name: bool,
    include_quota: bool,
) -> list[StorageOpsBucketSummary]:
    if not page_items or (not include_name and not include_quota):
        return page_items

    buckets_by_context: dict[str, list[StorageOpsBucketSummary]] = {}
    for bucket in page_items:
        buckets_by_context.setdefault(bucket.context_id, []).append(bucket)

    for context_id, buckets in buckets_by_context.items():
        resolved = resolved_contexts_by_id.get(context_id)
        if resolved is None:
            continue
        metadata = BucketOwnerMetadataService(
            endpoint_id=int(getattr(getattr(resolved.account, "storage_endpoint", None), "id", 0) or 0),
            account=resolved.account,
        )
        metadata.enrich_buckets(
            buckets,
            include_name=include_name,
            include_quota=include_quota,
        )
    return page_items


def _list_context_buckets(
    *,
    context: _StorageOpsResolvedContext,
    service: BucketsService,
    needs_stats: bool,
    requested_features: set[str],
    include_tags: bool,
    parsed_filter: CephAdminBucketFilterQuery | None,
    normalized_search: str,
    filter_requires_owner_name: bool,
    filter_requires_owner_quota: bool,
    owner_usage_required: bool,
) -> list[StorageOpsBucketSummary]:
    ref = context.ref
    account = context.account
    try:
        listed = get_cached_bucket_listing_for_account(
            account=account,
            include=set(),
            with_stats=needs_stats,
            builder=lambda: service.list_buckets(account, include=None, with_stats=needs_stats),
        )
    except RuntimeError as exc:
        logger.warning("Storage Ops listing failed for context %s: %s", ref.context_id, exc)
        return []

    context_buckets: list[StorageOpsBucketSummary] = []
    owner_identity = _resolve_context_owner(account)
    for bucket in listed:
        context_buckets.append(
            StorageOpsBucketSummary(
                name=bucket.name,
                bucket_name=bucket.name,
                tenant=owner_identity.tenant,
                owner=owner_identity.owner,
                owner_name=None,
                used_bytes=bucket.used_bytes,
                object_count=bucket.object_count,
                quota_max_size_bytes=bucket.quota_max_size_bytes,
                quota_max_objects=bucket.quota_max_objects,
                context_id=ref.context_id,
                context_name=ref.context_name,
                context_kind=ref.context_kind,
                endpoint_name=ref.endpoint_name,
            )
        )

    if context_buckets and (filter_requires_owner_name or filter_requires_owner_quota or owner_usage_required):
        metadata = BucketOwnerMetadataService(
            endpoint_id=int(getattr(getattr(account, "storage_endpoint", None), "id", 0) or 0),
            account=account,
        )
        metadata.enrich_buckets(
            context_buckets,
            include_name=filter_requires_owner_name,
            include_quota=filter_requires_owner_quota,
            include_usage=owner_usage_required,
        )

    cheap_prefilter, cheap_prefilter_complete = _build_cheap_field_prefilter(parsed_filter)
    effective_filter = parsed_filter
    if cheap_prefilter and context_buckets:
        context_buckets = _apply_advanced_filter_for_context(
            context_buckets,
            cheap_prefilter,
            service=service,
            account=account,
        )
        if not context_buckets:
            return []
        if cheap_prefilter_complete:
            effective_filter = None

    if (requested_features or include_tags) and context_buckets:
        context_buckets = [
            StorageOpsBucketSummary(
                **enriched.model_dump(mode="json"),
                context_id=ref.context_id,
                context_name=ref.context_name,
                context_kind=ref.context_kind,
                endpoint_name=ref.endpoint_name,
                bucket_name=enriched.name,
            )
            for enriched in _enrich_buckets(
                context_buckets,
                requested_features,
                include_tags,
                service,
                account,
            )
        ]

    context_buckets = _apply_advanced_filter_for_context(
        context_buckets,
        effective_filter,
        service=service,
        account=account,
    )
    if normalized_search:
        context_buckets = [
            bucket for bucket in context_buckets if _match_simple_search(bucket, normalized_search)
        ]

    for bucket in context_buckets:
        bucket.name = _encode_bucket_ref(ref.context_id, bucket.bucket_name or bucket.name)
    return context_buckets


def _compute_storage_ops_listing(
    *,
    request: Request,
    db: Session,
    user: User,
    service: BucketsService,
    page: int,
    page_size: int,
    filter: str | None,
    advanced_filter: str | None,
    sort_by: str,
    sort_dir: str,
    include: list[str],
    with_stats: bool,
) -> PaginatedStorageOpsBucketsResponse:
    simple_filter: str | None = None
    parsed_filter: CephAdminBucketFilterQuery | None = None
    if advanced_filter:
        simple_filter, parsed_filter = _parse_filter(advanced_filter)
    elif filter:
        simple_filter, parsed_filter = _parse_filter(filter)
    include_set = parse_includes(include)
    filter_fields = _collect_filter_fields(parsed_filter)
    wants_owner_name = "owner_name" in include_set
    wants_owner_quota = "owner_quota" in include_set
    wants_owner_quota_usage = "owner_quota_usage" in include_set
    filter_requires_owner_name = "owner_name" in filter_fields
    filter_requires_owner_quota = bool(filter_fields & (OWNER_QUOTA_FIELDS | OWNER_USAGE_PERCENT_FIELDS))

    required_feature_include = {
        rule.feature
        for rule in (parsed_filter.rules if parsed_filter and parsed_filter.rules else [])
        if rule.feature and rule.state is not None
    }
    include_tags = "tags" in include_set or any(
        rule.field == "tag" for rule in (parsed_filter.rules if parsed_filter and parsed_filter.rules else [])
    )
    requested_features = {
        item
        for item in (include_set | required_feature_include)
        if item
        and item
        in {
            "versioning",
            "object_lock",
            "block_public_access",
            "lifecycle_rules",
            "static_website",
            "bucket_policy",
            "cors",
            "access_logging",
            "server_side_encryption",
            "lifecycle_expiration_days",
            "lifecycle_noncurrent_expiration_days",
            "lifecycle_transition_days",
            "lifecycle_abort_multipart_days",
        }
    }
    needs_stats = bool(with_stats or _filter_requires_stats(parsed_filter) or sort_by in {"used_bytes", "object_count"})
    owner_usage_required = bool(needs_stats and (bool(filter_fields & (OWNER_USAGE_FIELDS | OWNER_USAGE_PERCENT_FIELDS)) or wants_owner_quota_usage))
    refs = _collect_context_refs(user, db)
    refs = _filter_context_refs_by_advanced_filter(refs, parsed_filter)
    resolved_contexts = _resolve_context_accounts(refs=refs, request=request, db=db, user=user)
    resolved_contexts_by_id = {context.ref.context_id: context for context in resolved_contexts}

    results: list[StorageOpsBucketSummary] = []
    normalized_search = normalize_text(simple_filter or "")
    max_workers = min(STORAGE_OPS_CONTEXT_LISTING_MAX_WORKERS, len(resolved_contexts))
    if max_workers <= 1:
        for context in resolved_contexts:
            results.extend(
                _list_context_buckets(
                    context=context,
                    service=service,
                    needs_stats=needs_stats,
                    requested_features=requested_features,
                    include_tags=include_tags,
                    parsed_filter=parsed_filter,
                    normalized_search=normalized_search,
                    filter_requires_owner_name=filter_requires_owner_name,
                    filter_requires_owner_quota=filter_requires_owner_quota,
                    owner_usage_required=owner_usage_required,
                )
            )
    else:
        with ThreadPoolExecutor(max_workers=max_workers, thread_name_prefix="storage-ops-list") as executor:
            futures = [
                executor.submit(
                    _list_context_buckets,
                    context=context,
                    service=service,
                    needs_stats=needs_stats,
                    requested_features=requested_features,
                    include_tags=include_tags,
                    parsed_filter=parsed_filter,
                    normalized_search=normalized_search,
                    filter_requires_owner_name=filter_requires_owner_name,
                    filter_requires_owner_quota=filter_requires_owner_quota,
                    owner_usage_required=owner_usage_required,
                )
                for context in resolved_contexts
            ]
            for future in as_completed(futures):
                try:
                    results.extend(future.result())
                except Exception as exc:
                    logger.warning("Storage Ops context worker failed: %s", exc)

    sorted_items = _sort_buckets(results, sort_by=sort_by, sort_dir=sort_dir)
    total = len(sorted_items)
    start = max(page - 1, 0) * page_size
    end = start + page_size
    page_items = sorted_items[start:end]
    if page_items and (wants_owner_name or wants_owner_quota or wants_owner_quota_usage):
        page_items = _apply_page_owner_enrichment(
            page_items=page_items,
            resolved_contexts_by_id=resolved_contexts_by_id,
            include_name=wants_owner_name,
            include_quota=wants_owner_quota or wants_owner_quota_usage,
        )
    return PaginatedStorageOpsBucketsResponse(
        items=page_items,
        total=total,
        page=page,
        page_size=page_size,
        has_next=end < total,
    )


@router.get("", response_model=PaginatedStorageOpsBucketsResponse)
def list_storage_ops_buckets(
    request: Request,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=200),
    filter: str | None = Query(default=None),
    advanced_filter: str | None = Query(default=None),
    sort_by: str = Query(default="name"),
    sort_dir: Literal["asc", "desc"] = Query(default="asc"),
    include: list[str] = Query(default=[]),
    with_stats: bool = Query(default=True),
    user: User = Depends(get_current_storage_ops_admin),
    db: Session = Depends(get_db),
    service: BucketsService = Depends(get_buckets_service),
) -> PaginatedStorageOpsBucketsResponse:
    return _compute_storage_ops_listing(
        request=request,
        db=db,
        user=user,
        service=service,
        page=page,
        page_size=page_size,
        filter=filter,
        advanced_filter=advanced_filter,
        sort_by=sort_by,
        sort_dir=sort_dir,
        include=include,
        with_stats=with_stats,
    )


@router.post("/query", response_model=PaginatedStorageOpsBucketsResponse)
def query_storage_ops_buckets(
    payload: CephAdminBucketListingRequest,
    request: Request,
    user: User = Depends(get_current_storage_ops_admin),
    db: Session = Depends(get_db),
    service: BucketsService = Depends(get_buckets_service),
) -> PaginatedStorageOpsBucketsResponse:
    return _compute_storage_ops_listing(
        request=request,
        db=db,
        user=user,
        service=service,
        page=payload.page,
        page_size=payload.page_size,
        filter=payload.filter,
        advanced_filter=payload.advanced_filter,
        sort_by=payload.sort_by,
        sort_dir=payload.sort_dir,
        include=payload.include,
        with_stats=payload.with_stats,
    )


@router.get("/stream")
async def stream_storage_ops_buckets(
    request: Request,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=200),
    filter: str | None = Query(default=None),
    advanced_filter: str | None = Query(default=None),
    sort_by: str = Query(default="name"),
    sort_dir: Literal["asc", "desc"] = Query(default="asc"),
    include: list[str] = Query(default=[]),
    with_stats: bool = Query(default=True),
    user: User = Depends(get_current_storage_ops_admin),
    db: Session = Depends(get_db),
    service: BucketsService = Depends(get_buckets_service),
) -> StreamingResponse:
    if not _is_advanced_filter_stream_payload(advanced_filter):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="advanced_filter must be provided as a JSON payload for streaming search",
        )

    async def event_stream():
        request_id = uuid.uuid4().hex
        try:
            yield _format_sse_event(
                "progress",
                {
                    "request_id": request_id,
                    "percent": 5,
                    "stage": "prepare",
                    "processed": 0,
                    "total": 0,
                    "message": "Preparing Storage Ops search...",
                },
            )
            result = await run_in_threadpool(
                _compute_storage_ops_listing,
                request=request,
                db=db,
                user=user,
                service=service,
                page=page,
                page_size=page_size,
                filter=filter,
                advanced_filter=advanced_filter,
                sort_by=sort_by,
                sort_dir=sort_dir,
                include=include,
                with_stats=with_stats,
            )
            yield _format_sse_event(
                "progress",
                {
                    "request_id": request_id,
                    "percent": 100,
                    "stage": "completed",
                    "processed": result.total,
                    "total": result.total,
                    "message": "Search completed.",
                },
            )
            yield _format_sse_event("result", result.model_dump(mode="json"))
        except HTTPException as exc:
            yield _format_sse_event(
                "error",
                {"request_id": request_id, "detail": exc.detail, "status_code": exc.status_code},
            )
        except Exception as exc:
            logger.exception("Storage Ops bucket streaming failed: %s", exc)
            yield _format_sse_event(
                "error",
                {"request_id": request_id, "detail": "Storage Ops bucket streaming failed."},
            )

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
