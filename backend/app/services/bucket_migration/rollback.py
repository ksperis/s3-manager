# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from ._shared import *


class BucketMigrationRollbackMixin:
    def _find_migration_item(self, migration: BucketMigration, item_id: int) -> BucketMigrationItem:
        for item in migration.items:
            if item.id == item_id:
                return item
        raise ValueError("Migration item not found")

    def _ensure_manual_item_operation_allowed(self, migration: BucketMigration) -> None:
        if migration.status in _RUNNABLE_MIGRATION_STATUSES:
            raise ValueError("Bucket-level actions are not available while migration is active")

    def _retry_step_for_failed_item(self, item: BucketMigrationItem) -> str:
        if item.step in {"verify", "rollback_failed"}:
            return "sync"
        return item.step or "create_bucket"

    def _prepare_item_retry(self, migration: BucketMigration, item: BucketMigrationItem) -> None:
        item.status = "pending"
        item.step = self._retry_step_for_failed_item(item)
        item.error_message = None
        item.finished_at = None
        item.updated_at = utcnow()
        self._add_event(
            migration,
            item=item,
            level="info",
            message="Retry requested for bucket item.",
            metadata={"retry_step": item.step},
        )

    def _queue_migration_for_retry(self, migration: BucketMigration, *, message: str) -> None:
        migration.status = "queued"
        migration.pause_requested = False
        migration.cancel_requested = False
        migration.worker_lease_owner = None
        migration.worker_lease_until = None
        migration.error_message = None
        migration.finished_at = None
        migration.updated_at = utcnow()
        if migration.started_at is None:
            migration.started_at = utcnow()
        self._recompute_counters(migration)
        self._add_event(
            migration,
            level="info",
            message=message,
        )

    def _rollback_single_item(
        self,
        migration: BucketMigration,
        item: BucketMigrationItem,
        source_ctx: _ResolvedContext,
        target_ctx: _ResolvedContext,
    ) -> None:
        rollback_issues: list[str] = []

        if item.read_only_applied or item.source_policy_backup_json:
            try:
                if item.source_policy_backup_json:
                    self._restore_source_policy(item.source_bucket, source_ctx.account, item)
                else:
                    self._remove_managed_read_only_statement(item.source_bucket, source_ctx.account)
                item.read_only_applied = False
                item.source_policy_backup_json = None
            except Exception as exc:  # noqa: BLE001
                rollback_issues.append(
                    _truncate_db_text(
                        f"source policy restore failed: {exc}",
                        max_chars=_DB_ERROR_MESSAGE_MAX_CHARS,
                    )
                )

        if item.target_lock_applied or item.target_policy_backup_json:
            try:
                if item.target_policy_backup_json:
                    self._restore_target_write_lock_policy(target_ctx.account, item.target_bucket, item)
                else:
                    self._remove_managed_target_write_lock_statement(item.target_bucket, target_ctx.account)
                item.target_lock_applied = False
                item.target_policy_backup_json = None
            except Exception as exc:  # noqa: BLE001
                rollback_issues.append(
                    _truncate_db_text(
                        f"target lock restore failed: {exc}",
                        max_chars=_DB_ERROR_MESSAGE_MAX_CHARS,
                    )
                )

        try:
            purged_current, purged_versions = self._purge_target_bucket(target_ctx, item.target_bucket)
            purged_count = purged_current + purged_versions
            item.objects_deleted = int(item.objects_deleted or 0) + purged_count
            item.replication_state_json = None
        except Exception as exc:  # noqa: BLE001
            rollback_issues.append(
                _truncate_db_text(
                    f"destination cleanup failed: {exc}",
                    max_chars=_DB_ERROR_MESSAGE_MAX_CHARS,
                )
            )

        if rollback_issues:
            item.status = "failed"
            item.step = "rollback_failed"
            item.error_message = _truncate_optional_db_text(
                "Rollback failed: " + "; ".join(rollback_issues),
                max_chars=_DB_ERROR_MESSAGE_MAX_CHARS,
            )
            item.finished_at = utcnow()
            item.updated_at = utcnow()
            self._add_event(
                migration,
                item=item,
                level="error",
                message="Rollback failed for bucket item.",
                metadata={"issues": rollback_issues},
            )
            return

        item.status = "rolled_back"
        item.step = "rolled_back"
        item.error_message = None
        item.finished_at = utcnow()
        item.updated_at = utcnow()
        self._add_event(
            migration,
            item=item,
            level="info",
            message="Rollback completed for bucket item.",
            metadata={"target_bucket": item.target_bucket},
        )

    def _refresh_status_after_manual_item_operations(self, migration: BucketMigration) -> None:
        self._recompute_counters(migration)
        pending_count = len([item for item in migration.items if item.status in {"pending", "running", "paused"}])
        awaiting_count = len([item for item in migration.items if item.status == "awaiting_cutover"])

        if pending_count > 0:
            migration.status = "queued"
            migration.pause_requested = False
            migration.cancel_requested = False
            migration.worker_lease_owner = None
            migration.worker_lease_until = None
            migration.error_message = None
            migration.finished_at = None
            migration.updated_at = utcnow()
            return

        if migration.failed_items > 0:
            migration.status = "completed_with_errors"
            migration.updated_at = utcnow()
            return

        if migration.mode == "pre_sync" and awaiting_count > 0:
            migration.status = "awaiting_cutover"
            migration.pause_requested = False
            migration.cancel_requested = False
            migration.worker_lease_owner = None
            migration.worker_lease_until = None
            migration.error_message = None
            migration.finished_at = None
            migration.updated_at = utcnow()
            return

        if migration.status == "canceled":
            migration.error_message = None
            migration.updated_at = utcnow()
            return

        migration.status = "completed"
        migration.error_message = None
        migration.pause_requested = False
        migration.cancel_requested = False
        migration.worker_lease_owner = None
        migration.worker_lease_until = None
        migration.finished_at = utcnow()
        migration.updated_at = utcnow()

    def _rollback_source_data_risk_reason(
        self,
        migration: BucketMigration,
        item: BucketMigrationItem,
    ) -> Optional[str]:
        if item.status == "skipped":
            return None
        if bool(getattr(item, "source_deleted", False)):
            return "source deletion already completed"
        if not migration.delete_source:
            return None
        if item.status == "completed":
            return "item completed with delete-source enabled"
        if item.step in {"delete_source", "completed"}:
            return f"item is at step '{item.step}' with delete-source enabled"
        return None

    def _ensure_source_accessible_for_rollback(
        self,
        source_ctx: _ResolvedContext,
        items: list[BucketMigrationItem],
    ) -> None:
        errors: list[str] = []
        checked_buckets: set[str] = set()
        for item in items:
            if item.status == "skipped":
                continue
            bucket_name = (item.source_bucket or "").strip()
            if not bucket_name or bucket_name in checked_buckets:
                continue
            checked_buckets.add(bucket_name)
            try:
                self._precheck_can_list_bucket(source_ctx, bucket_name)
            except Exception as exc:  # noqa: BLE001
                errors.append(f"{bucket_name}: {exc}")

        if errors:
            sample = "; ".join(errors[:3])
            suffix = f" (+{len(errors) - 3} more)" if len(errors) > 3 else ""
            raise ValueError(
                "Rollback blocked to prevent data loss: unable to verify source bucket accessibility for "
                f"{len(errors)} bucket(s): {sample}{suffix}"
            )

    def _ensure_rollback_safe(
        self,
        migration: BucketMigration,
        items: list[BucketMigrationItem],
        *,
        source_ctx: _ResolvedContext,
    ) -> None:
        risks: list[str] = []
        for item in items:
            reason = self._rollback_source_data_risk_reason(migration, item)
            if reason:
                risks.append(f"{item.source_bucket}: {reason}")
        if risks:
            sample = "; ".join(risks[:3])
            suffix = f" (+{len(risks) - 3} more)" if len(risks) > 3 else ""
            raise ValueError(
                "Rollback blocked to prevent data loss: source data may have been deleted for "
                f"{len(risks)} bucket(s): {sample}{suffix}"
            )
        self._ensure_source_accessible_for_rollback(source_ctx, items)
