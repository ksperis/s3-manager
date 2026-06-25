# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from ._shared import *


class BucketMigrationPlanningMixin:
    def _build_bucket_mappings(self, payload: BucketMigrationCreateRequest) -> list[tuple[str, str]]:
        mappings: list[tuple[str, str]] = []
        seen_targets: set[str] = set()
        for entry in payload.buckets:
            source_bucket = (entry.source_bucket or "").strip()
            target_bucket = ((entry.target_bucket or "").strip() or f"{payload.mapping_prefix}{source_bucket}").strip()
            if not source_bucket:
                raise ValueError("source bucket is required")
            if not target_bucket:
                raise ValueError(f"target bucket is required for source '{source_bucket}'")
            if target_bucket in seen_targets:
                raise ValueError(f"Duplicate target bucket mapping: {target_bucket}")
            seen_targets.add(target_bucket)
            mappings.append((source_bucket, target_bucket))
        return mappings

    def _resolve_same_endpoint_copy_options(
        self,
        payload: BucketMigrationCreateRequest,
        *,
        same_endpoint: bool,
    ) -> tuple[bool, bool]:
        use_same_endpoint_copy = bool(payload.use_same_endpoint_copy)
        explicit_auto_grant = payload.auto_grant_source_read_for_copy

        if use_same_endpoint_copy and not same_endpoint:
            raise ValueError(
                "x-amz-copy-source can only be enabled when source and target contexts use the same endpoint"
            )
        if not use_same_endpoint_copy and explicit_auto_grant is True:
            raise ValueError(
                "auto_grant_source_read_for_copy cannot be enabled when use_same_endpoint_copy is disabled"
            )

        if explicit_auto_grant is None:
            auto_grant_source_read_for_copy = use_same_endpoint_copy
        else:
            auto_grant_source_read_for_copy = bool(explicit_auto_grant)

        if not use_same_endpoint_copy:
            auto_grant_source_read_for_copy = False

        return use_same_endpoint_copy, auto_grant_source_read_for_copy

    def create_migration(self, payload: BucketMigrationCreateRequest, user: User) -> BucketMigration:
        mappings = self._build_bucket_mappings(payload)
        self._assert_context_authorized_for_mutation(payload.source_context_id)
        self._assert_context_authorized_for_mutation(payload.target_context_id)
        self._assert_cross_account_admin_contexts(payload.source_context_id, payload.target_context_id)

        webhook_url = (payload.webhook_url or "").strip() or None
        if webhook_url:
            self._validate_configured_webhook_url(webhook_url)

        source_ctx = self._resolve_context(payload.source_context_id)
        target_ctx = self._resolve_context(payload.target_context_id)
        if not source_ctx.endpoint:
            raise ValueError("Source context endpoint is not configured")
        if not target_ctx.endpoint:
            raise ValueError("Target context endpoint is not configured")
        same_endpoint = self._is_same_endpoint(source_ctx, target_ctx)
        if same_endpoint:
            for source_bucket, target_bucket in mappings:
                if source_bucket == target_bucket:
                    raise ValueError(
                        "When source and target contexts use the same endpoint, "
                        "target bucket must differ from source bucket. "
                        "Use a prefix or explicit mapping override."
                    )
        use_same_endpoint_copy, auto_grant_source_read_for_copy = self._resolve_same_endpoint_copy_options(
            payload,
            same_endpoint=same_endpoint,
        )

        limits = self._load_runtime_limits()
        requested_parallelism = (
            int(payload.parallelism_max)
            if payload.parallelism_max is not None
            else int(limits.parallelism_default)
        )
        parallelism = max(1, min(requested_parallelism, int(limits.parallelism_max)))

        migration = BucketMigration(
            created_by_user_id=user.id,
            source_context_id=payload.source_context_id,
            target_context_id=payload.target_context_id,
            mode=payload.mode,
            copy_bucket_settings=bool(payload.copy_bucket_settings),
            delete_source=bool(payload.delete_source),
            strong_integrity_check=bool(payload.strong_integrity_check),
            lock_target_writes=bool(payload.lock_target_writes),
            use_same_endpoint_copy=use_same_endpoint_copy,
            auto_grant_source_read_for_copy=auto_grant_source_read_for_copy,
            webhook_url=webhook_url,
            mapping_prefix=payload.mapping_prefix or None,
            status="draft",
            precheck_status="pending",
            precheck_report_json=None,
            precheck_checked_at=None,
            parallelism_max=parallelism,
            total_items=len(mappings),
            completed_items=0,
            failed_items=0,
            skipped_items=0,
            awaiting_items=0,
            created_at=utcnow(),
            updated_at=utcnow(),
        )
        self.db.add(migration)
        self.db.flush()

        for source_bucket, target_bucket in mappings:
            self.db.add(
                BucketMigrationItem(
                    migration_id=migration.id,
                    source_bucket=source_bucket,
                    target_bucket=target_bucket,
                    status="pending",
                    step="create_bucket",
                    source_snapshot_json=None,
                    target_snapshot_json=None,
                    execution_plan_json=None,
                    replication_state_json=None,
                    created_at=utcnow(),
                    updated_at=utcnow(),
                )
            )

        self._add_event(
            migration,
            level="info",
            message="Migration created.",
            metadata={
                "source_context_id": payload.source_context_id,
                "target_context_id": payload.target_context_id,
                "mode": payload.mode,
                "copy_bucket_settings": bool(payload.copy_bucket_settings),
                "delete_source": bool(payload.delete_source),
                "strong_integrity_check": bool(payload.strong_integrity_check),
                "lock_target_writes": bool(payload.lock_target_writes),
                "use_same_endpoint_copy": use_same_endpoint_copy,
                "auto_grant_source_read_for_copy": auto_grant_source_read_for_copy,
                "webhook_enabled": bool(payload.webhook_url),
                "parallelism_max": parallelism,
                "items": len(mappings),
            },
        )
        self._commit()
        self.db.refresh(migration)
        return migration

    def update_draft_migration(self, migration_id: int, payload: BucketMigrationCreateRequest) -> BucketMigration:
        migration = self.get_migration(migration_id)
        if migration.status != "draft":
            raise ValueError("Only draft migrations can be updated")

        mappings = self._build_bucket_mappings(payload)
        self._assert_context_authorized_for_mutation(payload.source_context_id)
        self._assert_context_authorized_for_mutation(payload.target_context_id)
        self._assert_cross_account_admin_contexts(payload.source_context_id, payload.target_context_id)

        webhook_url = (payload.webhook_url or "").strip() or None
        if webhook_url:
            self._validate_configured_webhook_url(webhook_url)

        source_ctx = self._resolve_context(payload.source_context_id)
        target_ctx = self._resolve_context(payload.target_context_id)
        if not source_ctx.endpoint:
            raise ValueError("Source context endpoint is not configured")
        if not target_ctx.endpoint:
            raise ValueError("Target context endpoint is not configured")
        same_endpoint = self._is_same_endpoint(source_ctx, target_ctx)
        if same_endpoint:
            for source_bucket, target_bucket in mappings:
                if source_bucket == target_bucket:
                    raise ValueError(
                        "When source and target contexts use the same endpoint, "
                        "target bucket must differ from source bucket. "
                        "Use a prefix or explicit mapping override."
                    )
        use_same_endpoint_copy, auto_grant_source_read_for_copy = self._resolve_same_endpoint_copy_options(
            payload,
            same_endpoint=same_endpoint,
        )

        limits = self._load_runtime_limits()
        requested_parallelism = (
            int(payload.parallelism_max)
            if payload.parallelism_max is not None
            else int(limits.parallelism_default)
        )
        parallelism = max(1, min(requested_parallelism, int(limits.parallelism_max)))

        migration.source_context_id = payload.source_context_id
        migration.target_context_id = payload.target_context_id
        migration.mode = payload.mode
        migration.copy_bucket_settings = bool(payload.copy_bucket_settings)
        migration.delete_source = bool(payload.delete_source)
        migration.strong_integrity_check = bool(payload.strong_integrity_check)
        migration.lock_target_writes = bool(payload.lock_target_writes)
        migration.use_same_endpoint_copy = use_same_endpoint_copy
        migration.auto_grant_source_read_for_copy = auto_grant_source_read_for_copy
        migration.webhook_url = webhook_url
        migration.mapping_prefix = payload.mapping_prefix or None
        migration.parallelism_max = parallelism
        migration.status = "draft"
        migration.pause_requested = False
        migration.cancel_requested = False
        migration.worker_lease_owner = None
        migration.worker_lease_until = None
        migration.precheck_status = "pending"
        migration.precheck_report_json = None
        migration.precheck_checked_at = None
        migration.error_message = None
        migration.started_at = None
        migration.finished_at = None
        migration.last_heartbeat_at = None
        migration.updated_at = utcnow()

        item_by_source = {item.source_bucket: item for item in migration.items}
        mapping_by_source = {source_bucket: target_bucket for source_bucket, target_bucket in mappings}

        for source_bucket in list(item_by_source.keys()):
            if source_bucket not in mapping_by_source:
                self.db.delete(item_by_source[source_bucket])

        now = utcnow()
        for source_bucket, target_bucket in mappings:
            item = item_by_source.get(source_bucket)
            if item is None:
                self.db.add(
                    BucketMigrationItem(
                        migration_id=migration.id,
                        source_bucket=source_bucket,
                        target_bucket=target_bucket,
                        status="pending",
                        step="create_bucket",
                        source_snapshot_json=None,
                        target_snapshot_json=None,
                        execution_plan_json=None,
                        replication_state_json=None,
                        created_at=now,
                        updated_at=now,
                    )
                )
                continue

            item.target_bucket = target_bucket
            item.status = "pending"
            item.step = "create_bucket"
            item.pre_sync_done = False
            item.read_only_applied = False
            item.target_lock_applied = False
            item.target_bucket_exists = False
            item.objects_copied = 0
            item.objects_deleted = 0
            item.source_count = None
            item.target_count = None
            item.matched_count = None
            item.different_count = None
            item.only_source_count = None
            item.only_target_count = None
            item.diff_sample_json = None
            item.source_snapshot_json = None
            item.target_snapshot_json = None
            item.execution_plan_json = None
            item.replication_state_json = None
            item.source_policy_backup_json = None
            item.target_policy_backup_json = None
            item.error_message = None
            item.started_at = None
            item.finished_at = None
            item.updated_at = now

        self.db.flush()
        self.db.refresh(migration)
        self._recompute_counters(migration)
        migration.updated_at = utcnow()

        self._add_event(
            migration,
            level="info",
            message="Migration configuration updated.",
            metadata={
                "source_context_id": payload.source_context_id,
                "target_context_id": payload.target_context_id,
                "mode": payload.mode,
                "copy_bucket_settings": bool(payload.copy_bucket_settings),
                "delete_source": bool(payload.delete_source),
                "strong_integrity_check": bool(payload.strong_integrity_check),
                "lock_target_writes": bool(payload.lock_target_writes),
                "use_same_endpoint_copy": use_same_endpoint_copy,
                "auto_grant_source_read_for_copy": auto_grant_source_read_for_copy,
                "webhook_enabled": bool(payload.webhook_url),
                "parallelism_max": parallelism,
                "items": len(mappings),
            },
        )
        self._commit()
        self.db.refresh(migration)
        return migration

    def list_migrations(self, limit: int = 100, *, context_id: Optional[str] = None) -> list[BucketMigration]:
        if self._authorized_context_ids is not None and not self._authorized_context_ids:
            return []
        query = self.db.query(BucketMigration)
        if self._authorized_context_ids is not None:
            query = query.filter(
                BucketMigration.source_context_id.in_(self._authorized_context_ids),
                BucketMigration.target_context_id.in_(self._authorized_context_ids),
            )
        normalized_context_id = (context_id or "").strip()
        if normalized_context_id:
            if self._authorized_context_ids is not None and normalized_context_id not in self._authorized_context_ids:
                return []
            query = query.filter(
                or_(
                    BucketMigration.source_context_id == normalized_context_id,
                    BucketMigration.target_context_id == normalized_context_id,
                )
            )
        return query.order_by(BucketMigration.created_at.desc()).limit(max(1, min(int(limit), 500))).all()

    def get_migration(self, migration_id: int) -> BucketMigration:
        query = self.db.query(BucketMigration).filter(BucketMigration.id == migration_id)
        if self._authorized_context_ids is not None:
            if not self._authorized_context_ids:
                raise ValueError("Migration not found")
            query = query.filter(
                BucketMigration.source_context_id.in_(self._authorized_context_ids),
                BucketMigration.target_context_id.in_(self._authorized_context_ids),
            )
        migration = query.first()
        if not migration:
            raise ValueError("Migration not found")
        return migration

    def list_migration_items(self, migration_id: int) -> list[BucketMigrationItem]:
        migration = self.get_migration(migration_id)
        return (
            self.db.query(BucketMigrationItem)
            .filter(BucketMigrationItem.migration_id == migration.id)
            .order_by(BucketMigrationItem.id.asc())
            .all()
        )

    def list_recent_migration_events(self, migration_id: int, *, limit: int) -> list[BucketMigrationEvent]:
        migration = self.get_migration(migration_id)
        safe_limit = max(1, min(int(limit), 1000))
        return (
            self.db.query(BucketMigrationEvent)
            .filter(BucketMigrationEvent.migration_id == migration.id)
            .order_by(BucketMigrationEvent.created_at.desc(), BucketMigrationEvent.id.desc())
            .limit(safe_limit)
            .all()
        )

    def delete_migration(self, migration_id: int) -> None:
        migration = self.get_migration(migration_id)
        if migration.status not in {*_FINAL_MIGRATION_STATUSES, "draft"}:
            raise ValueError("Migration can only be deleted from a final status or from draft")
        self.db.delete(migration)
        self._commit()

    def run_precheck(self, migration_id: int) -> BucketMigration:
        migration = self.get_migration(migration_id)
        self._assert_cross_account_admin_contexts(migration.source_context_id, migration.target_context_id)
        if migration.status in {"running", "queued", "pause_requested", "cancel_requested"}:
            raise ValueError("Precheck cannot run while migration is active")

        checked_at = utcnow()
        report = self._precheck_planner.run(migration, checked_at=checked_at)
        errors = int(report.get("errors") or 0)
        warnings = int(report.get("warnings") or 0)

        migration.precheck_status = "failed" if errors > 0 else "passed"
        migration.precheck_report_json = _json_dumps(report)
        migration.precheck_checked_at = checked_at
        migration.updated_at = checked_at
        if errors > 0:
            self._add_event(
                migration,
                level="warning",
                message="Precheck failed.",
                metadata={"errors": errors, "warnings": warnings},
            )
        else:
            self._add_event(
                migration,
                level="info",
                message="Precheck passed.",
                metadata={"errors": 0, "warnings": warnings},
            )
        self._commit()
        self.db.refresh(migration)
        return migration

    def start_migration(self, migration_id: int) -> BucketMigration:
        migration = self.get_migration(migration_id)
        self._assert_cross_account_admin_contexts(migration.source_context_id, migration.target_context_id)
        if migration.status not in {"draft", "paused"}:
            raise ValueError("Migration cannot be started from current status")
        if migration.precheck_status != "passed":
            raise ValueError("Precheck must pass before start. Run /precheck first.")
        for item in migration.items:
            try:
                self._assert_item_execution_plan_supported(item)
            except RuntimeError as exc:
                raise ValueError(
                    "Precheck must be re-run before start. "
                    f"Item '{item.source_bucket}' -> '{item.target_bucket}' is not runnable: {exc}"
                ) from exc
        migration.status = "queued"
        migration.pause_requested = False
        migration.cancel_requested = False
        migration.worker_lease_owner = None
        migration.worker_lease_until = None
        migration.error_message = None
        migration.updated_at = utcnow()
        if migration.started_at is None:
            migration.started_at = utcnow()
        for item in migration.items:
            if item.status == "paused":
                item.status = "pending"
            if item.status == "awaiting_cutover" and migration.mode != "pre_sync":
                item.status = "pending"
                item.step = "apply_read_only"
            item.updated_at = utcnow()
        self._add_event(migration, level="info", message="Migration queued.")
        self._commit()
        self.db.refresh(migration)
        return migration

    def request_pause(self, migration_id: int) -> BucketMigration:
        migration = self.get_migration(migration_id)
        if migration.status not in {"queued", "running", "pause_requested"}:
            raise ValueError("Pause is only available while migration is queued or running")
        migration.pause_requested = True
        migration.status = "pause_requested"
        migration.updated_at = utcnow()
        self._add_event(migration, level="info", message="Pause requested.")
        self._commit()
        self.db.refresh(migration)
        return migration

    def resume_migration(self, migration_id: int) -> BucketMigration:
        migration = self.get_migration(migration_id)
        if migration.status not in {"paused"}:
            raise ValueError("Resume is only available from paused status")
        migration.pause_requested = False
        migration.cancel_requested = False
        migration.status = "queued"
        migration.worker_lease_owner = None
        migration.worker_lease_until = None
        migration.updated_at = utcnow()
        for item in migration.items:
            if item.status == "paused":
                item.status = "pending"
                item.updated_at = utcnow()
        self._add_event(migration, level="info", message="Migration resumed.")
        self._commit()
        self.db.refresh(migration)
        return migration

    def stop_migration(self, migration_id: int) -> BucketMigration:
        migration = self.get_migration(migration_id)
        if migration.status in {"completed", "completed_with_errors", "failed", "canceled", "rolled_back"}:
            raise ValueError("Migration is already finished")
        if migration.status in {"paused", "awaiting_cutover", "draft"}:
            source_ctx: Optional[_ResolvedContext] = None
            target_ctx: Optional[_ResolvedContext] = None
            needs_source_cleanup = any(item.read_only_applied or item.source_policy_backup_json for item in migration.items)
            needs_target_cleanup = any(item.target_lock_applied or item.target_policy_backup_json for item in migration.items)
            if needs_source_cleanup:
                try:
                    source_ctx = self._resolve_context(migration.source_context_id)
                except Exception as exc:  # noqa: BLE001
                    self._add_event(
                        migration,
                        level="warning",
                        message="Unable to resolve source context while stopping migration; source policy cleanup was skipped.",
                        metadata={"error": str(exc)},
                    )
            if needs_target_cleanup:
                try:
                    target_ctx = self._resolve_context(migration.target_context_id)
                except Exception as exc:  # noqa: BLE001
                    self._add_event(
                        migration,
                        level="warning",
                        message="Unable to resolve target context while stopping migration; target lock cleanup was skipped.",
                        metadata={"error": str(exc)},
                    )
            self._mark_canceled(migration, source_ctx=source_ctx, target_ctx=target_ctx)
        else:
            migration.cancel_requested = True
            migration.status = "cancel_requested"
        migration.updated_at = utcnow()
        self._add_event(migration, level="info", message="Stop requested.")
        self._commit()
        self.db.refresh(migration)
        return migration

    def continue_after_presync(self, migration_id: int) -> BucketMigration:
        migration = self.get_migration(migration_id)
        if migration.status != "awaiting_cutover":
            raise ValueError("Continue is only available when migration is awaiting cutover")
        migration.status = "queued"
        migration.pause_requested = False
        migration.cancel_requested = False
        migration.worker_lease_owner = None
        migration.worker_lease_until = None
        migration.updated_at = utcnow()
        for item in migration.items:
            if item.status == "awaiting_cutover":
                item.status = "pending"
                item.step = "apply_read_only"
                item.updated_at = utcnow()
        self._add_event(migration, level="info", message="Cutover requested after pre-sync.")
        self._commit()
        self.db.refresh(migration)
        return migration

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

            if item.status != "skipped":
                try:
                    purged_current, purged_versions = self._purge_target_bucket(target_ctx, item.target_bucket)
                    purged_count = purged_current + purged_versions
                    total_purged_objects += purged_count
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
                    message="Rollback failed for item.",
                    metadata={"issues": rollback_issues},
                )
                item_errors.append(
                    _truncate_db_text(
                        f"{item.source_bucket}: {'; '.join(rollback_issues)}",
                        max_chars=_DB_ERROR_MESSAGE_MAX_CHARS,
                    )
                )
                continue

            item.status = "rolled_back"
            item.step = "rolled_back"
            item.error_message = None
            item.finished_at = utcnow()
            item.updated_at = utcnow()
            self._add_event(
                migration,
                item=item,
                level="info",
                message="Rollback completed for item.",
                metadata={"target_bucket": item.target_bucket},
            )

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

    def claim_next_runnable_migration_id(self, *, worker_id: str, lease_seconds: int) -> Optional[int]:
        if not worker_id:
            raise ValueError("worker_id is required to claim a migration lease")
        now = utcnow()
        lease_duration = max(15, int(lease_seconds))
        lease_until = now + timedelta(seconds=lease_duration)
        limits = self._load_runtime_limits()
        max_active_per_endpoint = max(1, int(limits.max_active_per_endpoint))
        endpoint_usage = self._active_endpoint_usage(now=now)
        endpoint_cache: dict[str, str] = {}
        candidate_rows = [
            row
            for row in (
                self.db.query(
                    BucketMigration.id,
                    BucketMigration.source_context_id,
                    BucketMigration.target_context_id,
                )
                .filter(
                    BucketMigration.status.in_(_RUNNABLE_MIGRATION_STATUSES),
                    or_(
                        BucketMigration.worker_lease_until.is_(None),
                        BucketMigration.worker_lease_until < now,
                    ),
                )
                .order_by(BucketMigration.created_at.asc())
                .limit(50)
                .all()
            )
        ]
        for row in candidate_rows:
            migration_id = int(row.id)
            endpoint_keys = self._endpoint_keys_for_contexts(
                row.source_context_id,
                row.target_context_id,
                cache=endpoint_cache,
            )
            if any(endpoint_usage.get(key, 0) >= max_active_per_endpoint for key in endpoint_keys):
                continue
            updated = (
                self.db.query(BucketMigration)
                .filter(
                    BucketMigration.id == migration_id,
                    BucketMigration.status.in_(_RUNNABLE_MIGRATION_STATUSES),
                    or_(
                        BucketMigration.worker_lease_until.is_(None),
                        BucketMigration.worker_lease_until < now,
                    ),
                )
                .update(
                    {
                        BucketMigration.worker_lease_owner: worker_id,
                        BucketMigration.worker_lease_until: lease_until,
                        BucketMigration.updated_at: now,
                    },
                    synchronize_session=False,
                )
            )
            if updated == 1:
                self._commit()
                if self._claimed_migration_within_endpoint_limit(
                    migration_id,
                    endpoint_keys=endpoint_keys,
                    max_active_per_endpoint=max_active_per_endpoint,
                    now=utcnow(),
                    cache=endpoint_cache,
                ):
                    return migration_id
                logger.info(
                    "Bucket migration claim released after endpoint limit recheck: migration=%s worker=%s",
                    migration_id,
                    worker_id,
                )
                self._release_migration_lease(migration_id, worker_id=worker_id)
                self._commit()
                endpoint_usage = self._active_endpoint_usage(now=utcnow())
                continue
            self.db.rollback()
        return None

    def find_next_runnable_migration_id(self) -> Optional[int]:
        now = utcnow()
        row = (
            self.db.query(BucketMigration)
            .filter(
                BucketMigration.status.in_(_RUNNABLE_MIGRATION_STATUSES),
                or_(
                    BucketMigration.worker_lease_until.is_(None),
                    BucketMigration.worker_lease_until < now,
                ),
            )
            .order_by(BucketMigration.created_at.asc())
            .first()
        )
        return int(row.id) if row else None
