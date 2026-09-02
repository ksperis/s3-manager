# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
import json
import logging
from typing import Callable, Iterable

from app.models.ceph_admin import CephAdminBucketFilterQuery
from app.models.execution_context import ExecutionContext
from app.models.storage_ops import PaginatedStorageOpsBucketsResponse, StorageOpsBucketSummary, StorageOpsContextKind
from app.services.bucket_listing_cache import get_cached_bucket_listing_for_account
from app.services.bucket_listing_enrichment import (
    BUCKET_LISTING_INCLUDES,
    enrich_buckets,
)
from app.services.bucket_listing_owner_metadata import (
    OWNER_DETAIL_FIELDS,
    OWNER_QUOTA_FIELDS,
    OWNER_STATUS_FIELDS,
    OWNER_USAGE_FIELDS,
    OWNER_USAGE_PERCENT_FIELDS,
)
from app.services.bucket_listing_rule_matching import (
    match_bucket_feature_rule,
    match_bucket_field_rule,
)
from app.services.bucket_feature_param_matching import match_bucket_feature_param_rules
from app.services.bucket_feature_param_snapshot_loader import load_bucket_feature_param_snapshots
from app.services.bucket_listing_shared import (
    filter_requires_stats,
    listing_sort_key,
    parse_filter,
    parse_includes,
)
from app.services.bucket_owner_enrichment import BucketOwnerMetadataService
from app.services.buckets_service import BucketsService
from app.services.bucket_configuration_service import BucketConfigurationService
from app.services.bucket_ui_tags_service import BucketUiTagsService, PhysicalBucketTarget
from app.services.connection_identity_service import ConnectionIdentityService
from app.services.listing_progress import (
    ListingProgressEmitter,
    ListingProgressSnapshot,
    interpolate_progress_percent,
    invoke_cancel_check,
)
from app.services.s3_execution_context import S3ExecutionContext
from app.utils.normalize import normalize_text
from app.utils.tagging import TAG_DOMAIN_BUCKET_UI_STORAGE_OPS

logger = logging.getLogger(__name__)


BUCKET_REF_SEPARATOR = "::"
STORAGE_OPS_CONTEXT_LISTING_MAX_WORKERS = 6
CONTEXT_IDENTITY_FIELDS = {"context_id", "context_name", "context_kind", "endpoint_name"}


@dataclass(frozen=True)
class StorageOpsContextRef:
    context_id: str
    context_name: str
    context_kind: StorageOpsContextKind
    endpoint_id: int | None
    endpoint_name: str | None


@dataclass(frozen=True)
class StorageOpsResolvedContext:
    ref: StorageOpsContextRef
    account: S3ExecutionContext


@dataclass(frozen=True)
class _StorageOpsContextOwner:
    owner: str | None
    tenant: str | None = None


@dataclass(frozen=True)
class _StorageOpsListingQuery:
    parsed_filter: CephAdminBucketFilterQuery | None
    normalized_search: str
    requested_features: set[str]
    include_tags: bool
    needs_stats: bool
    filter_requires_owner_name: bool
    filter_requires_owner_suspended: bool
    filter_requires_owner_quota: bool
    owner_usage_required: bool
    wants_owner_name: bool
    wants_owner_suspended: bool
    wants_owner_quota: bool
    wants_owner_quota_usage: bool


def _encode_bucket_ref(context_id: str, bucket_name: str) -> str:
    return f"{context_id}{BUCKET_REF_SEPARATOR}{bucket_name}"


def build_storage_ops_bucket_identity(endpoint_id: int | None, tenant: str | None, bucket_name: str) -> str | None:
    if endpoint_id is None or endpoint_id <= 0:
        return None
    name = str(bucket_name or "").strip()
    if not name:
        return None
    return json.dumps([endpoint_id, str(tenant or "").strip(), name], ensure_ascii=False, separators=(",", ":"))


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


def build_storage_ops_context_refs(contexts: Iterable[ExecutionContext]) -> list[StorageOpsContextRef]:
    refs: list[StorageOpsContextRef] = []
    seen: set[str] = set()
    for context in contexts:
        if context.kind not in {"account", "connection", "s3_user"}:
            continue
        if context.id in seen:
            continue
        seen.add(context.id)
        context_kind: StorageOpsContextKind
        if context.kind == "s3_user":
            context_kind = "s3_user"
        else:
            context_kind = context.kind
        refs.append(
            StorageOpsContextRef(
                context_id=context.id,
                context_name=context.display_name,
                context_kind=context_kind,
                endpoint_id=getattr(context, "endpoint_id", None),
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


def _context_probe_bucket(ref: StorageOpsContextRef) -> StorageOpsBucketSummary:
    return StorageOpsBucketSummary(
        name="",
        bucket_name="",
        tenant=None,
        owner=None,
        owner_name=None,
        context_id=ref.context_id,
        context_name=ref.context_name,
        context_kind=ref.context_kind,
        endpoint_id=ref.endpoint_id,
        endpoint_name=ref.endpoint_name,
        bucket_identity=None,
    )


def _filter_context_refs_by_advanced_filter(
    refs: list[StorageOpsContextRef],
    parsed_filter: CephAdminBucketFilterQuery | None,
) -> list[StorageOpsContextRef]:
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
        filtered: list[StorageOpsContextRef] = []
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
    cheap_field_rules = [rule for rule in rules if rule.field and rule.field not in ({"tag"} | OWNER_DETAIL_FIELDS)]
    has_feature_rules = any(rule.feature for rule in rules)
    has_tag_rule = any(rule.field == "tag" for rule in rules)
    has_owner_enriched_rule = any(rule.field in OWNER_DETAIL_FIELDS for rule in rules)
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
        return match_bucket_field_rule(bucket, rule)
    op = rule.op or ""
    if op in {"is_null", "not_null"}:
        return match_bucket_field_rule(bucket, rule)
    encoded_name = _encode_bucket_ref(bucket.context_id, bucket.bucket_name or bucket.name)
    encoded_bucket = bucket.model_copy(update={"name": encoded_name})
    actual_match = match_bucket_field_rule(bucket, rule)
    encoded_match = match_bucket_field_rule(encoded_bucket, rule)
    if op in {"neq", "not_in"}:
        return actual_match and encoded_match
    return actual_match or encoded_match


def apply_storage_ops_advanced_filter(
    buckets: list[StorageOpsBucketSummary],
    parsed_filter: CephAdminBucketFilterQuery | None,
    *,
    service: BucketConfigurationService,
    account,
) -> list[StorageOpsBucketSummary]:
    if not parsed_filter or not parsed_filter.rules or not buckets:
        return buckets
    field_rules, feature_state_rules, feature_param_rules, match_mode = _split_rules(parsed_filter)
    if not feature_param_rules:
        def base_match(bucket: StorageOpsBucketSummary) -> bool:
            results: list[bool] = []
            results.extend(_match_storage_ops_field_rule(bucket, rule) for rule in field_rules)
            results.extend(match_bucket_feature_rule(bucket, rule) for rule in feature_state_rules)
            if not results:
                return True
            return all(results) if match_mode == "all" else any(results)

        return [bucket for bucket in buckets if base_match(bucket)]

    def _base_match(bucket: StorageOpsBucketSummary, mode: str) -> bool:
        if not field_rules and not feature_state_rules:
            return mode == "all"
        base_results = [
            *(_match_storage_ops_field_rule(bucket, rule) for rule in field_rules),
            *(match_bucket_feature_rule(bucket, rule) for rule in feature_state_rules),
        ]
        return all(base_results) if mode == "all" else any(base_results)

    if match_mode == "all":
        base_candidates = [bucket for bucket in buckets if _base_match(bucket, "all")]
        if not base_candidates:
            return []
        snapshots_by_key, _available_keys = load_bucket_feature_param_snapshots(
            base_candidates,
            feature_param_rules,
            service,
            account,
        )
        filtered: list[StorageOpsBucketSummary] = []
        for bucket in base_candidates:
            key = f"{bucket.tenant or ''}:{bucket.name}"
            snapshot = snapshots_by_key.get(key, {})
            if match_bucket_feature_param_rules(feature_param_rules, "all", snapshot):
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

    snapshots_by_key, _available_keys = load_bucket_feature_param_snapshots(
        param_candidates,
        feature_param_rules,
        service,
        account,
    )
    filtered = list(pre_matched)
    for bucket in param_candidates:
        key = f"{bucket.tenant or ''}:{bucket.name}"
        snapshot = snapshots_by_key.get(key, {})
        if match_bucket_feature_param_rules(feature_param_rules, "any", snapshot):
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
        key=lambda bucket: listing_sort_key(_value(bucket), bucket.bucket_name or bucket.name),
        reverse=reverse,
    )


def resolve_storage_ops_contexts(
    *,
    refs: list[StorageOpsContextRef],
    resolve_account: Callable[[StorageOpsContextRef], S3ExecutionContext | None],
    progress: ListingProgressEmitter | None = None,
    cancel_check: Callable[[], None] | None = None,
) -> list[StorageOpsResolvedContext]:
    resolved: list[StorageOpsResolvedContext] = []
    total = len(refs)
    for index, ref in enumerate(refs, start=1):
        invoke_cancel_check(cancel_check)
        account = resolve_account(ref)
        if account is not None:
            resolved.append(StorageOpsResolvedContext(ref=ref, account=account))
        if progress is not None:
            progress.emit(
                percent=interpolate_progress_percent(15, 25, processed=index, total=total),
                stage="resolve_contexts",
                processed=index,
                total=total,
                message="Resolving Storage Ops contexts",
            )
        invoke_cancel_check(cancel_check)
    return resolved


def _collect_filter_fields(parsed_filter: CephAdminBucketFilterQuery | None) -> set[str]:
    if not parsed_filter or not parsed_filter.rules:
        return set()
    return {rule.field for rule in parsed_filter.rules if rule.field}


def _resolve_context_owner(account: S3ExecutionContext) -> _StorageOpsContextOwner:
    account_id = str(getattr(account, "rgw_account_id", "") or "").strip()
    if account_id:
        return _StorageOpsContextOwner(owner=account_id)
    user_uid = str(getattr(account, "rgw_user_uid", "") or "").strip()
    if user_uid:
        return _StorageOpsContextOwner(owner=user_uid, tenant=account_id or None)
    source_connection = getattr(account, "source_connection", None)
    if source_connection is None:
        return _StorageOpsContextOwner(owner=None)
    resolution = ConnectionIdentityService().resolve_rgw_identity(source_connection)
    if resolution.rgw_user_uid:
        return _StorageOpsContextOwner(owner=resolution.rgw_user_uid, tenant=resolution.rgw_account_id)
    return _StorageOpsContextOwner(owner=resolution.rgw_account_id)


def resolve_storage_ops_context_tenant(account: S3ExecutionContext) -> str:
    """Return the normalized tenant used in the physical bucket identity."""
    return str(_resolve_context_owner(account).tenant or "").strip()


def _apply_page_owner_enrichment(
    *,
    page_items: list[StorageOpsBucketSummary],
    resolved_contexts_by_id: dict[str, StorageOpsResolvedContext],
    include_name: bool,
    include_suspended: bool,
    include_quota: bool,
    progress: ListingProgressEmitter | None = None,
    cancel_check: Callable[[], None] | None = None,
) -> list[StorageOpsBucketSummary]:
    if not page_items or (not include_name and not include_suspended and not include_quota):
        return page_items

    buckets_by_context: dict[str, list[StorageOpsBucketSummary]] = {}
    for bucket in page_items:
        buckets_by_context.setdefault(bucket.context_id, []).append(bucket)

    processed = 0
    total = len(page_items)
    for context_id, buckets in buckets_by_context.items():
        invoke_cancel_check(cancel_check)
        resolved = resolved_contexts_by_id.get(context_id)
        if resolved is not None:
            metadata = BucketOwnerMetadataService(
                endpoint_id=int(getattr(getattr(resolved.account, "storage_endpoint", None), "id", 0) or 0),
                account=resolved.account,
            )
            kwargs = {
                "include_name": include_name,
                "include_quota": include_quota,
            }
            if include_suspended:
                kwargs["include_suspended"] = True
            metadata.enrich_buckets(buckets, **kwargs)
        processed += len(buckets)
        if progress is not None:
            progress.emit(
                percent=interpolate_progress_percent(92, 98, processed=processed, total=total),
                stage="page_enrichment",
                processed=processed,
                total=total,
                message="Loading page owner metadata",
            )
        invoke_cancel_check(cancel_check)
    return page_items


def list_storage_ops_context_buckets(
    *,
    context: StorageOpsResolvedContext,
    service: BucketsService,
    needs_stats: bool,
    requested_features: set[str],
    include_tags: bool,
    parsed_filter: CephAdminBucketFilterQuery | None,
    normalized_search: str,
    filter_requires_owner_name: bool,
    filter_requires_owner_suspended: bool,
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
                endpoint_id=ref.endpoint_id,
                endpoint_name=ref.endpoint_name,
                bucket_identity=build_storage_ops_bucket_identity(ref.endpoint_id, owner_identity.tenant, bucket.name),
            )
        )

    if context_buckets and (
        filter_requires_owner_name
        or filter_requires_owner_suspended
        or filter_requires_owner_quota
        or owner_usage_required
    ):
        metadata = BucketOwnerMetadataService(
            endpoint_id=int(getattr(getattr(account, "storage_endpoint", None), "id", 0) or 0),
            account=account,
        )
        kwargs = {
            "include_name": filter_requires_owner_name,
            "include_quota": filter_requires_owner_quota,
            "include_usage": owner_usage_required,
        }
        if filter_requires_owner_suspended:
            kwargs["include_suspended"] = True
        metadata.enrich_buckets(context_buckets, **kwargs)

    cheap_prefilter, cheap_prefilter_complete = _build_cheap_field_prefilter(parsed_filter)
    effective_filter = parsed_filter
    if cheap_prefilter and context_buckets:
        context_buckets = apply_storage_ops_advanced_filter(
            context_buckets,
            cheap_prefilter,
            service=service.configuration,
            account=account,
        )
        if not context_buckets:
            return []
        if cheap_prefilter_complete:
            effective_filter = None

    if (requested_features or include_tags) and context_buckets:
        enriched_buckets: list[StorageOpsBucketSummary] = []
        for enriched in enrich_buckets(
            context_buckets,
            requested_features,
            include_tags,
            service.configuration,
            account,
        ):
            enriched_payload = enriched.model_dump(mode="json")
            enriched_buckets.append(
                StorageOpsBucketSummary(
                    **enriched_payload,
                    context_id=ref.context_id,
                    context_name=ref.context_name,
                    context_kind=ref.context_kind,
                    endpoint_id=ref.endpoint_id,
                    endpoint_name=ref.endpoint_name,
                    bucket_name=enriched.name,
                    bucket_identity=build_storage_ops_bucket_identity(ref.endpoint_id, enriched.tenant, enriched.name),
                )
            )
        context_buckets = enriched_buckets

    context_buckets = apply_storage_ops_advanced_filter(
        context_buckets,
        effective_filter,
        service=service.configuration,
        account=account,
    )
    if normalized_search:
        context_buckets = [
            bucket for bucket in context_buckets if _match_simple_search(bucket, normalized_search)
        ]

    for bucket in context_buckets:
        bucket.name = _encode_bucket_ref(ref.context_id, bucket.bucket_name or bucket.name)
    return context_buckets


def _prepare_storage_ops_listing_query(
    *,
    filter: str | None,
    advanced_filter: str | None,
    include: list[str],
    with_stats: bool,
    sort_by: str,
) -> _StorageOpsListingQuery:
    simple_filter: str | None = None
    parsed_filter: CephAdminBucketFilterQuery | None = None
    if advanced_filter:
        simple_filter, parsed_filter = parse_filter(advanced_filter)
    elif filter:
        simple_filter, parsed_filter = parse_filter(filter)

    include_set = parse_includes(include)
    filter_fields = _collect_filter_fields(parsed_filter)
    wants_owner_quota_usage = "owner_quota_usage" in include_set
    rules = parsed_filter.rules if parsed_filter and parsed_filter.rules else []
    required_feature_include = {
        rule.feature
        for rule in rules
        if rule.feature and rule.state is not None
    }
    include_tags = "tags" in include_set or any(
        rule.field == "tag" for rule in rules
    )
    requested_features = (include_set | required_feature_include) & BUCKET_LISTING_INCLUDES
    needs_stats = bool(
        with_stats
        or filter_requires_stats(parsed_filter)
        or sort_by in {"used_bytes", "object_count"}
    )
    owner_usage_required = bool(
        needs_stats
        and (
            bool(filter_fields & (OWNER_USAGE_FIELDS | OWNER_USAGE_PERCENT_FIELDS))
            or wants_owner_quota_usage
        )
    )
    return _StorageOpsListingQuery(
        parsed_filter=parsed_filter,
        normalized_search=normalize_text(simple_filter or ""),
        requested_features=requested_features,
        include_tags=include_tags,
        needs_stats=needs_stats,
        filter_requires_owner_name="owner_name" in filter_fields,
        filter_requires_owner_suspended="owner_suspended" in filter_fields,
        filter_requires_owner_quota=bool(
            filter_fields & (OWNER_QUOTA_FIELDS | OWNER_USAGE_PERCENT_FIELDS)
        ),
        owner_usage_required=owner_usage_required,
        wants_owner_name="owner_name" in include_set,
        wants_owner_suspended="owner_suspended" in include_set,
        wants_owner_quota="owner_quota" in include_set,
        wants_owner_quota_usage=wants_owner_quota_usage,
    )


class _StorageOpsBucketListingPipeline:
    def __init__(
        self,
        *,
        load_context_refs: Callable[[], list[StorageOpsContextRef]],
        resolve_account: Callable[[StorageOpsContextRef], S3ExecutionContext | None],
        service: BucketsService,
        page: int,
        page_size: int,
        filter: str | None,
        advanced_filter: str | None,
        sort_by: str,
        sort_dir: str,
        include: list[str],
        with_stats: bool,
        ui_tag_ids: list[int] | None,
        ui_tag_match: str,
        bucket_ui_tags_service: BucketUiTagsService | None,
        actor_user_id: int | None,
        progress_callback: Callable[[ListingProgressSnapshot], None] | None,
        cancel_check: Callable[[], None] | None,
    ) -> None:
        self.load_context_refs = load_context_refs
        self.resolve_account = resolve_account
        self.service = service
        self.page = page
        self.page_size = page_size
        self.filter = filter
        self.advanced_filter = advanced_filter
        self.sort_by = sort_by
        self.sort_dir = sort_dir
        self.include = include
        self.with_stats = with_stats
        self.ui_tag_ids = tuple(dict.fromkeys(int(item) for item in (ui_tag_ids or []) if int(item) > 0))
        self.ui_tag_match = "all" if ui_tag_match == "all" else "any"
        self.bucket_ui_tags_service = bucket_ui_tags_service
        self.actor_user_id = actor_user_id
        self.progress = ListingProgressEmitter(progress_callback)
        self.cancel_check = cancel_check

    def run(self) -> PaginatedStorageOpsBucketsResponse:
        self.progress.emit(
            percent=5,
            stage="prepare",
            processed=0,
            total=0,
            message="Preparing Storage Ops search",
            force=True,
        )
        invoke_cancel_check(self.cancel_check)
        query = _prepare_storage_ops_listing_query(
            filter=self.filter,
            advanced_filter=self.advanced_filter,
            include=self.include,
            with_stats=self.with_stats,
            sort_by=self.sort_by,
        )
        contexts = self._resolve_contexts(query)
        results = self._list_contexts(contexts, query)
        results = self._apply_ui_tags(results)
        page_items, total, has_next = self._paginate(results)
        page_items = self._enrich_page(page_items, contexts, query)
        invoke_cancel_check(self.cancel_check)
        self.progress.emit(
            percent=100,
            stage="finalize",
            processed=total,
            total=total,
            message="Search completed",
            force=True,
        )
        return PaginatedStorageOpsBucketsResponse(
            items=page_items,
            total=total,
            page=self.page,
            page_size=self.page_size,
            has_next=has_next,
        )

    def _apply_ui_tags(
        self,
        results: list[StorageOpsBucketSummary],
    ) -> list[StorageOpsBucketSummary]:
        if self.bucket_ui_tags_service is None or self.actor_user_id is None:
            return results
        targets = [
            PhysicalBucketTarget.create(bucket.endpoint_id or 0, bucket.tenant, bucket.bucket_name or bucket.name)
            for bucket in results
        ]
        tags_by_target = self.bucket_ui_tags_service.get_tags_for_targets(
            domain_kind=TAG_DOMAIN_BUCKET_UI_STORAGE_OPS,
            actor_user_id=self.actor_user_id,
            targets=targets,
        )
        requested = set(self.ui_tag_ids)
        matched: list[StorageOpsBucketSummary] = []
        for bucket, target in zip(results, targets):
            bucket.ui_tags = list(tags_by_target.get(target, []))
            if not requested:
                matched.append(bucket)
                continue
            assigned = {tag.id for tag in bucket.ui_tags}
            include = requested.issubset(assigned) if self.ui_tag_match == "all" else bool(requested & assigned)
            if include:
                matched.append(bucket)
        return matched

    def _resolve_contexts(
        self,
        query: _StorageOpsListingQuery,
    ) -> list[StorageOpsResolvedContext]:
        refs = self.load_context_refs()
        self.progress.emit(
            percent=10,
            stage="collect_contexts",
            processed=len(refs),
            total=len(refs),
            message="Collecting Storage Ops contexts",
            force=True,
        )
        invoke_cancel_check(self.cancel_check)
        refs = _filter_context_refs_by_advanced_filter(refs, query.parsed_filter)
        self.progress.emit(
            percent=15,
            stage="filter_contexts",
            processed=len(refs),
            total=len(refs),
            message="Filtering Storage Ops contexts",
            force=True,
        )
        contexts = resolve_storage_ops_contexts(
            refs=refs,
            resolve_account=self.resolve_account,
            progress=self.progress,
            cancel_check=self.cancel_check,
        )
        self.progress.emit(
            percent=25,
            stage="resolve_contexts",
            processed=len(contexts),
            total=len(refs),
            message="Storage Ops contexts resolved",
            force=True,
        )
        invoke_cancel_check(self.cancel_check)
        return contexts

    def _list_contexts(
        self,
        contexts: list[StorageOpsResolvedContext],
        query: _StorageOpsListingQuery,
    ) -> list[StorageOpsBucketSummary]:
        total = len(contexts)
        self.progress.emit(
            percent=30 if total else 75,
            stage="context_listing",
            processed=0,
            total=total,
            message="Loading context bucket listings",
            force=True,
        )
        if total <= 1:
            return self._list_contexts_serially(contexts, query)
        return self._list_contexts_concurrently(contexts, query)

    def _list_context_buckets(
        self,
        context: StorageOpsResolvedContext,
        query: _StorageOpsListingQuery,
    ) -> list[StorageOpsBucketSummary]:
        return list_storage_ops_context_buckets(
            context=context,
            service=self.service,
            needs_stats=query.needs_stats,
            requested_features=query.requested_features,
            include_tags=query.include_tags,
            parsed_filter=query.parsed_filter,
            normalized_search=query.normalized_search,
            filter_requires_owner_name=query.filter_requires_owner_name,
            filter_requires_owner_suspended=query.filter_requires_owner_suspended,
            filter_requires_owner_quota=query.filter_requires_owner_quota,
            owner_usage_required=query.owner_usage_required,
        )

    def _list_contexts_serially(
        self,
        contexts: list[StorageOpsResolvedContext],
        query: _StorageOpsListingQuery,
    ) -> list[StorageOpsBucketSummary]:
        results: list[StorageOpsBucketSummary] = []
        total = len(contexts)
        for index, context in enumerate(contexts, start=1):
            invoke_cancel_check(self.cancel_check)
            results.extend(self._list_context_buckets(context, query))
            self._emit_context_listing_progress(index, total)
            invoke_cancel_check(self.cancel_check)
        return results

    def _list_contexts_concurrently(
        self,
        contexts: list[StorageOpsResolvedContext],
        query: _StorageOpsListingQuery,
    ) -> list[StorageOpsBucketSummary]:
        results: list[StorageOpsBucketSummary] = []
        total = len(contexts)
        max_workers = min(STORAGE_OPS_CONTEXT_LISTING_MAX_WORKERS, total)
        with ThreadPoolExecutor(
            max_workers=max_workers,
            thread_name_prefix="storage-ops-list",
        ) as executor:
            futures = [
                executor.submit(self._list_context_buckets, context, query)
                for context in contexts
            ]
            for index, future in enumerate(as_completed(futures), start=1):
                invoke_cancel_check(self.cancel_check)
                try:
                    results.extend(future.result())
                except Exception as exc:
                    logger.warning("Storage Ops context worker failed: %s", exc)
                self._emit_context_listing_progress(index, total)
                invoke_cancel_check(self.cancel_check)
        return results

    def _emit_context_listing_progress(self, processed: int, total: int) -> None:
        self.progress.emit(
            percent=interpolate_progress_percent(
                30,
                75,
                processed=processed,
                total=total,
            ),
            stage="context_listing",
            processed=processed,
            total=total,
            message="Loading context bucket listings",
        )

    def _paginate(
        self,
        results: list[StorageOpsBucketSummary],
    ) -> tuple[list[StorageOpsBucketSummary], int, bool]:
        self.progress.emit(
            percent=85,
            stage="sort_paginate",
            processed=len(results),
            total=len(results),
            message="Sorting and paginating bucket results",
            force=True,
        )
        invoke_cancel_check(self.cancel_check)
        sorted_items = _sort_buckets(
            results,
            sort_by=self.sort_by,
            sort_dir=self.sort_dir,
        )
        total = len(sorted_items)
        start = max(self.page - 1, 0) * self.page_size
        end = start + self.page_size
        return sorted_items[start:end], total, end < total

    def _enrich_page(
        self,
        page_items: list[StorageOpsBucketSummary],
        contexts: list[StorageOpsResolvedContext],
        query: _StorageOpsListingQuery,
    ) -> list[StorageOpsBucketSummary]:
        wants_owner_metadata = bool(
            query.wants_owner_name
            or query.wants_owner_suspended
            or query.wants_owner_quota
            or query.wants_owner_quota_usage
        )
        if not page_items or not wants_owner_metadata:
            return page_items
        self.progress.emit(
            percent=92,
            stage="page_enrichment",
            processed=0,
            total=len(page_items),
            message="Loading page owner metadata",
            force=True,
        )
        return _apply_page_owner_enrichment(
            page_items=page_items,
            resolved_contexts_by_id={
                context.ref.context_id: context for context in contexts
            },
            include_name=query.wants_owner_name,
            include_suspended=query.wants_owner_suspended,
            include_quota=query.wants_owner_quota or query.wants_owner_quota_usage,
            progress=self.progress,
            cancel_check=self.cancel_check,
        )


def compute_storage_ops_bucket_listing(
    *,
    load_context_refs: Callable[[], list[StorageOpsContextRef]],
    resolve_account: Callable[[StorageOpsContextRef], S3ExecutionContext | None],
    service: BucketsService,
    page: int,
    page_size: int,
    filter: str | None,
    advanced_filter: str | None,
    sort_by: str,
    sort_dir: str,
    include: list[str],
    with_stats: bool,
    ui_tag_ids: list[int] | None = None,
    ui_tag_match: str = "any",
    bucket_ui_tags_service: BucketUiTagsService | None = None,
    actor_user_id: int | None = None,
    progress_callback: Callable[[ListingProgressSnapshot], None] | None = None,
    cancel_check: Callable[[], None] | None = None,
) -> PaginatedStorageOpsBucketsResponse:
    return _StorageOpsBucketListingPipeline(
        load_context_refs=load_context_refs,
        resolve_account=resolve_account,
        service=service,
        page=page,
        page_size=page_size,
        filter=filter,
        advanced_filter=advanced_filter,
        sort_by=sort_by,
        sort_dir=sort_dir,
        include=include,
        with_stats=with_stats,
        ui_tag_ids=ui_tag_ids,
        ui_tag_match=ui_tag_match,
        bucket_ui_tags_service=bucket_ui_tags_service,
        actor_user_id=actor_user_id,
        progress_callback=progress_callback,
        cancel_check=cancel_check,
    ).run()
