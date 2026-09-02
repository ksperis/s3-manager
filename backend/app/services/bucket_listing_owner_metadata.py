# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, Callable, Literal, Protocol

from app.db import StorageEndpoint
from app.models.bucket_filter import BucketFilterQuery
from app.models.bucket_listing import BucketListingSummary
from app.services.bucket_owner_enrichment import BucketOwnerMetadataService, BucketOwnerUsage
from app.services.listing_progress import (
    ListingProgressEmitter,
    build_listing_progress_callback,
    invoke_cancel_check,
)
from app.services.rgw_admin import RGWAdminClient, RGWAdminError
from app.services.rgw_bucket_metadata import (
    extract_bucket_owner_scope,
    owner_kind_from_owner,
    split_tenant_uid,
)
from app.utils.normalize import normalize_optional_scalar, normalize_text
from app.utils.storage_endpoint_features import resolve_feature_flags

BUCKET_OWNER_LOOKUP_MAX_WORKERS = 6

OWNER_QUOTA_FIELDS = {"owner_quota_max_size_bytes", "owner_quota_max_objects"}
OWNER_STATUS_FIELDS = {"owner_suspended"}
OWNER_USAGE_FIELDS = {"owner_used_bytes", "owner_object_count"}
OWNER_USAGE_PERCENT_FIELDS = {"owner_quota_usage_size_percent", "owner_quota_usage_object_percent"}
OWNER_ENRICHED_FIELDS = OWNER_STATUS_FIELDS | OWNER_QUOTA_FIELDS | OWNER_USAGE_FIELDS | OWNER_USAGE_PERCENT_FIELDS
OWNER_DETAIL_FIELDS = {"owner_name"} | OWNER_ENRICHED_FIELDS


class BucketListingAdminContext(Protocol):
    endpoint: StorageEndpoint
    rgw_admin: RGWAdminClient


def normalize_owner_kind(raw: object) -> Literal["account", "user"] | None:
    if not isinstance(raw, str):
        return None
    value = raw.strip().lower().replace("-", "_")
    if value in {"account", "accounts", "acct"}:
        return "account"
    if value in {"user", "users"}:
        return "user"
    return None


def normalize_owner_kind_scalar(raw: object) -> str | None:
    normalized_kind = normalize_owner_kind(raw)
    if normalized_kind:
        return normalized_kind
    normalized = normalize_text(str(raw or ""))
    return normalized or None


def determine_owner_name_lookup_scope(
    query: BucketFilterQuery | None,
) -> Literal["any", "account", "user"]:
    if not query or query.match != "all":
        return "any"
    allowed: set[Literal["account", "user"]] = {"account", "user"}
    saw_owner_kind_rule = False
    for rule in query.rules:
        if rule.field != "owner_kind":
            continue
        saw_owner_kind_rule = True
        if rule.op == "eq":
            value = normalize_owner_kind(rule.value)
            if value:
                allowed &= {value}
        elif rule.op == "neq":
            value = normalize_owner_kind(rule.value)
            if value:
                allowed.discard(value)
        elif rule.op == "in" and isinstance(rule.value, list):
            values = {normalize_owner_kind(item) for item in rule.value}
            values = {item for item in values if item is not None}
            if values:
                allowed &= values
        elif rule.op == "not_in" and isinstance(rule.value, list):
            values = {normalize_owner_kind(item) for item in rule.value}
            values = {item for item in values if item is not None}
            if values:
                allowed -= values
    if not saw_owner_kind_rule:
        return "any"
    if len(allowed) == 1:
        return next(iter(allowed))
    return "any"


def _resolve_owner_name(
    ctx: BucketListingAdminContext,
    owner_id: str | None,
    tenant: str | None,
    cache: dict[str, str | None],
    owner_scope: Literal["any", "account", "user"] = "any",
) -> str | None:
    if not owner_id:
        return None
    owner_key = f"{tenant or ''}:{owner_id}"
    if owner_key in cache:
        return cache[owner_key]

    owner_kind = owner_kind_from_owner(owner_id)
    if owner_scope != "any" and owner_kind != owner_scope:
        cache[owner_key] = None
        return None

    name: str | None = None
    account_lookup_enabled: bool | None
    try:
        account_lookup_enabled = resolve_feature_flags(ctx.endpoint).account_enabled
    except Exception:
        account_lookup_enabled = None

    if owner_scope in {"any", "account"} and account_lookup_enabled is not False:
        try:
            account_payload = ctx.rgw_admin.get_account(
                owner_id,
                allow_not_found=True,
                allow_not_implemented=True,
            )
        except RGWAdminError:
            account_payload = None
        if isinstance(account_payload, dict) and not account_payload.get("not_found"):
            # Strict account owner-name resolution: only RGW account "name" is accepted.
            name = normalize_optional_scalar(account_payload.get("name"))
            cache[owner_key] = name
            return name

    if owner_scope == "account":
        cache[owner_key] = None
        return None

    tenant_hint = tenant
    uid = owner_id
    split_tenant, split_uid = split_tenant_uid(owner_id)
    if split_tenant:
        tenant_hint = split_tenant
        uid = split_uid
    try:
        user_payload = ctx.rgw_admin.get_user(uid, tenant=tenant_hint, allow_not_found=True)
    except RGWAdminError:
        user_payload = None
    if isinstance(user_payload, dict) and not user_payload.get("not_found"):
        # Strict user owner-name resolution: only RGW "display_name" is accepted.
        name = normalize_optional_scalar(user_payload.get("display_name"))
    cache[owner_key] = name
    return name


def resolve_owner_names_for_buckets(
    ctx: BucketListingAdminContext,
    buckets: list[BucketListingSummary],
    owner_scope: Literal["any", "account", "user"] = "any",
) -> dict[str, str | None]:
    owner_targets: dict[str, tuple[str | None, str]] = {}
    for bucket in buckets:
        if not bucket.owner:
            continue
        if owner_scope != "any":
            bucket_owner_kind = owner_kind_from_owner(bucket.owner)
            if bucket_owner_kind != owner_scope:
                continue
        owner_key = f"{bucket.tenant or ''}:{bucket.owner}"
        if owner_key not in owner_targets:
            owner_targets[owner_key] = (bucket.tenant, bucket.owner)

    if not owner_targets:
        return {}

    if len(owner_targets) <= 1:
        owner_key, (tenant, owner) = next(iter(owner_targets.items()))
        return {owner_key: _resolve_owner_name(ctx, owner, tenant, {}, owner_scope=owner_scope)}

    max_workers = min(BUCKET_OWNER_LOOKUP_MAX_WORKERS, len(owner_targets))

    def resolve_owner_target(item: tuple[str, tuple[str | None, str]]) -> tuple[str, str | None]:
        key, (tenant, owner) = item
        return key, _resolve_owner_name(ctx, owner, tenant, {}, owner_scope=owner_scope)

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        return dict(executor.map(resolve_owner_target, owner_targets.items()))


def apply_owner_enrichment(
    ctx: BucketListingAdminContext,
    buckets: list[BucketListingSummary],
    *,
    include_suspended: bool = False,
    include_quota: bool = False,
    include_usage: bool = False,
    usage_by_key: dict[str, BucketOwnerUsage] | None = None,
) -> list[BucketListingSummary]:
    if not buckets or (not include_suspended and not include_quota and not include_usage):
        return buckets
    service = BucketOwnerMetadataService(
        endpoint_id=int(getattr(ctx.endpoint, "id", 0) or 0),
        endpoint=ctx.endpoint,
        rgw_admin=ctx.rgw_admin,
    )
    kwargs: dict[str, Any] = {
        "include_quota": include_quota,
        "include_usage": include_usage,
        "usage_by_key": usage_by_key,
    }
    if include_suspended:
        kwargs["include_suspended"] = True
    return service.enrich_buckets(buckets, **kwargs)


def _filter_requires_owner_metadata(query: BucketFilterQuery | None) -> bool:
    if not query:
        return False
    owner_related_fields = {"owner", "owner_kind", "tenant"} | OWNER_DETAIL_FIELDS
    return any(rule.field in owner_related_fields for rule in query.rules)


def _filter_requires_tenant_metadata(query: BucketFilterQuery | None) -> bool:
    if not query:
        return False
    if any(rule.field == "tenant" for rule in query.rules):
        return True
    if any(rule.field in OWNER_DETAIL_FIELDS for rule in query.rules):
        return determine_owner_name_lookup_scope(query) != "account"
    return False


def filter_requires_owner_usage(query: BucketFilterQuery | None) -> bool:
    if not query:
        return False
    owner_usage_fields = OWNER_USAGE_FIELDS | OWNER_USAGE_PERCENT_FIELDS
    return any(rule.field in owner_usage_fields for rule in query.rules)


def request_requires_owner_metadata(
    query: BucketFilterQuery | None,
    sort_by: str,
    simple_filter: str | None,
) -> bool:
    return _filter_requires_owner_metadata(query) or sort_by in {"tenant", "owner"} or bool(simple_filter)


def request_requires_tenant_metadata(
    query: BucketFilterQuery | None,
    sort_by: str,
    simple_filter: str | None,
) -> bool:
    return _filter_requires_tenant_metadata(query) or sort_by == "tenant" or bool(simple_filter)


def backfill_bucket_owner_metadata(
    ctx: BucketListingAdminContext,
    buckets: list[BucketListingSummary],
    *,
    include_tenant: bool = False,
    progress: ListingProgressEmitter | None = None,
    progress_stage: str = "owner_backfill",
    progress_message: str = "Loading bucket owner metadata",
    progress_start: int = 63,
    progress_end: int = 65,
    cancel_check: Callable[[], None] | None = None,
) -> list[BucketListingSummary]:
    if not buckets:
        return buckets

    pending = [
        bucket
        for bucket in buckets
        if not bucket.owner
        or (
            include_tenant
            and bucket.tenant is None
            and not bucket.tenant_metadata_resolved
            and owner_kind_from_owner(bucket.owner) != "account"
        )
    ]
    if not pending:
        return buckets

    def load_one(
        bucket: BucketListingSummary,
    ) -> tuple[BucketListingSummary, str | None, str | None, bool]:
        try:
            payload = ctx.rgw_admin.get_bucket_info(bucket.name, stats=False, allow_not_found=True)
        except RGWAdminError:
            return bucket, None, None, False
        if not isinstance(payload, dict) or payload.get("not_found"):
            return bucket, None, None, False
        tenant, owner = extract_bucket_owner_scope(payload)
        tenant_metadata_resolved = "tenant" in payload and payload.get("tenant") is not None
        return bucket, tenant, owner, tenant_metadata_resolved

    max_workers = min(BUCKET_OWNER_LOOKUP_MAX_WORKERS, len(pending))
    total = len(pending)
    emit_progress = build_listing_progress_callback(
        progress,
        stage=progress_stage,
        message=progress_message,
        start=progress_start,
        end=progress_end,
        total=total,
    )

    if max_workers <= 1:
        resolved = []
        for index, bucket in enumerate(pending, start=1):
            invoke_cancel_check(cancel_check)
            resolved.append(load_one(bucket))
            emit_progress(index)
            invoke_cancel_check(cancel_check)
    else:
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            futures = [executor.submit(load_one, bucket) for bucket in pending]
            resolved = []
            for index, future in enumerate(as_completed(futures), start=1):
                invoke_cancel_check(cancel_check)
                resolved.append(future.result())
                emit_progress(index)
                invoke_cancel_check(cancel_check)

    for bucket, tenant, owner, tenant_metadata_resolved in resolved:
        if not bucket.owner and owner:
            bucket.owner = owner
        if include_tenant and bucket.tenant is None and tenant:
            bucket.tenant = tenant
        if include_tenant and tenant_metadata_resolved:
            bucket.tenant_metadata_resolved = True
    return buckets
