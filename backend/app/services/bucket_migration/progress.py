# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from ._shared import *
from .webhooks import get_bucket_migration_webhook_dispatcher


class BucketMigrationProgressMixin:
    def _renew_migration_lease(self, migration_id: int, *, worker_id: str, lease_seconds: int) -> bool:
        now = utcnow()
        lease_duration = max(15, int(lease_seconds))
        lease_until = now + timedelta(seconds=lease_duration)
        updated = (
            self.db.query(BucketMigration)
            .filter(
                BucketMigration.id == migration_id,
                BucketMigration.worker_lease_owner == worker_id,
                BucketMigration.status.in_(_RUNNABLE_MIGRATION_STATUSES),
            )
            .update(
                {
                    BucketMigration.worker_lease_until: lease_until,
                    BucketMigration.updated_at: now,
                },
                synchronize_session=False,
            )
        )
        if updated == 1:
            self._commit()
            return True
        self.db.rollback()
        return False

    def _release_migration_lease(self, migration_id: int, *, worker_id: Optional[str] = None) -> None:
        query = self.db.query(BucketMigration).filter(BucketMigration.id == migration_id)
        if worker_id:
            query = query.filter(BucketMigration.worker_lease_owner == worker_id)
        query.update(
            {
                BucketMigration.worker_lease_owner: None,
                BucketMigration.worker_lease_until: None,
            },
            synchronize_session=False,
        )

    def fail_migration_fatal(
        self,
        migration_id: int,
        *,
        error: Exception,
        worker_id: Optional[str] = None,
    ) -> None:
        try:
            migration = self.db.query(BucketMigration).filter(BucketMigration.id == migration_id).first()
            if not migration:
                return

            now = utcnow()
            if migration.status in _FINAL_MIGRATION_STATUSES:
                if worker_id and migration.worker_lease_owner == worker_id:
                    migration.worker_lease_owner = None
                    migration.worker_lease_until = None
                    migration.updated_at = now
                    self._commit()
                return

            error_text = str(error or "unknown fatal error").strip() or "unknown fatal error"
            migration.status = "failed"
            migration.pause_requested = False
            migration.cancel_requested = False
            migration.worker_lease_owner = None
            migration.worker_lease_until = None
            migration.error_message = _truncate_optional_db_text(
                f"Fatal migration worker error: {error_text}",
                max_chars=_DB_ERROR_MESSAGE_MAX_CHARS,
            )
            migration.finished_at = now
            migration.updated_at = now
            for item in migration.items:
                if item.status == "running":
                    item.status = "failed"
                    item.step = item.step or "unknown"
                    if not item.error_message:
                        item.error_message = "Migration stopped due to fatal worker error."
                    item.finished_at = now
                    item.updated_at = now

            self._add_event(
                migration,
                level="error",
                message="Migration failed due to fatal worker error.",
                metadata={"error": error_text},
            )
            self._recompute_counters(migration)
            self._commit()
        except Exception:  # noqa: BLE001
            self.db.rollback()
            logger.exception(
                "Unable to persist fatal migration failure state: migration=%s worker=%s",
                migration_id,
                worker_id,
            )

    def _control_state(
        self,
        migration_id: int,
        *,
        worker_id: Optional[str] = None,
        lease_seconds: Optional[int] = None,
    ) -> str:
        migration = self.get_migration(migration_id)
        if worker_id:
            if migration.worker_lease_owner != worker_id:
                return "lost_lease"
            effective_lease_seconds = max(15, int(lease_seconds or settings.bucket_migration_worker_lease_seconds))
            lease_until = migration.worker_lease_until
            refresh_window_seconds = max(5, effective_lease_seconds // 3)
            should_refresh = (
                lease_until is None
                or (lease_until - utcnow()).total_seconds() <= refresh_window_seconds
            )
            if should_refresh:
                if not self._renew_migration_lease(migration_id, worker_id=worker_id, lease_seconds=effective_lease_seconds):
                    return "lost_lease"
                migration = self.get_migration(migration_id)
        if migration.cancel_requested or migration.status == "cancel_requested":
            return "cancel"
        if migration.pause_requested or migration.status == "pause_requested":
            return "pause"
        return "run"

    def _mark_paused(self, migration: BucketMigration) -> None:
        migration.status = "paused"
        migration.pause_requested = False
        migration.worker_lease_owner = None
        migration.worker_lease_until = None
        migration.updated_at = utcnow()
        for item in migration.items:
            if item.status == "running":
                item.status = "paused"
                item.updated_at = utcnow()
        self._add_event(migration, level="info", message="Migration paused.")
        self._recompute_counters(migration)

    def _release_target_write_locks(
        self,
        migration: BucketMigration,
        target_ctx: Optional[_ResolvedContext],
        *,
        verify_restored: bool = False,
    ) -> list[str]:
        if not any(item.target_lock_applied or item.target_policy_backup_json for item in migration.items):
            return []
        if target_ctx is None:
            return ["target context is not available"]

        errors: list[str] = []
        for item in migration.items:
            if not (item.target_lock_applied or item.target_policy_backup_json):
                continue
            try:
                expected_policy = _json_loads(item.target_policy_backup_json)
                if item.target_policy_backup_json:
                    self._restore_target_write_lock_policy(target_ctx.account, item.target_bucket, item)
                else:
                    self._remove_managed_target_write_lock_statement(item.target_bucket, target_ctx.account)
                if verify_restored:
                    self._verify_restored_bucket_policy(
                        target_ctx.account,
                        item.target_bucket,
                        expected_policy,
                    )
                item.target_lock_applied = False
                item.target_policy_backup_json = None
                item.updated_at = utcnow()
                self._add_event(
                    migration,
                    item=item,
                    level="info",
                    message="Target write-lock policy released.",
                )
            except Exception as exc:  # noqa: BLE001
                errors.append(f"{item.target_bucket}: {exc}")
                self._add_event(
                    migration,
                    item=item,
                    level="warning",
                    message="Unable to release target write-lock policy.",
                    metadata={"error": str(exc)},
                )
        return errors

    def _release_source_read_only_policies(
        self,
        migration: BucketMigration,
        source_ctx: Optional[_ResolvedContext],
        *,
        verify_restored: bool = False,
    ) -> list[str]:
        if not any(item.read_only_applied or item.source_policy_backup_json for item in migration.items):
            return []
        if source_ctx is None:
            return ["source context is not available"]

        errors: list[str] = []
        for item in migration.items:
            if not (item.read_only_applied or item.source_policy_backup_json):
                continue
            try:
                expected_policy = _json_loads(item.source_policy_backup_json)
                if item.source_policy_backup_json:
                    self._restore_source_policy(item.source_bucket, source_ctx.account, item)
                else:
                    self._remove_managed_read_only_statement(item.source_bucket, source_ctx.account)
                if verify_restored:
                    self._verify_restored_bucket_policy(
                        source_ctx.account,
                        item.source_bucket,
                        expected_policy,
                    )
                item.read_only_applied = False
                item.source_policy_backup_json = None
                item.updated_at = utcnow()
                self._add_event(
                    migration,
                    item=item,
                    level="info",
                    message="Source read-only policy restored.",
                )
            except Exception as exc:  # noqa: BLE001
                errors.append(f"{item.source_bucket}: {exc}")
                self._add_event(
                    migration,
                    item=item,
                    level="warning",
                    message="Unable to restore source read-only policy.",
                    metadata={"error": str(exc)},
                )
        return errors

    def _verify_restored_bucket_policy(
        self,
        account: S3ExecutionTarget,
        bucket_name: str,
        expected_policy: Any,
    ) -> None:
        current_policy = self._buckets.get_policy(bucket_name, account)
        expected = expected_policy if isinstance(expected_policy, dict) else None
        current = current_policy if isinstance(current_policy, dict) else None
        if _json_dumps(expected) == _json_dumps(current):
            return
        expected_state = "present" if isinstance(expected, dict) else "absent"
        current_state = "present" if isinstance(current, dict) else "absent"
        raise RuntimeError(
            f"Policy verification mismatch after restore on bucket '{bucket_name}' "
            f"(expected={expected_state}, current={current_state})"
        )

    def _mark_canceled(
        self,
        migration: BucketMigration,
        *,
        source_ctx: Optional[_ResolvedContext] = None,
        target_ctx: Optional[_ResolvedContext] = None,
    ) -> None:
        migration.status = "canceled"
        migration.pause_requested = False
        migration.cancel_requested = False
        migration.worker_lease_owner = None
        migration.worker_lease_until = None
        migration.finished_at = utcnow()
        migration.updated_at = utcnow()
        for item in migration.items:
            if item.status in {"pending", "running", "paused", "awaiting_cutover"}:
                item.status = "canceled"
                item.finished_at = utcnow()
                item.updated_at = utcnow()
        source_release_errors = self._release_source_read_only_policies(migration, source_ctx, verify_restored=True)
        target_release_errors = self._release_target_write_locks(migration, target_ctx, verify_restored=True)
        release_errors = source_release_errors + target_release_errors
        if release_errors:
            migration.error_message = _truncate_optional_db_text(
                f"Migration canceled, but {len(release_errors)} authorization restore error(s): "
                + " | ".join(release_errors[:3]),
                max_chars=_DB_ERROR_MESSAGE_MAX_CHARS,
            )
        else:
            migration.error_message = None
        self._add_event(migration, level="info", message="Migration canceled.")
        self._recompute_counters(migration)

    def _finalize_or_wait_cutover(
        self,
        migration: BucketMigration,
        *,
        source_ctx: Optional[_ResolvedContext] = None,
        target_ctx: Optional[_ResolvedContext] = None,
    ) -> None:
        self._recompute_counters(migration)
        if migration.cancel_requested or migration.status == "cancel_requested":
            self._mark_canceled(migration, source_ctx=source_ctx, target_ctx=target_ctx)
            return

        total_actionable = len([item for item in migration.items if item.status not in {"skipped"}])
        awaiting_count = len([item for item in migration.items if item.status == "awaiting_cutover"])
        pending_count = len([item for item in migration.items if item.status in {"pending", "running", "paused"}])

        if migration.mode == "pre_sync" and total_actionable > 0 and awaiting_count == total_actionable:
            migration.status = "awaiting_cutover"
            migration.worker_lease_owner = None
            migration.worker_lease_until = None
            migration.updated_at = utcnow()
            self._add_event(migration, level="info", message="All items pre-synced; waiting for cutover.")
            return

        if pending_count > 0:
            migration.status = "running"
            migration.updated_at = utcnow()
            return

        if migration.failed_items > 0:
            migration.status = "completed_with_errors"
        else:
            migration.status = "completed"
        migration.worker_lease_owner = None
        migration.worker_lease_until = None
        migration.finished_at = utcnow()
        migration.updated_at = utcnow()
        release_errors = self._release_target_write_locks(migration, target_ctx)
        if release_errors:
            if migration.status == "completed":
                migration.status = "completed_with_errors"
            migration.error_message = _truncate_optional_db_text(
                f"Migration finished with {len(release_errors)} target lock cleanup error(s): "
                + " | ".join(release_errors[:3]),
                max_chars=_DB_ERROR_MESSAGE_MAX_CHARS,
            )
        self._add_event(migration, level="info", message=f"Migration finished with status '{migration.status}'.")

    def _recompute_counters(self, migration: BucketMigration) -> None:
        completed = 0
        failed = 0
        skipped = 0
        awaiting = 0
        for item in migration.items:
            if item.status in {"completed", "rolled_back"}:
                completed += 1
            elif item.status == "failed":
                failed += 1
            elif item.status == "skipped":
                skipped += 1
            elif item.status == "awaiting_cutover":
                awaiting += 1
        migration.total_items = len(migration.items)
        migration.completed_items = completed
        migration.failed_items = failed
        migration.skipped_items = skipped
        migration.awaiting_items = awaiting

    def _add_event(
        self,
        migration: BucketMigration,
        *,
        item: Optional[BucketMigrationItem] = None,
        level: str,
        message: str,
        metadata: Optional[dict[str, Any]] = None,
    ) -> None:
        safe_message = _truncate_db_text(message, max_chars=_DB_EVENT_MESSAGE_MAX_CHARS)
        safe_metadata: Optional[dict[str, Any]] = None
        if metadata is not None:
            normalized_metadata = _sanitize_event_metadata(metadata)
            if isinstance(normalized_metadata, dict):
                safe_metadata = normalized_metadata
            else:
                safe_metadata = {"value": normalized_metadata}
        created_at = utcnow()
        entry = BucketMigrationEvent(
            migration_id=migration.id,
            item_id=item.id if item else None,
            level=level,
            message=safe_message,
            metadata_json=_serialize_event_metadata(safe_metadata),
            created_at=created_at,
        )
        self.db.add(entry)
        self._enqueue_migration_webhook(
            migration,
            item=item,
            level=level,
            message=safe_message,
            metadata=safe_metadata,
            created_at=created_at,
        )

    def _enqueue_migration_webhook(
        self,
        migration: BucketMigration,
        *,
        item: Optional[BucketMigrationItem],
        level: str,
        message: str,
        metadata: Optional[dict[str, Any]],
        created_at: Any,
    ) -> None:
        webhook_url = (migration.webhook_url or "").strip()
        if not webhook_url:
            return

        payload = self._build_migration_webhook_payload(
            migration,
            item=item,
            level=level,
            message=message,
            metadata=metadata,
            created_at=created_at,
        )
        try:
            self._validate_configured_webhook_url(webhook_url)
        except ValueError as exc:
            logger.warning(
                "Bucket migration webhook target rejected by security policy: migration=%s item=%s error=%s",
                migration.id,
                item.id if item else None,
                exc,
            )
            return

        dispatcher = get_bucket_migration_webhook_dispatcher()
        enqueued = dispatcher.enqueue(
            webhook_url=webhook_url,
            payload=payload,
            migration_id=int(migration.id),
            item_id=int(item.id) if item else None,
        )
        if not enqueued:
            logger.warning(
                "Bucket migration webhook dropped because dispatch queue is full: migration=%s item=%s",
                migration.id,
                item.id if item else None,
            )

    def _build_migration_webhook_payload(
        self,
        migration: BucketMigration,
        *,
        item: Optional[BucketMigrationItem],
        level: str,
        message: str,
        metadata: Optional[dict[str, Any]],
        created_at: Any,
    ) -> dict[str, Any]:
        safe_metadata: Optional[dict[str, Any]] = None
        if metadata is not None:
            normalized_metadata = _json_loads(_json_dumps(metadata))
            if isinstance(normalized_metadata, dict):
                safe_metadata = normalized_metadata
            else:
                safe_metadata = {"value": normalized_metadata}

        created_iso = created_at.isoformat() if hasattr(created_at, "isoformat") else str(created_at)

        payload: dict[str, Any] = {
            "type": "bucket_migration.event",
            "occurred_at": created_iso,
            "migration": {
                "id": migration.id,
                "status": migration.status,
                "mode": migration.mode,
                "source_context_id": migration.source_context_id,
                "target_context_id": migration.target_context_id,
                "copy_bucket_settings": bool(migration.copy_bucket_settings),
                "delete_source": bool(migration.delete_source),
                "strong_integrity_check": bool(getattr(migration, "strong_integrity_check", False)),
                "lock_target_writes": bool(migration.lock_target_writes),
                "use_same_endpoint_copy": bool(migration.use_same_endpoint_copy),
                "auto_grant_source_read_for_copy": bool(migration.auto_grant_source_read_for_copy),
                "parallelism_max": int(migration.parallelism_max or 1),
                "total_items": int(migration.total_items or 0),
                "completed_items": int(migration.completed_items or 0),
                "failed_items": int(migration.failed_items or 0),
                "skipped_items": int(migration.skipped_items or 0),
                "awaiting_items": int(migration.awaiting_items or 0),
            },
            "event": {
                "level": level,
                "message": message,
                "metadata": safe_metadata,
            },
            "item": None,
        }
        if item is not None:
            payload["item"] = {
                "id": item.id,
                "source_bucket": item.source_bucket,
                "target_bucket": item.target_bucket,
                "status": item.status,
                "step": item.step,
                "objects_copied": int(item.objects_copied or 0),
                "objects_deleted": int(item.objects_deleted or 0),
                "error_message": item.error_message,
            }
        return payload
