# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from ._shared import *


class BucketMigrationExecutionControlMixin:
    def run_migration(
        self,
        migration_id: int,
        *,
        worker_id: Optional[str] = None,
        lease_seconds: Optional[int] = None,
    ) -> None:
        effective_lease_seconds = max(15, int(lease_seconds or settings.bucket_migration_worker_lease_seconds))
        migration = self.get_migration(migration_id)
        self._assert_migration_creator_access(migration)

        if worker_id:
            if migration.worker_lease_owner != worker_id:
                return
            if not self._renew_migration_lease(migration.id, worker_id=worker_id, lease_seconds=effective_lease_seconds):
                return
            migration = self.get_migration(migration_id)

        if migration.status in {"completed", "completed_with_errors", "failed", "canceled", "rolled_back", "awaiting_cutover"}:
            if worker_id and migration.worker_lease_owner == worker_id:
                migration.worker_lease_owner = None
                migration.worker_lease_until = None
                self._commit()
            return

        if migration.status in _RUNNABLE_MIGRATION_STATUSES:
            migration.status = "running" if migration.status not in {"pause_requested", "cancel_requested"} else migration.status
            if migration.started_at is None:
                migration.started_at = utcnow()
            migration.updated_at = utcnow()
            migration.last_heartbeat_at = utcnow()
            self._commit()

        source_ctx = self._resolve_context(migration.source_context_id)
        target_ctx = self._resolve_context(migration.target_context_id)
        def control_check():
            current = self.get_migration(migration.id)
            self._assert_migration_creator_access(current)
            return self._control_state(
                migration.id,
                worker_id=worker_id,
                lease_seconds=effective_lease_seconds,
            )

        for item in migration.items:
            self.db.refresh(migration)
            self._assert_migration_creator_access(migration)
            state = control_check()
            if state == "lost_lease":
                return
            if state == "cancel":
                self._mark_canceled(migration, source_ctx=source_ctx, target_ctx=target_ctx)
                self._commit()
                return
            if state == "pause":
                self._mark_paused(migration)
                self._commit()
                return

            if item.status in {"completed", "rolled_back", "skipped", "failed", "canceled"}:
                continue
            if migration.mode == "pre_sync" and migration.status == "awaiting_cutover":
                if worker_id and migration.worker_lease_owner == worker_id:
                    migration.worker_lease_owner = None
                    migration.worker_lease_until = None
                    self._commit()
                return

            try:
                item.status = "running"
                if item.started_at is None:
                    item.started_at = utcnow()
                item.updated_at = utcnow()
                self._commit()
                self._run_item(migration, item, source_ctx, target_ctx, control_check=control_check)
            except _WorkerLeaseLostError:
                self.db.rollback()
                return
            except Exception as exc:  # noqa: BLE001
                logger.exception("Bucket migration item failed: migration=%s item=%s", migration.id, item.id)
                self.db.rollback()
                migration = self.get_migration(migration.id)
                failed_item = self.db.query(BucketMigrationItem).filter(BucketMigrationItem.id == item.id).first()
                if failed_item is None:
                    continue
                failed_item.status = "failed"
                failed_item.error_message = _truncate_optional_db_text(
                    str(exc),
                    max_chars=_DB_ERROR_MESSAGE_MAX_CHARS,
                )
                failed_item.finished_at = utcnow()
                failed_item.updated_at = utcnow()
                self._add_event(
                    migration,
                    item=failed_item,
                    level="error",
                    message="Item failed.",
                    metadata={"error": str(exc), "step": failed_item.step},
                )
                self._commit()

        self.db.refresh(migration)
        self._finalize_or_wait_cutover(migration, source_ctx=source_ctx, target_ctx=target_ctx)
        if worker_id and migration.worker_lease_owner == worker_id and migration.status not in _RUNNABLE_MIGRATION_STATUSES:
            migration.worker_lease_owner = None
            migration.worker_lease_until = None
        self._commit()

    def _active_endpoint_usage(self, *, now) -> dict[str, int]:
        usage: dict[str, int] = {}
        cache: dict[str, str] = {}
        rows = (
            self.db.query(BucketMigration.source_context_id, BucketMigration.target_context_id)
            .filter(
                BucketMigration.status.in_(_RUNNABLE_MIGRATION_STATUSES),
                BucketMigration.worker_lease_until.isnot(None),
                BucketMigration.worker_lease_until >= now,
            )
            .all()
        )
        for row in rows:
            for key in self._endpoint_keys_for_contexts(
                row.source_context_id,
                row.target_context_id,
                cache=cache,
            ):
                usage[key] = usage.get(key, 0) + 1
        return usage

    def _claimed_migration_within_endpoint_limit(
        self,
        migration_id: int,
        *,
        endpoint_keys: set[str],
        max_active_per_endpoint: int,
        now,
        cache: dict[str, str],
    ) -> bool:
        if not endpoint_keys:
            return True
        allowed_per_endpoint = max(1, int(max_active_per_endpoint))
        rows = (
            self.db.query(
                BucketMigration.id,
                BucketMigration.source_context_id,
                BucketMigration.target_context_id,
            )
            .filter(
                BucketMigration.status.in_(_RUNNABLE_MIGRATION_STATUSES),
                BucketMigration.worker_lease_until.isnot(None),
                BucketMigration.worker_lease_until >= now,
            )
            .order_by(BucketMigration.created_at.asc(), BucketMigration.id.asc())
            .all()
        )
        ranked_by_endpoint: dict[str, list[int]] = {}
        for row in rows:
            row_keys = self._endpoint_keys_for_contexts(
                row.source_context_id,
                row.target_context_id,
                cache=cache,
            )
            for key in row_keys:
                ranked_by_endpoint.setdefault(key, []).append(int(row.id))
        for key in endpoint_keys:
            ranked_ids = ranked_by_endpoint.get(key, [])
            if migration_id not in ranked_ids:
                return False
            if ranked_ids.index(migration_id) >= allowed_per_endpoint:
                return False
        return True

    def _endpoint_keys_for_contexts(
        self,
        source_context_id: str,
        target_context_id: str,
        *,
        cache: dict[str, str],
    ) -> set[str]:
        source_key = self._context_endpoint_capacity_key(source_context_id, cache=cache)
        target_key = self._context_endpoint_capacity_key(target_context_id, cache=cache)
        keys = {source_key, target_key}
        return {key for key in keys if key}

    def _context_endpoint_capacity_key(self, context_id: str, *, cache: dict[str, str]) -> str:
        normalized_context_id = (context_id or "").strip()
        if not normalized_context_id:
            return "context:unknown"
        cached = cache.get(normalized_context_id)
        if cached is not None:
            return cached
        endpoint_key = f"context:{normalized_context_id}"
        try:
            ctx = self._resolve_context(normalized_context_id)
            endpoint = normalize_s3_endpoint(ctx.endpoint)
            if endpoint:
                endpoint_key = f"endpoint:{endpoint}"
        except Exception:
            logger.debug(
                "Unable to resolve endpoint for migration context '%s' while evaluating endpoint limits.",
                normalized_context_id,
                exc_info=True,
            )
        cache[normalized_context_id] = endpoint_key
        return endpoint_key
