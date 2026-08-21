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
    _BucketDiffEntry,
    _ResolvedContext,
    _SyncDiff,
    _VersionReplayWatermarkBuilder,
    _WorkerLeaseLostError,
    _json_loads,
)


class _SyncProgressTracker:
    def __init__(
        self,
        *,
        migration: BucketMigration,
        item: BucketMigrationItem,
        commit: Callable[[], None],
    ) -> None:
        self.migration = migration
        self.item = item
        self.commit = commit
        self.pending_copied = 0
        self.pending_deleted = 0
        self.last_flush = time.monotonic()

    def record(
        self,
        *,
        copied_inc: int = 0,
        deleted_inc: int = 0,
        force: bool = False,
    ) -> None:
        if copied_inc > 0:
            self.pending_copied += int(copied_inc)
        if deleted_inc > 0:
            self.pending_deleted += int(deleted_inc)
        self.flush(force=force)

    def flush(self, *, force: bool = False) -> None:
        total_pending = self.pending_copied + self.pending_deleted
        if total_pending <= 0:
            return
        now = time.monotonic()
        if not force and total_pending < _SYNC_PROGRESS_FLUSH_OBJECTS_THRESHOLD:
            if (now - self.last_flush) < _SYNC_PROGRESS_FLUSH_INTERVAL_SECONDS:
                return

        self.item.objects_copied = int(self.item.objects_copied or 0) + self.pending_copied
        self.item.objects_deleted = int(self.item.objects_deleted or 0) + self.pending_deleted
        heartbeat_at = utcnow()
        self.item.updated_at = heartbeat_at
        self.migration.updated_at = heartbeat_at
        self.migration.last_heartbeat_at = heartbeat_at
        self.commit()
        self.pending_copied = 0
        self.pending_deleted = 0
        self.last_flush = now

    def check_control(
        self,
        control_check: Callable[[], str],
        *,
        lost_lease_message: str = "Worker lease lost while processing bucket diff",
    ) -> str:
        state = control_check()
        if state == "lost_lease":
            self.flush(force=True)
            raise _WorkerLeaseLostError(lost_lease_message)
        if state in {"pause", "cancel"}:
            self.flush(force=True)
        return state


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

        return _CurrentObjectSyncRunner(
            service=self,
            source_ctx=source_ctx,
            target_ctx=target_ctx,
            source_bucket=source_bucket,
            target_bucket=target_bucket,
            allow_delete=allow_delete,
            parallelism_max=parallelism_max,
            migration=migration,
            item=item,
            control_check=control_check,
        ).run()

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
        return _VersionAwareObjectSyncRunner(
            service=self,
            source_ctx=source_ctx,
            target_ctx=target_ctx,
            source_bucket=source_bucket,
            target_bucket=target_bucket,
            migration=migration,
            item=item,
            control_check=control_check,
        ).run()

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


class _VersionAwareObjectSyncRunner:
    def __init__(
        self,
        *,
        service: BucketMigrationObjectSyncMixin,
        source_ctx: _ResolvedContext,
        target_ctx: _ResolvedContext,
        source_bucket: str,
        target_bucket: str,
        migration: BucketMigration,
        item: BucketMigrationItem,
        control_check: Callable[[], str],
    ) -> None:
        self.service = service
        self.source_ctx = source_ctx
        self.target_ctx = target_ctx
        self.source_bucket = source_bucket
        self.target_bucket = target_bucket
        self.migration = migration
        self.item = item
        self.control_check = control_check
        self.same_endpoint_copy = bool(
            service._is_same_endpoint(source_ctx, target_ctx)
            and migration.use_same_endpoint_copy
        )
        self.progress = _SyncProgressTracker(
            migration=migration,
            item=item,
            commit=service._commit,
        )
        self.replication_state = service._load_item_replication_state(item)
        raw_watermark = self.replication_state.get("pre_sync_watermark")
        self.watermark = raw_watermark if isinstance(raw_watermark, dict) else None
        self.purge_before_replay = False
        self.replay_mode = "one_shot_full"
        self.copied = 0
        self.deleted = 0

    def run(self) -> tuple[int, int, _SyncDiff]:
        self._select_replay_plan()
        self.service._configuration.set_versioning(
            self.target_bucket,
            self.target_ctx.account,
            enabled=True,
        )
        self._purge_target_if_needed()

        self.copied, pre_sync_watermark = self._replay_versions()
        if self.copied < 0:
            return self._interrupted_result()
        self._store_pre_sync_watermark(pre_sync_watermark)
        self.progress.flush(force=True)

        compared = self.service._compare_versioned_timelines(
            self.source_ctx,
            self.target_ctx,
            source_bucket=self.source_bucket,
            target_bucket=self.target_bucket,
            control_check=self.control_check,
        )
        if compared is None:
            return self._interrupted_result()
        diff = self.service._version_aware_diff_to_sync_diff(compared)
        self._record_completion()
        return self.copied, self.deleted, diff

    def _select_replay_plan(self) -> None:
        if self.migration.mode == "pre_sync" and not self.item.pre_sync_done:
            self.purge_before_replay = True
            self.replay_mode = "pre_sync_full"
            self.replication_state.pop("cutover_attempted", None)
            return

        if (
            self.migration.mode != "pre_sync"
            or not self.item.pre_sync_done
            or not self.item.read_only_applied
        ):
            self.purge_before_replay = True
            return

        if self.watermark is None:
            self.purge_before_replay = True
            self.replay_mode = "cutover_full_missing_watermark"
            return
        if bool(self.replication_state.get("cutover_attempted")):
            self.purge_before_replay = True
            self.replay_mode = "cutover_full_retry"
            self.watermark = None
            return

        self.replay_mode = "cutover_delta"
        self.replication_state["cutover_attempted"] = True
        self.service._store_item_replication_state(
            self.item,
            self.replication_state,
        )
        self.item.updated_at = utcnow()
        self.service._commit()

    def _purge_target_if_needed(self) -> None:
        if not self.purge_before_replay:
            return
        purged_current, purged_versions = self.service._purge_target_bucket(
            self.target_ctx,
            self.target_bucket,
        )
        self.deleted = purged_current + purged_versions
        if self.deleted > 0:
            self.progress.record(deleted_inc=self.deleted, force=True)

    def _replay_versions(self) -> tuple[int, Optional[dict[str, Any]]]:
        source_profile = _json_loads(self.item.source_snapshot_json)
        with ExitStack() as copy_grant_stack:
            if (
                self.same_endpoint_copy
                and bool(self.migration.auto_grant_source_read_for_copy)
            ):
                candidate = self.service._sample_version_probe_candidate(
                    self.source_bucket,
                    source_profile=(
                        source_profile if isinstance(source_profile, dict) else None
                    ),
                )
                if candidate is not None:
                    sample_key, sample_version_id = candidate
                    copy_grant_stack.enter_context(
                        self.service._temporary_source_copy_grant(
                            self.source_ctx,
                            self.target_ctx,
                            source_bucket=self.source_bucket,
                            sample_key=sample_key,
                            sample_version_id=sample_version_id,
                        )
                    )

            return self.service._replay_bucket_versions(
                self.source_ctx,
                self.target_ctx,
                source_bucket=self.source_bucket,
                target_bucket=self.target_bucket,
                same_endpoint_copy=self.same_endpoint_copy,
                watermark=self.watermark,
                control_check=self.control_check,
                on_progress=self.progress.record,
            )

    def _store_pre_sync_watermark(
        self,
        pre_sync_watermark: Optional[dict[str, Any]],
    ) -> None:
        if self.replay_mode != "pre_sync_full":
            return
        self.replication_state["pre_sync_watermark"] = pre_sync_watermark
        self.replication_state["cutover_attempted"] = False
        self.service._store_item_replication_state(
            self.item,
            self.replication_state,
        )

    def _record_completion(self) -> None:
        self.service._add_event(
            self.migration,
            item=self.item,
            level="info",
            message="Sync batch completed.",
            metadata={
                "copied": self.copied,
                "deleted": self.deleted,
                "same_endpoint_copy": self.same_endpoint_copy,
                "replay_mode": self.replay_mode,
                "version_aware": True,
            },
        )
        self.service._commit()

    def _interrupted_result(self) -> tuple[int, int, _SyncDiff]:
        return -1, -1, self.service._new_empty_sync_diff()


class _CurrentObjectSyncRunner:
    _SAMPLE_LIMIT = 200

    def __init__(
        self,
        *,
        service: BucketMigrationObjectSyncMixin,
        source_ctx: _ResolvedContext,
        target_ctx: _ResolvedContext,
        source_bucket: str,
        target_bucket: str,
        allow_delete: bool,
        parallelism_max: int,
        migration: BucketMigration,
        item: BucketMigrationItem,
        control_check: Callable[[], str],
    ) -> None:
        self.service = service
        self.source_ctx = source_ctx
        self.target_ctx = target_ctx
        self.source_bucket = source_bucket
        self.target_bucket = target_bucket
        self.allow_delete = allow_delete
        self.parallelism_max = parallelism_max
        self.migration = migration
        self.item = item
        self.control_check = control_check
        self.diff = service._new_empty_sync_diff()
        same_endpoint = service._is_same_endpoint(source_ctx, target_ctx)
        self.same_endpoint_copy = bool(same_endpoint and migration.use_same_endpoint_copy)
        self.progress = _SyncProgressTracker(migration=migration, item=item, commit=service._commit)
        self.copied = 0
        self.deleted = 0
        self.copy_batch: list[str] = []
        self.delete_batch: list[str] = []
        self.scan_count_since_control = 0
        worker_count = max(1, int(parallelism_max))
        self.action_batch_size = max(
            worker_count,
            worker_count * _RUN_ACTIONS_CHUNK_SIZE_MULTIPLIER,
        )
        self.copy_grant_stack: ExitStack | None = None
        self.copy_grant_enabled = False

    def run(self) -> tuple[int, int, _SyncDiff]:
        source_client = self.service._context_client(self.source_ctx)
        target_client = self.service._context_client(self.target_ctx)
        with ExitStack() as copy_grant_stack:
            self.copy_grant_stack = copy_grant_stack
            entries = self.service._iter_bucket_diff_entries(
                self.source_ctx,
                self.target_ctx,
                source_bucket=self.source_bucket,
                target_bucket=self.target_bucket,
                source_client=source_client,
                target_client=target_client,
            )
            for entry in entries:
                if not self._process_entry(entry):
                    return self._interrupted_result()
            if not self._finish_batches():
                return self._interrupted_result()

        if self.copied == 0 and self.deleted == 0:
            return 0, 0, self.diff
        self.progress.flush(force=True)
        self.service._add_event(
            self.migration,
            item=self.item,
            level="info",
            message="Sync batch completed.",
            metadata={
                "copied": self.copied,
                "deleted": self.deleted,
                "allow_delete": self.allow_delete,
                "same_endpoint_copy": self.same_endpoint_copy,
            },
        )
        self.service._commit()
        return self.copied, self.deleted, self.diff

    def _process_entry(self, entry: _BucketDiffEntry) -> bool:
        self.scan_count_since_control += 1
        if self.scan_count_since_control >= _DIFF_CONTROL_CHECK_INTERVAL_OBJECTS:
            if not self._may_continue():
                return False
            self.scan_count_since_control = 0

        copy_required, delete_required = self._record_diff_entry(entry)
        if copy_required and not self._queue_copy(entry.key):
            return False
        if delete_required and not self._queue_delete(entry.key):
            return False
        return True

    def _record_diff_entry(self, entry: _BucketDiffEntry) -> tuple[bool, bool]:
        if entry.kind == "only_source":
            self.diff.source_count += 1
            self.diff.only_source_count += 1
            self._append_key_sample("only_source_sample", entry.key)
            return True, False
        if entry.kind == "only_target":
            self.diff.target_count += 1
            self.diff.only_target_count += 1
            self._append_key_sample("only_target_sample", entry.key)
            return False, self.allow_delete
        if entry.kind == "matched":
            self.diff.source_count += 1
            self.diff.target_count += 1
            self.diff.matched_count += 1
            return False, False
        if entry.kind == "different":
            self.diff.source_count += 1
            self.diff.target_count += 1
            self.diff.different_count += 1
            sample = self.diff.sample["different_sample"]
            if len(sample) < self._SAMPLE_LIMIT:
                sample.append(
                    {
                        "key": entry.key,
                        "source_size": entry.source_size,
                        "target_size": entry.target_size,
                        "source_etag": entry.source_etag,
                        "target_etag": entry.target_etag,
                        "compare_by": entry.compare_by,
                    }
                )
            return True, False
        return False, False

    def _append_key_sample(self, sample_name: str, key: str) -> None:
        sample = self.diff.sample[sample_name]
        if len(sample) < self._SAMPLE_LIMIT:
            sample.append(key)

    def _queue_copy(self, key: str) -> bool:
        self._ensure_copy_grant(key)
        self.copy_batch.append(key)
        if len(self.copy_batch) < self.action_batch_size:
            return True
        return self._may_continue() and self._flush_copy_batch()

    def _queue_delete(self, key: str) -> bool:
        self.delete_batch.append(key)
        if len(self.delete_batch) < self.action_batch_size:
            return True
        return self._may_continue() and self._flush_delete_batch()

    def _ensure_copy_grant(self, sample_key: str) -> None:
        if (
            not self.same_endpoint_copy
            or not bool(self.migration.auto_grant_source_read_for_copy)
            or self.copy_grant_enabled
        ):
            return
        if self.copy_grant_stack is None:
            raise RuntimeError("Copy grant stack is not initialized")
        self.copy_grant_stack.enter_context(
            self.service._temporary_source_copy_grant(
                self.source_ctx,
                self.target_ctx,
                source_bucket=self.source_bucket,
                sample_key=sample_key,
            )
        )
        self.copy_grant_enabled = True

    def _finish_batches(self) -> bool:
        if not self._may_continue():
            return False
        return self._flush_copy_batch() and self._flush_delete_batch()

    def _may_continue(self) -> bool:
        return self.progress.check_control(self.control_check) not in {"pause", "cancel"}

    def _flush_copy_batch(self) -> bool:
        if not self.copy_batch:
            return True
        copied_now = self.service._run_copy_actions(
            self.source_ctx,
            self.target_ctx,
            self.source_bucket,
            self.target_bucket,
            self.copy_batch,
            parallelism_max=self.parallelism_max,
            same_endpoint=self.same_endpoint_copy,
            control_check=self.control_check,
            on_progress=self.progress.record,
        )
        self.copy_batch = []
        if copied_now < 0:
            return False
        self.copied += copied_now
        return True

    def _flush_delete_batch(self) -> bool:
        if not self.delete_batch:
            return True
        deleted_now = self.service._run_delete_actions(
            self.target_ctx,
            self.target_bucket,
            self.delete_batch,
            parallelism_max=self.parallelism_max,
            control_check=self.control_check,
            on_progress=self.progress.record,
        )
        self.delete_batch = []
        if deleted_now < 0:
            return False
        self.deleted += deleted_now
        return True

    def _interrupted_result(self) -> tuple[int, int, _SyncDiff]:
        return -1, -1, self.diff
