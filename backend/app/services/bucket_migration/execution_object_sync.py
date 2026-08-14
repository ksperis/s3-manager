# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import time
from contextlib import ExitStack
from typing import Any, Callable, Optional

from botocore.exceptions import BotoCoreError, ClientError

from app.db import BucketMigration, BucketMigrationItem
from app.services.s3_execution_context import S3ExecutionTarget
from app.utils.s3_endpoint import normalize_s3_endpoint
from app.utils.time import utcnow

from ._shared import (
    _DIFF_CONTROL_CHECK_INTERVAL_OBJECTS,
    _RUN_ACTIONS_CHUNK_SIZE_MULTIPLIER,
    _SYNC_PROGRESS_FLUSH_INTERVAL_SECONDS,
    _SYNC_PROGRESS_FLUSH_OBJECTS_THRESHOLD,
    _ResolvedContext,
    _SyncDiff,
    _VersionReplayWatermarkBuilder,
    _WorkerLeaseLostError,
    _json_loads,
)


class BucketMigrationObjectSyncMixin:
    def _sync_bucket(
        self,
        source_ctx: _ResolvedContext,
        target_ctx: _ResolvedContext,
        *,
        source_bucket: str,
        target_bucket: str,
        allow_delete: bool,
        parallelism_max: int,
        migration: BucketMigration,
        item: BucketMigrationItem,
        control_check: Callable[[], str],
    ) -> tuple[int, int, _SyncDiff]:
        if self._item_execution_strategy(item) == "version_aware":
            return self._sync_bucket_version_aware(
                source_ctx,
                target_ctx,
                source_bucket=source_bucket,
                target_bucket=target_bucket,
                allow_delete=allow_delete,
                parallelism_max=parallelism_max,
                migration=migration,
                item=item,
                control_check=control_check,
            )

        diff = self._new_empty_sync_diff()
        same_endpoint = self._is_same_endpoint(source_ctx, target_ctx)
        same_endpoint_copy = bool(same_endpoint and migration.use_same_endpoint_copy)
        pending_copied = 0
        pending_deleted = 0
        last_progress_flush = time.monotonic()
        copied = 0
        deleted = 0
        copy_batch: list[str] = []
        delete_batch: list[str] = []
        scan_count_since_control = 0
        worker_count = max(1, int(parallelism_max))
        action_batch_size = max(worker_count, worker_count * _RUN_ACTIONS_CHUNK_SIZE_MULTIPLIER)

        def flush_progress(*, force: bool = False) -> None:
            nonlocal pending_copied, pending_deleted, last_progress_flush
            now = time.monotonic()
            total_pending = pending_copied + pending_deleted
            if total_pending <= 0:
                return

            should_flush = force
            if not should_flush:
                if total_pending >= _SYNC_PROGRESS_FLUSH_OBJECTS_THRESHOLD:
                    should_flush = True
                elif (now - last_progress_flush) >= _SYNC_PROGRESS_FLUSH_INTERVAL_SECONDS:
                    should_flush = True
            if not should_flush:
                return

            item.objects_copied = int(item.objects_copied or 0) + int(pending_copied)
            item.objects_deleted = int(item.objects_deleted or 0) + int(pending_deleted)
            heartbeat_at = utcnow()
            item.updated_at = heartbeat_at
            migration.updated_at = heartbeat_at
            migration.last_heartbeat_at = heartbeat_at
            self._commit()
            pending_copied = 0
            pending_deleted = 0
            last_progress_flush = now

        def on_object_progress(*, copied_inc: int = 0, deleted_inc: int = 0, force: bool = False) -> None:
            nonlocal pending_copied, pending_deleted
            if copied_inc > 0:
                pending_copied += int(copied_inc)
            if deleted_inc > 0:
                pending_deleted += int(deleted_inc)
            flush_progress(force=force)

        def check_control_state(*, force_flush: bool) -> str:
            state = control_check()
            if state == "lost_lease":
                if force_flush:
                    on_object_progress(force=True)
                raise _WorkerLeaseLostError("Worker lease lost while processing bucket diff")
            if state in {"pause", "cancel"} and force_flush:
                on_object_progress(force=True)
            return state

        def flush_copy_batch() -> bool:
            nonlocal copied, copy_batch
            if not copy_batch:
                return True
            copied_now = self._run_copy_actions(
                source_ctx,
                target_ctx,
                source_bucket,
                target_bucket,
                copy_batch,
                parallelism_max=parallelism_max,
                same_endpoint=same_endpoint_copy,
                control_check=control_check,
                on_progress=on_object_progress,
            )
            copy_batch = []
            if copied_now < 0:
                return False
            copied += copied_now
            return True

        def flush_delete_batch() -> bool:
            nonlocal deleted, delete_batch
            if not delete_batch:
                return True
            deleted_now = self._run_delete_actions(
                target_ctx,
                target_bucket,
                delete_batch,
                parallelism_max=parallelism_max,
                control_check=control_check,
                on_progress=on_object_progress,
            )
            delete_batch = []
            if deleted_now < 0:
                return False
            deleted += deleted_now
            return True

        source_client = self._context_client(source_ctx)
        target_client = self._context_client(target_ctx)

        with ExitStack() as copy_grant_stack:
            copy_grant_enabled = False
            for entry in self._iter_bucket_diff_entries(
                source_ctx,
                target_ctx,
                source_bucket=source_bucket,
                target_bucket=target_bucket,
                source_client=source_client,
                target_client=target_client,
            ):
                scan_count_since_control += 1
                if scan_count_since_control >= _DIFF_CONTROL_CHECK_INTERVAL_OBJECTS:
                    state = check_control_state(force_flush=True)
                    if state in {"pause", "cancel"}:
                        return -1, -1, diff
                    scan_count_since_control = 0

                copy_required = False
                delete_required = False
                if entry.kind == "only_source":
                    diff.source_count += 1
                    diff.only_source_count += 1
                    if len(diff.sample["only_source_sample"]) < 200:
                        diff.sample["only_source_sample"].append(entry.key)
                    copy_required = True
                elif entry.kind == "only_target":
                    diff.target_count += 1
                    diff.only_target_count += 1
                    if len(diff.sample["only_target_sample"]) < 200:
                        diff.sample["only_target_sample"].append(entry.key)
                    delete_required = allow_delete
                elif entry.kind == "matched":
                    diff.source_count += 1
                    diff.target_count += 1
                    diff.matched_count += 1
                elif entry.kind == "different":
                    diff.source_count += 1
                    diff.target_count += 1
                    diff.different_count += 1
                    if len(diff.sample["different_sample"]) < 200:
                        diff.sample["different_sample"].append(
                            {
                                "key": entry.key,
                                "source_size": entry.source_size,
                                "target_size": entry.target_size,
                                "source_etag": entry.source_etag,
                                "target_etag": entry.target_etag,
                                "compare_by": entry.compare_by,
                            }
                        )
                    copy_required = True

                if copy_required:
                    if same_endpoint_copy and bool(migration.auto_grant_source_read_for_copy) and not copy_grant_enabled:
                        copy_grant_stack.enter_context(
                            self._temporary_source_copy_grant(
                                source_ctx,
                                target_ctx,
                                source_bucket=source_bucket,
                                sample_key=entry.key,
                            )
                        )
                        copy_grant_enabled = True
                    copy_batch.append(entry.key)
                    if len(copy_batch) >= action_batch_size:
                        state = check_control_state(force_flush=True)
                        if state in {"pause", "cancel"}:
                            return -1, -1, diff
                        if not flush_copy_batch():
                            return -1, -1, diff

                if delete_required:
                    delete_batch.append(entry.key)
                    if len(delete_batch) >= action_batch_size:
                        state = check_control_state(force_flush=True)
                        if state in {"pause", "cancel"}:
                            return -1, -1, diff
                        if not flush_delete_batch():
                            return -1, -1, diff

            state = check_control_state(force_flush=True)
            if state in {"pause", "cancel"}:
                return -1, -1, diff
            if not flush_copy_batch():
                return -1, -1, diff
            if not flush_delete_batch():
                return -1, -1, diff

        if copied == 0 and deleted == 0:
            return 0, 0, diff

        on_object_progress(force=True)
        self._add_event(
            migration,
            item=item,
            level="info",
            message="Sync batch completed.",
            metadata={
                "copied": copied,
                "deleted": deleted,
                "allow_delete": allow_delete,
                "same_endpoint_copy": same_endpoint_copy,
            },
        )
        self._commit()
        return copied, deleted, diff

    def _sync_bucket_version_aware(
        self,
        source_ctx: _ResolvedContext,
        target_ctx: _ResolvedContext,
        *,
        source_bucket: str,
        target_bucket: str,
        allow_delete: bool,
        parallelism_max: int,
        migration: BucketMigration,
        item: BucketMigrationItem,
        control_check: Callable[[], str],
    ) -> tuple[int, int, _SyncDiff]:
        del allow_delete, parallelism_max
        same_endpoint_copy = bool(self._is_same_endpoint(source_ctx, target_ctx) and migration.use_same_endpoint_copy)
        pending_copied = 0
        pending_deleted = 0
        last_progress_flush = time.monotonic()

        def flush_progress(*, force: bool = False) -> None:
            nonlocal pending_copied, pending_deleted, last_progress_flush
            now = time.monotonic()
            total_pending = pending_copied + pending_deleted
            if total_pending <= 0:
                return
            should_flush = force
            if not should_flush:
                if total_pending >= _SYNC_PROGRESS_FLUSH_OBJECTS_THRESHOLD:
                    should_flush = True
                elif (now - last_progress_flush) >= _SYNC_PROGRESS_FLUSH_INTERVAL_SECONDS:
                    should_flush = True
            if not should_flush:
                return
            item.objects_copied = int(item.objects_copied or 0) + int(pending_copied)
            item.objects_deleted = int(item.objects_deleted or 0) + int(pending_deleted)
            heartbeat_at = utcnow()
            item.updated_at = heartbeat_at
            migration.updated_at = heartbeat_at
            migration.last_heartbeat_at = heartbeat_at
            self._commit()
            pending_copied = 0
            pending_deleted = 0
            last_progress_flush = now

        def on_object_progress(*, copied_inc: int = 0, deleted_inc: int = 0, force: bool = False) -> None:
            nonlocal pending_copied, pending_deleted
            if copied_inc > 0:
                pending_copied += int(copied_inc)
            if deleted_inc > 0:
                pending_deleted += int(deleted_inc)
            flush_progress(force=force)

        replication_state = self._load_item_replication_state(item)
        watermark = replication_state.get("pre_sync_watermark") if isinstance(replication_state.get("pre_sync_watermark"), dict) else None
        purge_before_replay = False
        replay_mode = "one_shot_full"

        if migration.mode == "pre_sync" and not item.pre_sync_done:
            purge_before_replay = True
            replay_mode = "pre_sync_full"
            replication_state.pop("cutover_attempted", None)
        elif migration.mode == "pre_sync" and item.pre_sync_done and item.read_only_applied:
            if not isinstance(watermark, dict):
                purge_before_replay = True
                replay_mode = "cutover_full_missing_watermark"
            elif bool(replication_state.get("cutover_attempted")):
                purge_before_replay = True
                replay_mode = "cutover_full_retry"
                watermark = None
            else:
                replay_mode = "cutover_delta"
                replication_state["cutover_attempted"] = True
                self._store_item_replication_state(item, replication_state)
                item.updated_at = utcnow()
                self._commit()
        else:
            purge_before_replay = True
            replay_mode = "one_shot_full"

        self._configuration.set_versioning(target_bucket, target_ctx.account, enabled=True)

        deleted = 0
        if purge_before_replay:
            purged_current, purged_versions = self._purge_target_bucket(target_ctx, target_bucket)
            deleted = purged_current + purged_versions
            if deleted > 0:
                on_object_progress(deleted_inc=deleted, force=True)

        source_profile = _json_loads(item.source_snapshot_json)
        copied = 0
        pre_sync_watermark: Optional[dict[str, Any]] = None

        with ExitStack() as copy_grant_stack:
            if same_endpoint_copy and bool(migration.auto_grant_source_read_for_copy):
                candidate = self._sample_version_probe_candidate(
                    source_bucket,
                    source_profile=source_profile if isinstance(source_profile, dict) else None,
                )
                if candidate is not None:
                    sample_key, sample_version_id = candidate
                    copy_grant_stack.enter_context(
                        self._temporary_source_copy_grant(
                            source_ctx,
                            target_ctx,
                            source_bucket=source_bucket,
                            sample_key=sample_key,
                            sample_version_id=sample_version_id,
                        )
                    )

            copied, pre_sync_watermark = self._replay_bucket_versions(
                source_ctx,
                target_ctx,
                source_bucket=source_bucket,
                target_bucket=target_bucket,
                same_endpoint_copy=same_endpoint_copy,
                watermark=watermark,
                control_check=control_check,
                on_progress=on_object_progress,
            )
        if copied < 0:
            return -1, -1, self._new_empty_sync_diff()

        if replay_mode == "pre_sync_full":
            replication_state["pre_sync_watermark"] = pre_sync_watermark
            replication_state["cutover_attempted"] = False
            self._store_item_replication_state(item, replication_state)
        on_object_progress(force=True)

        compared = self._compare_versioned_timelines(
            source_ctx,
            target_ctx,
            source_bucket=source_bucket,
            target_bucket=target_bucket,
            control_check=control_check,
        )
        if compared is None:
            return -1, -1, self._new_empty_sync_diff()
        diff = self._version_aware_diff_to_sync_diff(compared)

        self._add_event(
            migration,
            item=item,
            level="info",
            message="Sync batch completed.",
            metadata={
                "copied": copied,
                "deleted": deleted,
                "same_endpoint_copy": same_endpoint_copy,
                "replay_mode": replay_mode,
                "version_aware": True,
            },
        )
        self._commit()
        return copied, deleted, diff

    def _replay_bucket_versions(
        self,
        source_ctx: _ResolvedContext,
        target_ctx: _ResolvedContext,
        *,
        source_bucket: str,
        target_bucket: str,
        same_endpoint_copy: bool,
        watermark: Optional[dict[str, Any]],
        control_check: Callable[[], str],
        on_progress: Optional[Callable[..., None]] = None,
    ) -> tuple[int, Optional[dict[str, Any]]]:
        source_client = self._context_client(source_ctx)
        target_client = self._context_client(target_ctx)
        copied = 0
        watermark_builder = _VersionReplayWatermarkBuilder()
        scan_count_since_control = 0

        for _key, timeline in self._iter_bucket_version_timelines(source_ctx, source_bucket, client=source_client):
            for entry in timeline:
                scan_count_since_control += 1
                if scan_count_since_control >= _DIFF_CONTROL_CHECK_INTERVAL_OBJECTS:
                    state = control_check()
                    if state == "lost_lease":
                        if on_progress is not None:
                            on_progress(force=True)
                        raise _WorkerLeaseLostError("Worker lease lost while replaying bucket versions")
                    if state in {"pause", "cancel"}:
                        if on_progress is not None:
                            on_progress(force=True)
                        return -1, None
                    scan_count_since_control = 0

                if watermark is not None and not self._entry_is_after_watermark(entry, watermark):
                    continue

                if entry.is_delete_marker:
                    self._replay_delete_marker(target_client, target_bucket, entry.key)
                else:
                    self._copy_object(
                        source_ctx,
                        target_ctx,
                        source_bucket=source_bucket,
                        target_bucket=target_bucket,
                        key=entry.key,
                        version_id=entry.version_id,
                        same_endpoint=same_endpoint_copy,
                        source_client=source_client,
                        target_client=target_client,
                    )
                copied += 1
                self._add_version_replay_watermark_entry(watermark_builder, entry)
                if on_progress is not None:
                    on_progress(copied_inc=1)

        if on_progress is not None:
            on_progress(force=True)
        return copied, self._finish_version_replay_watermark(watermark_builder)

    def _replay_delete_marker(self, target_client: Any, target_bucket: str, key: str) -> None:
        try:
            target_client.delete_object(Bucket=target_bucket, Key=key)
        except (ClientError, BotoCoreError) as exc:
            raise RuntimeError(
                f"Unable to recreate delete marker for '{key}' in bucket '{target_bucket}': {exc}"
            ) from exc

    def _source_versioning_status_from_item(self, item: BucketMigrationItem) -> Optional[str]:
        source_snapshot = _json_loads(item.source_snapshot_json)
        if not isinstance(source_snapshot, dict):
            return None
        versioning = source_snapshot.get("versioning")
        if not isinstance(versioning, dict):
            return None
        status = str(versioning.get("status") or "").strip()
        return status or None

    def _needs_target_versioning_finalization(
        self,
        migration: BucketMigration,
        item: BucketMigrationItem,
    ) -> bool:
        if self._item_execution_strategy(item) != "version_aware":
            return False
        if not bool(migration.copy_bucket_settings):
            return False
        return str(self._source_versioning_status_from_item(item) or "").strip().lower() == "suspended"

    def _finalize_target_versioning_state(
        self,
        target_account: S3ExecutionTarget,
        target_bucket: str,
        migration: BucketMigration,
        item: BucketMigrationItem,
    ) -> None:
        if not self._needs_target_versioning_finalization(migration, item):
            return
        replication_state = self._load_item_replication_state(item)
        if replication_state.get("target_versioning_finalized") == "suspended":
            return
        self._configuration.set_versioning(target_bucket, target_account, enabled=False)
        replication_state["target_versioning_finalized"] = "suspended"
        self._store_item_replication_state(item, replication_state)
        self._add_event(
            migration,
            item=item,
            level="info",
            message="Target bucket versioning finalized to match suspended source state.",
        )

    def _is_same_endpoint(self, source_ctx: _ResolvedContext, target_ctx: _ResolvedContext) -> bool:
        source_endpoint = normalize_s3_endpoint(source_ctx.endpoint)
        target_endpoint = normalize_s3_endpoint(target_ctx.endpoint)
        return bool(source_endpoint and target_endpoint and source_endpoint == target_endpoint)
