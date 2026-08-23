# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from app.db import BucketMigration, BucketMigrationItem
from app.utils.time import utcnow
from ._shared import (
    _DB_ERROR_MESSAGE_MAX_CHARS,
    _RUNNABLE_MIGRATION_STATUSES,
    _ResolvedContext,
    _truncate_db_text,
    _truncate_optional_db_text,
)


@dataclass(frozen=True)
class _ItemRollbackOutcome:
    issues: tuple[str, ...]
    purged_objects: int


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

    def retry_item(self, migration_id: int, item_id: int) -> BucketMigration:
        migration = self.get_migration(migration_id)
        item = self._find_migration_item(migration, item_id)
        self._ensure_manual_item_operation_allowed(migration)
        if item.status != "failed":
            raise ValueError("Retry is only available for failed bucket items")

        self._prepare_item_retry(migration, item)
        self._queue_migration_for_retry(migration, message=f"Retry requested for bucket '{item.source_bucket}'.")
        self._commit()
        self.db.refresh(migration)
        return migration

    def retry_failed_items(self, migration_id: int) -> tuple[BucketMigration, int]:
        migration = self.get_migration(migration_id)
        self._ensure_manual_item_operation_allowed(migration)
        failed_items = [item for item in migration.items if item.status == "failed"]
        if not failed_items:
            raise ValueError("No failed bucket items to retry")

        for item in failed_items:
            self._prepare_item_retry(migration, item)

        self._queue_migration_for_retry(
            migration,
            message=f"Retry requested for {len(failed_items)} failed bucket item(s).",
        )
        self._commit()
        self.db.refresh(migration)
        return migration, len(failed_items)

    def _execute_item_rollback(
        self,
        item: BucketMigrationItem,
        source_ctx: _ResolvedContext,
        target_ctx: _ResolvedContext,
        *,
        purge_target: bool,
    ) -> _ItemRollbackOutcome:
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

        purged_objects = 0
        if purge_target:
            try:
                purged_current, purged_versions = self._purge_target_bucket(target_ctx, item.target_bucket)
                purged_objects = purged_current + purged_versions
                item.objects_deleted = int(item.objects_deleted or 0) + purged_objects
                item.replication_state_json = None
            except Exception as exc:  # noqa: BLE001
                rollback_issues.append(
                    _truncate_db_text(
                        f"destination cleanup failed: {exc}",
                        max_chars=_DB_ERROR_MESSAGE_MAX_CHARS,
                    )
                )

        return _ItemRollbackOutcome(
            issues=tuple(rollback_issues),
            purged_objects=purged_objects,
        )

    def _finalize_item_rollback(
        self,
        migration: BucketMigration,
        item: BucketMigrationItem,
        outcome: _ItemRollbackOutcome,
        *,
        failure_message: str,
        success_message: str,
    ) -> str | None:
        if outcome.issues:
            item.status = "failed"
            item.step = "rollback_failed"
            item.error_message = _truncate_optional_db_text(
                "Rollback failed: " + "; ".join(outcome.issues),
                max_chars=_DB_ERROR_MESSAGE_MAX_CHARS,
            )
            item.finished_at = utcnow()
            item.updated_at = utcnow()
            self._add_event(
                migration,
                item=item,
                level="error",
                message=failure_message,
                metadata={"issues": list(outcome.issues)},
            )
            return _truncate_db_text(
                f"{item.source_bucket}: {'; '.join(outcome.issues)}",
                max_chars=_DB_ERROR_MESSAGE_MAX_CHARS,
            )

        item.status = "rolled_back"
        item.step = "rolled_back"
        item.error_message = None
        item.finished_at = utcnow()
        item.updated_at = utcnow()
        self._add_event(
            migration,
            item=item,
            level="info",
            message=success_message,
            metadata={"target_bucket": item.target_bucket},
        )
        return None

    def _rollback_single_item(
        self,
        migration: BucketMigration,
        item: BucketMigrationItem,
        source_ctx: _ResolvedContext,
        target_ctx: _ResolvedContext,
    ) -> None:
        outcome = self._execute_item_rollback(
            item,
            source_ctx,
            target_ctx,
            purge_target=True,
        )
        self._finalize_item_rollback(
            migration,
            item,
            outcome,
            failure_message="Rollback failed for bucket item.",
            success_message="Rollback completed for bucket item.",
        )

    def rollback_item(self, migration_id: int, item_id: int) -> BucketMigration:
        migration = self.get_migration(migration_id)
        item = self._find_migration_item(migration, item_id)
        self._ensure_manual_item_operation_allowed(migration)
        if item.status != "failed":
            raise ValueError("Rollback is only available for failed bucket items")

        source_ctx = self._resolve_context(migration.source_context_id)
        target_ctx = self._resolve_context(migration.target_context_id)
        self._ensure_rollback_safe(migration, [item], source_ctx=source_ctx)
        self._rollback_single_item(migration, item, source_ctx, target_ctx)
        self._refresh_status_after_manual_item_operations(migration)
        self._commit()
        self.db.refresh(migration)
        return migration

    def rollback_failed_items(self, migration_id: int) -> tuple[BucketMigration, int]:
        migration = self.get_migration(migration_id)
        self._ensure_manual_item_operation_allowed(migration)
        failed_items = [item for item in migration.items if item.status == "failed"]
        if not failed_items:
            raise ValueError("No failed bucket items to rollback")

        source_ctx = self._resolve_context(migration.source_context_id)
        target_ctx = self._resolve_context(migration.target_context_id)
        self._ensure_rollback_safe(migration, failed_items, source_ctx=source_ctx)
        for item in failed_items:
            self._rollback_single_item(migration, item, source_ctx, target_ctx)

        self._refresh_status_after_manual_item_operations(migration)
        self._commit()
        self.db.refresh(migration)
        return migration, len(failed_items)

    def rollback_failed_migration(self, migration_id: int) -> BucketMigration:
        migration = self.get_migration(migration_id)
        if migration.status not in {"failed", "completed_with_errors"}:
            raise ValueError("Rollback is only available for failed migrations")

        source_ctx = self._resolve_context(migration.source_context_id)
        target_ctx = self._resolve_context(migration.target_context_id)
        actionable_items = [item for item in migration.items if item.status != "skipped"]
        self._ensure_rollback_safe(migration, actionable_items, source_ctx=source_ctx)

        item_errors: list[str] = []
        total_purged_objects = 0
        rollback_started_at = utcnow()
        for item in migration.items:
            outcome = self._execute_item_rollback(
                item,
                source_ctx,
                target_ctx,
                purge_target=item.status != "skipped",
            )
            total_purged_objects += outcome.purged_objects
            item_error = self._finalize_item_rollback(
                migration,
                item,
                outcome,
                failure_message="Rollback failed for item.",
                success_message="Rollback completed for item.",
            )
            if item_error:
                item_errors.append(item_error)

        migration.pause_requested = False
        migration.cancel_requested = False
        migration.worker_lease_owner = None
        migration.worker_lease_until = None
        migration.updated_at = utcnow()
        migration.finished_at = rollback_started_at

        if item_errors:
            migration.status = "completed_with_errors"
            migration.error_message = _truncate_optional_db_text(
                f"Rollback completed with {len(item_errors)} error(s): " + " | ".join(item_errors[:3]),
                max_chars=_DB_ERROR_MESSAGE_MAX_CHARS,
            )
            self._add_event(
                migration,
                level="warning",
                message="Rollback completed with errors.",
                metadata={
                    "errors": len(item_errors),
                    "purged_objects": total_purged_objects,
                    "sample": item_errors[:3],
                },
            )
        else:
            migration.status = "rolled_back"
            migration.error_message = None
            self._add_event(
                migration,
                level="info",
                message="Rollback completed successfully.",
                metadata={"purged_objects": total_purged_objects},
            )

        self._recompute_counters(migration)
        self._commit()
        self.db.refresh(migration)
        return migration

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
