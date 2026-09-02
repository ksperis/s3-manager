# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Callable

from app.models.bucket_filter import BucketFilterRule
from app.models.ceph_admin import CephAdminBucketSummary
from app.services.bucket_configuration_service import BucketConfigurationService
from app.services.bucket_feature_param_matching import (
    FEATURE_PARAM_UNAVAILABLE,
    required_feature_param_sources,
)
from app.services.bucket_notification_state import account_sns_feature_enabled
from app.services.listing_progress import (
    ListingProgressEmitter,
    build_listing_progress_callback,
    invoke_cancel_check,
)
from app.services.s3_execution_context import S3ExecutionTarget

BUCKET_FEATURE_PARAM_MAX_WORKERS = 6


def bucket_identity_key(bucket: CephAdminBucketSummary) -> str:
    return f"{bucket.tenant or ''}:{bucket.name}"


def _load_feature_param_snapshot_for_bucket(
    bucket: CephAdminBucketSummary,
    required_sources: set[str],
    service: BucketConfigurationService,
    account: S3ExecutionTarget,
) -> dict[str, object]:
    snapshot: dict[str, object] = {}
    if "props" in required_sources:
        try:
            snapshot["props"] = service.get_bucket_properties(bucket.name, account)
        except RuntimeError:
            snapshot["props"] = FEATURE_PARAM_UNAVAILABLE
    if "lifecycle" in required_sources:
        try:
            snapshot["lifecycle"] = service.get_lifecycle(bucket.name, account).rules or []
        except RuntimeError:
            snapshot["lifecycle"] = FEATURE_PARAM_UNAVAILABLE
    if "logging" in required_sources:
        try:
            snapshot["logging"] = service.get_bucket_logging(bucket.name, account)
        except RuntimeError:
            snapshot["logging"] = FEATURE_PARAM_UNAVAILABLE
    if "website" in required_sources:
        try:
            snapshot["website"] = service.get_bucket_website(bucket.name, account)
        except RuntimeError:
            snapshot["website"] = FEATURE_PARAM_UNAVAILABLE
    if "policy" in required_sources:
        try:
            snapshot["policy"] = service.get_policy(bucket.name, account)
        except RuntimeError:
            snapshot["policy"] = FEATURE_PARAM_UNAVAILABLE
    if "notifications" in required_sources:
        if not account_sns_feature_enabled(account):
            snapshot["notifications"] = FEATURE_PARAM_UNAVAILABLE
        else:
            try:
                snapshot["notifications"] = (
                    service.get_bucket_notifications(bucket.name, account).configuration or {}
                )
            except RuntimeError:
                snapshot["notifications"] = FEATURE_PARAM_UNAVAILABLE
    if "encryption" in required_sources:
        try:
            snapshot["encryption"] = service.get_bucket_encryption(bucket.name, account)
        except RuntimeError:
            snapshot["encryption"] = FEATURE_PARAM_UNAVAILABLE
    return snapshot


def load_bucket_feature_param_snapshots(
    buckets: list[CephAdminBucketSummary],
    rules: list[BucketFilterRule],
    service: BucketConfigurationService,
    account: S3ExecutionTarget,
    *,
    progress: ListingProgressEmitter | None = None,
    progress_stage: str = "feature_param_enrichment",
    progress_message: str = "Loading bucket feature parameters",
    progress_start: int = 82,
    progress_end: int = 88,
    cancel_check: Callable[[], None] | None = None,
) -> tuple[dict[str, dict[str, object]], set[str]]:
    snapshots: dict[str, dict[str, object]] = {}
    if not buckets:
        return snapshots, set()
    required_sources = required_feature_param_sources(rules)
    if not required_sources:
        available = {bucket_identity_key(bucket) for bucket in buckets}
        return snapshots, available

    def load_one(bucket: CephAdminBucketSummary) -> tuple[str, dict[str, object]]:
        snapshot = _load_feature_param_snapshot_for_bucket(
            bucket,
            required_sources,
            service,
            account,
        )
        return bucket_identity_key(bucket), snapshot

    max_workers = min(BUCKET_FEATURE_PARAM_MAX_WORKERS, len(buckets))
    total = len(buckets)
    emit_progress = build_listing_progress_callback(
        progress,
        stage=progress_stage,
        message=progress_message,
        start=progress_start,
        end=progress_end,
        total=total,
    )

    if max_workers <= 1:
        for index, bucket in enumerate(buckets, start=1):
            invoke_cancel_check(cancel_check)
            key, snapshot = load_one(bucket)
            snapshots[key] = snapshot
            emit_progress(index)
            invoke_cancel_check(cancel_check)
    else:
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            futures = [executor.submit(load_one, bucket) for bucket in buckets]
            for index, future in enumerate(as_completed(futures), start=1):
                invoke_cancel_check(cancel_check)
                key, snapshot = future.result()
                snapshots[key] = snapshot
                emit_progress(index)
                invoke_cancel_check(cancel_check)

    available_keys: set[str] = set()
    for key, snapshot in snapshots.items():
        if all(
            snapshot.get(source, FEATURE_PARAM_UNAVAILABLE) is not FEATURE_PARAM_UNAVAILABLE
            for source in required_sources
        ):
            available_keys.add(key)
    return snapshots, available_keys
