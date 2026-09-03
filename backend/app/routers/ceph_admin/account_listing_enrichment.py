# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Detailed RGW account enrichment for Ceph Admin listings."""

from __future__ import annotations

from typing import Any, Callable

from fastapi import status

from app.models.ceph_admin import CephAdminRgwAccountSummary
from app.routers.ceph_admin.account_common import (
    extract_bucket_count,
    extract_user_count,
)
from app.routers.ceph_admin.dependencies import CephAdminContext
from app.routers.ceph_admin.listing_common import parse_int
from app.services.listing_progress import (
    ListingProgressEmitter,
    interpolate_progress_percent,
    invoke_cancel_check,
)
from app.services.rgw_admin import RGWAdminError
from app.utils.http_errors import raise_http_exception_from_exception
from app.utils.normalize import normalize_optional_scalar
from app.utils.quota_stats import extract_quota_limits
from app.utils.rgw_payloads import extract_bucket_list
from app.utils.usage_stats import summarize_bucket_usage


def account_field_needs_enrichment(
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


def account_profile_needs_enrichment(
    account: CephAdminRgwAccountSummary,
) -> bool:
    return (
        account_field_needs_enrichment(account, "account_name")
        or account.email is None
    )


def enrich_accounts(
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
        account = item.model_copy(deep=True)
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
        limits = (
            payload.get("limits")
            if isinstance(payload.get("limits"), dict)
            else {}
        )
        account.max_users = parse_int(
            payload.get("max_users") or limits.get("max_users")
        )
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
