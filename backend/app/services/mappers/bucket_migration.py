# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import json
from typing import Optional

from app.db import BucketMigration, BucketMigrationEvent, BucketMigrationItem
from app.models.bucket_migration import (
    BucketMigrationDetail,
    BucketMigrationEventView,
    BucketMigrationItemView,
    BucketMigrationView,
)


def load_migration_json(value: Optional[str]) -> Optional[dict]:
    if value is None:
        return None
    parsed = json.loads(value)
    if not isinstance(parsed, dict):
        raise ValueError("Persisted bucket migration JSON must be an object")
    return parsed


def bucket_migration_item_to_view(item: BucketMigrationItem) -> BucketMigrationItemView:
    return BucketMigrationItemView(
        id=item.id,
        source_bucket=item.source_bucket,
        target_bucket=item.target_bucket,
        status=item.status,
        step=item.step,
        pre_sync_done=bool(item.pre_sync_done),
        read_only_applied=bool(item.read_only_applied),
        target_lock_applied=bool(item.target_lock_applied),
        target_bucket_exists=bool(item.target_bucket_exists),
        objects_copied=int(item.objects_copied or 0),
        objects_deleted=int(item.objects_deleted or 0),
        source_count=item.source_count,
        target_count=item.target_count,
        matched_count=item.matched_count,
        different_count=item.different_count,
        only_source_count=item.only_source_count,
        only_target_count=item.only_target_count,
        diff_sample=load_migration_json(item.diff_sample_json),
        error_message=item.error_message,
        started_at=item.started_at,
        finished_at=item.finished_at,
        created_at=item.created_at,
        updated_at=item.updated_at,
    )


def bucket_migration_event_to_view(entry: BucketMigrationEvent) -> BucketMigrationEventView:
    return BucketMigrationEventView(
        id=entry.id,
        item_id=entry.item_id,
        level=entry.level,
        message=entry.message,
        metadata=load_migration_json(entry.metadata_json),
        created_at=entry.created_at,
    )


def bucket_migration_to_view(migration: BucketMigration) -> BucketMigrationView:
    return BucketMigrationView(
        id=migration.id,
        created_by_user_id=migration.created_by_user_id,
        source_context_id=migration.source_context_id,
        target_context_id=migration.target_context_id,
        mode=migration.mode,
        copy_bucket_settings=bool(migration.copy_bucket_settings),
        delete_source=bool(migration.delete_source),
        strong_integrity_check=bool(getattr(migration, "strong_integrity_check", False)),
        lock_target_writes=bool(migration.lock_target_writes),
        use_same_endpoint_copy=bool(migration.use_same_endpoint_copy),
        auto_grant_source_read_for_copy=bool(migration.auto_grant_source_read_for_copy),
        webhook_url=migration.webhook_url,
        mapping_prefix=migration.mapping_prefix,
        status=migration.status,
        pause_requested=bool(migration.pause_requested),
        cancel_requested=bool(migration.cancel_requested),
        precheck_status=(migration.precheck_status or "pending"),
        precheck_report=load_migration_json(migration.precheck_report_json),
        precheck_checked_at=migration.precheck_checked_at,
        parallelism_max=int(migration.parallelism_max or 1),
        total_items=int(migration.total_items or 0),
        completed_items=int(migration.completed_items or 0),
        failed_items=int(migration.failed_items or 0),
        skipped_items=int(migration.skipped_items or 0),
        awaiting_items=int(migration.awaiting_items or 0),
        error_message=migration.error_message,
        started_at=migration.started_at,
        finished_at=migration.finished_at,
        last_heartbeat_at=migration.last_heartbeat_at,
        created_at=migration.created_at,
        updated_at=migration.updated_at,
    )


def bucket_migration_to_detail(
    migration: BucketMigration,
    *,
    items: list[BucketMigrationItem],
    recent_events: list[BucketMigrationEvent],
) -> BucketMigrationDetail:
    base = bucket_migration_to_view(migration)
    return BucketMigrationDetail(
        **base.model_dump(),
        items=[bucket_migration_item_to_view(item) for item in items],
        recent_events=[bucket_migration_event_to_view(event) for event in recent_events],
    )
