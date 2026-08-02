# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from ._shared import *


class BucketMigrationObjectSyncMixin:
    def _size_only_common_keys(
        self,
        source_objects: dict[str, dict[str, Any]],
        target_objects: dict[str, dict[str, Any]],
        *,
        limit: int = 20,
    ) -> tuple[int, list[str]]:
        keys = self._size_only_common_key_list(source_objects, target_objects)
        return len(keys), keys[:limit]

    def _size_only_common_key_list(
        self,
        source_objects: dict[str, dict[str, Any]],
        target_objects: dict[str, dict[str, Any]],
    ) -> list[str]:
        keys: list[str] = []
        for key in sorted(set(source_objects.keys()) & set(target_objects.keys())):
            comparison = compare_object_entries(source_objects[key], target_objects[key], md5_resolver=self._etag_md5)
            if comparison.compare_by == "md5":
                continue
            if not comparison.equal:
                continue
            keys.append(key)
        return keys

    def _strong_verify_size_only_objects(
        self,
        source_ctx: _ResolvedContext,
        target_ctx: _ResolvedContext,
        *,
        source_bucket: str,
        target_bucket: str,
        keys: list[str],
        parallelism_max: int,
        control_check: Callable[[], str],
        source_client: Any | None = None,
        target_client: Any | None = None,
    ) -> tuple[int, list[str], dict[str, int]]:
        if not keys:
            return 0, [], {"head_checksum": 0, "stream_sha256": 0}

        verified_count = 0
        failed_keys: list[str] = []
        method_counts: dict[str, int] = {"head_checksum": 0, "stream_sha256": 0}
        worker_count = max(1, min(int(parallelism_max), len(keys)))
        thread_local = threading.local()

        def _verify_worker(key: str) -> tuple[bool, str]:
            resolved_source_client = getattr(thread_local, "source_client", None)
            if resolved_source_client is None:
                resolved_source_client = source_client or self._context_client(source_ctx)
                thread_local.source_client = resolved_source_client
            resolved_target_client = getattr(thread_local, "target_client", None)
            if resolved_target_client is None:
                resolved_target_client = target_client or self._context_client(target_ctx)
                thread_local.target_client = resolved_target_client
            return self._strong_verify_single_object(
                source_ctx,
                target_ctx,
                source_bucket,
                target_bucket,
                key,
                source_client=resolved_source_client,
                target_client=resolved_target_client,
            )

        for chunk in _chunked(keys, worker_count):
            state = control_check()
            if state == "lost_lease":
                raise _WorkerLeaseLostError("Worker lease lost while strong-verifying objects")
            if state in {"pause", "cancel"}:
                return -1, [], method_counts

            with ThreadPoolExecutor(max_workers=worker_count, thread_name_prefix="bucket-migration-strong-verify") as executor:
                futures = {
                    executor.submit(_verify_worker, key): key
                    for key in chunk
                }
                interrupted_state: Optional[str] = None
                pending = set(futures.keys())
                while pending:
                    done, pending = wait(pending, timeout=1.0)
                    state = control_check()
                    if state == "lost_lease":
                        interrupted_state = "lost_lease"
                    elif state in {"pause", "cancel"} and interrupted_state is None:
                        interrupted_state = state

                    for future in done:
                        key = futures[future]
                        try:
                            verified, method = future.result()
                        except Exception as exc:  # noqa: BLE001
                            logger.warning("Strong verification failed for '%s': %s", key, exc)
                            failed_keys.append(key)
                            continue
                        method_counts[method] = method_counts.get(method, 0) + 1
                        if verified:
                            verified_count += 1
                        else:
                            failed_keys.append(key)

                if interrupted_state == "lost_lease":
                    raise _WorkerLeaseLostError("Worker lease lost while strong-verifying objects")
                if interrupted_state in {"pause", "cancel"}:
                    return -1, [], method_counts
        return verified_count, failed_keys, method_counts

    def _strong_verify_single_object(
        self,
        source_ctx: _ResolvedContext,
        target_ctx: _ResolvedContext,
        source_bucket: str,
        target_bucket: str,
        key: str,
        *,
        source_version_id: Optional[str] = None,
        target_version_id: Optional[str] = None,
        source_client: Any | None = None,
        target_client: Any | None = None,
    ) -> tuple[bool, str]:
        resolved_source_client = source_client or self._context_client(source_ctx)
        resolved_target_client = target_client or self._context_client(target_ctx)

        source_checksums = self._head_object_checksums(
            resolved_source_client,
            source_bucket,
            key,
            version_id=source_version_id,
        )
        target_checksums = self._head_object_checksums(
            resolved_target_client,
            target_bucket,
            key,
            version_id=target_version_id,
        )
        shared_checksum_fields = (
            "ChecksumSHA256",
            "ChecksumCRC32C",
            "ChecksumCRC32",
            "ChecksumSHA1",
        )
        for field in shared_checksum_fields:
            source_value = source_checksums.get(field)
            target_value = target_checksums.get(field)
            if source_value and target_value:
                return source_value == target_value, "head_checksum"

        source_sha256 = self._stream_object_sha256(
            resolved_source_client,
            source_bucket,
            key,
            version_id=source_version_id,
        )
        target_sha256 = self._stream_object_sha256(
            resolved_target_client,
            target_bucket,
            key,
            version_id=target_version_id,
        )
        return source_sha256 == target_sha256, "stream_sha256"

    def _head_object_checksums(
        self,
        client: Any,
        bucket_name: str,
        key: str,
        *,
        version_id: Optional[str] = None,
    ) -> dict[str, str]:
        kwargs: dict[str, Any] = {"Bucket": bucket_name, "Key": key}
        if version_id:
            kwargs["VersionId"] = version_id
        try:
            response = client.head_object(**kwargs)
        except (ClientError, BotoCoreError) as exc:
            raise RuntimeError(f"Unable to read object metadata for '{key}' in bucket '{bucket_name}': {exc}") from exc

        result: dict[str, str] = {}
        for field in ("ChecksumSHA256", "ChecksumCRC32C", "ChecksumCRC32", "ChecksumSHA1"):
            value = response.get(field) if isinstance(response, dict) else None
            if isinstance(value, str) and value.strip():
                result[field] = value.strip()
        return result

    def _stream_object_sha256(
        self,
        client: Any,
        bucket_name: str,
        key: str,
        *,
        version_id: Optional[str] = None,
    ) -> str:
        body = None
        hasher = hashlib.sha256()
        kwargs: dict[str, Any] = {"Bucket": bucket_name, "Key": key}
        if version_id:
            kwargs["VersionId"] = version_id
        try:
            response = client.get_object(**kwargs)
            body = response.get("Body")
            if body is None:
                raise RuntimeError("response body is empty")
            while True:
                chunk = body.read(8 * 1024 * 1024)
                if not chunk:
                    break
                hasher.update(chunk)
        except (ClientError, BotoCoreError, RuntimeError) as exc:
            raise RuntimeError(f"Unable to compute SHA-256 for '{key}' in bucket '{bucket_name}': {exc}") from exc
        finally:
            if body is not None:
                try:
                    body.close()
                except Exception:  # noqa: BLE001
                    pass
        return hasher.hexdigest()

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

        self._buckets.set_versioning(target_bucket, target_ctx.account, enabled=True)

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
                    self._copy_single_object_version(
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

    def _version_aware_diff_to_sync_diff(self, diff: _VersionAwareDiff) -> _SyncDiff:
        return _SyncDiff(
            copy_keys=[],
            delete_keys=[],
            source_count=diff.source_count,
            target_count=diff.target_count,
            matched_count=diff.matched_count,
            different_count=diff.different_count,
            only_source_count=diff.only_source_count,
            only_target_count=diff.only_target_count,
            sample=diff.sample,
        )

    def _new_empty_sync_diff(self) -> _SyncDiff:
        return _SyncDiff(
            copy_keys=[],
            delete_keys=[],
            source_count=0,
            target_count=0,
            matched_count=0,
            different_count=0,
            only_source_count=0,
            only_target_count=0,
            sample={
                "only_source_sample": [],
                "only_target_sample": [],
                "different_sample": [],
            },
        )

    def _timeline_has_current_object(self, timeline: list[_BucketVersionEntry]) -> bool:
        return bool(timeline) and not bool(timeline[-1].is_delete_marker)

    def _compare_version_timeline_pair(
        self,
        source_client: Any,
        target_client: Any,
        *,
        source_bucket: str,
        target_bucket: str,
        key: str,
        source_timeline: list[_BucketVersionEntry],
        target_timeline: list[_BucketVersionEntry],
    ) -> _VersionTimelineComparison:
        if len(source_timeline) != len(target_timeline):
            return _VersionTimelineComparison(
                equal=False,
                first_difference={
                    "key": key,
                    "reason": "timeline_length_mismatch",
                    "source_entries": len(source_timeline),
                    "target_entries": len(target_timeline),
                },
            )

        size_only_pairs: list[_VersionTimelineDiffKey] = []
        for source_entry, target_entry in zip(source_timeline, target_timeline):
            if bool(source_entry.is_delete_marker) != bool(target_entry.is_delete_marker):
                return _VersionTimelineComparison(
                    equal=False,
                    first_difference={
                        "key": key,
                        "reason": "entry_kind_mismatch",
                        "source_kind": "delete_marker" if source_entry.is_delete_marker else "object",
                        "target_kind": "delete_marker" if target_entry.is_delete_marker else "object",
                    },
                )
            if source_entry.is_delete_marker:
                continue

            source_details = self._versioned_object_details(
                source_client,
                source_bucket,
                key,
                version_id=source_entry.version_id,
            )
            target_details = self._versioned_object_details(
                target_client,
                target_bucket,
                key,
                version_id=target_entry.version_id,
            )
            equal, compare_by, reason = self._compare_versioned_object_details(source_details, target_details)
            if not equal:
                return _VersionTimelineComparison(
                    equal=False,
                    first_difference={
                        "key": key,
                        "reason": reason or "object_mismatch",
                        "compare_by": compare_by,
                        "source_size": source_details.size,
                        "target_size": target_details.size,
                        "source_etag": source_details.etag,
                        "target_etag": target_details.etag,
                    },
                )
            if compare_by == "size":
                size_only_pairs.append(
                    _VersionTimelineDiffKey(
                        key=key,
                        source_version_id=source_entry.version_id,
                        target_version_id=target_entry.version_id,
                    )
                )

        return _VersionTimelineComparison(
            equal=True,
            first_difference=None,
            size_only_pairs=tuple(size_only_pairs),
        )

    def _compare_versioned_timelines(
        self,
        source_ctx: _ResolvedContext,
        target_ctx: _ResolvedContext,
        *,
        source_bucket: str,
        target_bucket: str,
        control_check: Callable[[], str],
    ) -> Optional[_VersionAwareDiff]:
        source_client = self._context_client(source_ctx)
        target_client = self._context_client(target_ctx)
        source_iter = iter(self._iter_bucket_version_timelines(source_ctx, source_bucket, client=source_client))
        target_iter = iter(self._iter_bucket_version_timelines(target_ctx, target_bucket, client=target_client))
        source_item = next(source_iter, None)
        target_item = next(target_iter, None)

        source_count = 0
        target_count = 0
        matched_count = 0
        different_count = 0
        only_source_count = 0
        only_target_count = 0
        sample = {
            "only_source_sample": [],
            "only_target_sample": [],
            "different_sample": [],
        }
        scanned_keys = 0

        while source_item is not None or target_item is not None:
            scanned_keys += 1
            if scanned_keys % 200 == 0:
                state = control_check()
                if state == "lost_lease":
                    raise _WorkerLeaseLostError("Worker lease lost while comparing version-aware timelines")
                if state in {"pause", "cancel"}:
                    return None

            if source_item is None:
                target_key, target_timeline = target_item
                if self._timeline_has_current_object(target_timeline):
                    target_count += 1
                only_target_count += 1
                if len(sample["only_target_sample"]) < 200:
                    sample["only_target_sample"].append(target_key)
                target_item = next(target_iter, None)
                continue

            if target_item is None:
                source_key, source_timeline = source_item
                if self._timeline_has_current_object(source_timeline):
                    source_count += 1
                only_source_count += 1
                if len(sample["only_source_sample"]) < 200:
                    sample["only_source_sample"].append(source_key)
                source_item = next(source_iter, None)
                continue

            source_key, source_timeline = source_item
            target_key, target_timeline = target_item
            if source_key < target_key:
                if self._timeline_has_current_object(source_timeline):
                    source_count += 1
                only_source_count += 1
                if len(sample["only_source_sample"]) < 200:
                    sample["only_source_sample"].append(source_key)
                source_item = next(source_iter, None)
                continue
            if target_key < source_key:
                if self._timeline_has_current_object(target_timeline):
                    target_count += 1
                only_target_count += 1
                if len(sample["only_target_sample"]) < 200:
                    sample["only_target_sample"].append(target_key)
                target_item = next(target_iter, None)
                continue

            if self._timeline_has_current_object(source_timeline):
                source_count += 1
            if self._timeline_has_current_object(target_timeline):
                target_count += 1
            comparison = self._compare_version_timeline_pair(
                source_client,
                target_client,
                source_bucket=source_bucket,
                target_bucket=target_bucket,
                key=source_key,
                source_timeline=source_timeline,
                target_timeline=target_timeline,
            )
            if comparison.equal:
                matched_count += 1
            else:
                different_count += 1
                if comparison.first_difference is not None and len(sample["different_sample"]) < 200:
                    sample["different_sample"].append(comparison.first_difference)
            source_item = next(source_iter, None)
            target_item = next(target_iter, None)

        return _VersionAwareDiff(
            source_count=source_count,
            target_count=target_count,
            matched_count=matched_count,
            different_count=different_count,
            only_source_count=only_source_count,
            only_target_count=only_target_count,
            sample=sample,
        )

    def _compare_buckets_version_aware(
        self,
        source_ctx: _ResolvedContext,
        target_ctx: _ResolvedContext,
        *,
        source_bucket: str,
        target_bucket: str,
        control_check: Callable[[], str],
    ) -> Optional[_SyncDiff]:
        compared = self._compare_versioned_timelines(
            source_ctx,
            target_ctx,
            source_bucket=source_bucket,
            target_bucket=target_bucket,
            control_check=control_check,
        )
        if compared is None:
            return None
        return self._version_aware_diff_to_sync_diff(compared)

    def _compare_buckets_streamed(
        self,
        source_ctx: _ResolvedContext,
        target_ctx: _ResolvedContext,
        *,
        source_bucket: str,
        target_bucket: str,
        strategy: str = "current_only",
        control_check: Callable[[], str],
    ) -> Optional[_SyncDiff]:
        if strategy == "version_aware":
            return self._compare_buckets_version_aware(
                source_ctx,
                target_ctx,
                source_bucket=source_bucket,
                target_bucket=target_bucket,
                control_check=control_check,
            )
        source_client = self._context_client(source_ctx)
        target_client = self._context_client(target_ctx)
        diff = self._new_empty_sync_diff()
        scan_count_since_control = 0

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
                state = control_check()
                if state == "lost_lease":
                    raise _WorkerLeaseLostError("Worker lease lost while comparing bucket content")
                if state in {"pause", "cancel"}:
                    return None
                scan_count_since_control = 0

            if entry.kind == "only_source":
                diff.source_count += 1
                diff.only_source_count += 1
                if len(diff.sample["only_source_sample"]) < 200:
                    diff.sample["only_source_sample"].append(entry.key)
                continue
            if entry.kind == "only_target":
                diff.target_count += 1
                diff.only_target_count += 1
                if len(diff.sample["only_target_sample"]) < 200:
                    diff.sample["only_target_sample"].append(entry.key)
                continue
            if entry.kind == "matched":
                diff.source_count += 1
                diff.target_count += 1
                diff.matched_count += 1
                continue
            if entry.kind == "different":
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

        return diff

    def _strong_verify_size_only_candidates_streamed(
        self,
        source_ctx: _ResolvedContext,
        target_ctx: _ResolvedContext,
        *,
        source_bucket: str,
        target_bucket: str,
        strategy: str = "current_only",
        parallelism_max: int,
        control_check: Callable[[], str],
    ) -> tuple[int, int, list[str], dict[str, int]]:
        if strategy == "version_aware":
            return self._strong_verify_version_aware_candidates(
                source_ctx,
                target_ctx,
                source_bucket=source_bucket,
                target_bucket=target_bucket,
                parallelism_max=parallelism_max,
                control_check=control_check,
            )
        worker_count = max(1, int(parallelism_max))
        batch_size = max(worker_count, worker_count * _RUN_ACTIONS_CHUNK_SIZE_MULTIPLIER)
        size_only_count = 0
        verified_count = 0
        failed_keys: list[str] = []
        method_counts: dict[str, int] = {"head_checksum": 0, "stream_sha256": 0}
        size_only_batch: list[str] = []
        scan_count_since_control = 0
        source_client = self._context_client(source_ctx)
        target_client = self._context_client(target_ctx)

        def merge_method_counts(local_counts: dict[str, int]) -> None:
            for method, count in local_counts.items():
                method_counts[method] = method_counts.get(method, 0) + int(count or 0)

        def flush_batch() -> bool:
            nonlocal verified_count, size_only_batch
            if not size_only_batch:
                return True
            verified_now, failed_now, method_counts_now = self._strong_verify_size_only_objects(
                source_ctx,
                target_ctx,
                source_bucket=source_bucket,
                target_bucket=target_bucket,
                keys=size_only_batch,
                parallelism_max=worker_count,
                control_check=control_check,
                source_client=source_client,
                target_client=target_client,
            )
            size_only_batch = []
            if verified_now < 0:
                return False
            verified_count += verified_now
            failed_keys.extend(failed_now)
            merge_method_counts(method_counts_now)
            return True

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
                state = control_check()
                if state == "lost_lease":
                    raise _WorkerLeaseLostError("Worker lease lost while collecting strong-verification candidates")
                if state in {"pause", "cancel"}:
                    return -1, 0, [], method_counts
                scan_count_since_control = 0

            if entry.kind != "matched" or entry.compare_by != "size":
                continue
            size_only_count += 1
            size_only_batch.append(entry.key)
            if len(size_only_batch) < batch_size:
                continue
            if not flush_batch():
                return -1, 0, [], method_counts

        if not flush_batch():
            return -1, 0, [], method_counts
        return size_only_count, verified_count, failed_keys, method_counts

    def _iter_version_aware_size_only_pairs(
        self,
        source_ctx: _ResolvedContext,
        target_ctx: _ResolvedContext,
        *,
        source_bucket: str,
        target_bucket: str,
        control_check: Callable[[], str],
    ):
        source_client = self._context_client(source_ctx)
        target_client = self._context_client(target_ctx)
        source_iter = iter(self._iter_bucket_version_timelines(source_ctx, source_bucket, client=source_client))
        target_iter = iter(self._iter_bucket_version_timelines(target_ctx, target_bucket, client=target_client))
        source_item = next(source_iter, None)
        target_item = next(target_iter, None)
        scanned_keys = 0

        while source_item is not None or target_item is not None:
            scanned_keys += 1
            if scanned_keys % 200 == 0:
                state = control_check()
                if state == "lost_lease":
                    raise _WorkerLeaseLostError(
                        "Worker lease lost while collecting version-aware strong-verification candidates"
                    )
                if state in {"pause", "cancel"}:
                    raise _MigrationControlRequested(state)

            if source_item is None:
                target_item = next(target_iter, None)
                continue
            if target_item is None:
                source_item = next(source_iter, None)
                continue

            source_key, source_timeline = source_item
            target_key, target_timeline = target_item
            if source_key < target_key:
                source_item = next(source_iter, None)
                continue
            if target_key < source_key:
                target_item = next(target_iter, None)
                continue

            comparison = self._compare_version_timeline_pair(
                source_client,
                target_client,
                source_bucket=source_bucket,
                target_bucket=target_bucket,
                key=source_key,
                source_timeline=source_timeline,
                target_timeline=target_timeline,
            )
            if comparison.equal:
                yield from comparison.size_only_pairs
            source_item = next(source_iter, None)
            target_item = next(target_iter, None)

    def _strong_verify_version_aware_candidates(
        self,
        source_ctx: _ResolvedContext,
        target_ctx: _ResolvedContext,
        *,
        source_bucket: str,
        target_bucket: str,
        parallelism_max: int,
        control_check: Callable[[], str],
    ) -> tuple[int, int, list[str], dict[str, int]]:
        size_only_count = 0
        verified_count = 0
        failed_keys: list[str] = []
        method_counts: dict[str, int] = {"head_checksum": 0, "stream_sha256": 0}
        worker_count = max(1, int(parallelism_max))
        pair_batch: list[_VersionTimelineDiffKey] = []
        thread_local = threading.local()

        def _verify_worker(pair: _VersionTimelineDiffKey) -> tuple[str, bool, str]:
            resolved_source_client = getattr(thread_local, "source_client", None)
            if resolved_source_client is None:
                resolved_source_client = self._context_client(source_ctx)
                thread_local.source_client = resolved_source_client
            resolved_target_client = getattr(thread_local, "target_client", None)
            if resolved_target_client is None:
                resolved_target_client = self._context_client(target_ctx)
                thread_local.target_client = resolved_target_client
            verified, method = self._strong_verify_single_object(
                source_ctx,
                target_ctx,
                source_bucket,
                target_bucket,
                pair.key,
                source_version_id=pair.source_version_id,
                target_version_id=pair.target_version_id,
                source_client=resolved_source_client,
                target_client=resolved_target_client,
            )
            return pair.key, verified, method

        def flush_pair_batch(executor: ThreadPoolExecutor) -> bool:
            nonlocal verified_count
            if not pair_batch:
                return True
            state = control_check()
            if state == "lost_lease":
                raise _WorkerLeaseLostError("Worker lease lost while strong-verifying version-aware objects")
            if state in {"pause", "cancel"}:
                return False

            batch = list(pair_batch)
            pair_batch.clear()
            futures = {executor.submit(_verify_worker, pair): pair for pair in batch}
            interrupted_state: Optional[str] = None
            pending = set(futures)
            while pending:
                done, pending = wait(pending, timeout=1.0)
                state = control_check()
                if state == "lost_lease":
                    interrupted_state = "lost_lease"
                elif state in {"pause", "cancel"} and interrupted_state is None:
                    interrupted_state = state

                for future in done:
                    pair = futures[future]
                    try:
                        key, verified, method = future.result()
                    except Exception as exc:  # noqa: BLE001
                        logger.warning("Version-aware strong verification failed: %s", exc)
                        failed_keys.append(pair.key)
                        continue
                    method_counts[method] = method_counts.get(method, 0) + 1
                    if verified:
                        verified_count += 1
                    else:
                        failed_keys.append(key)

            if interrupted_state == "lost_lease":
                raise _WorkerLeaseLostError("Worker lease lost while strong-verifying version-aware objects")
            if interrupted_state in {"pause", "cancel"}:
                return False
            return True

        try:
            with ThreadPoolExecutor(
                max_workers=worker_count,
                thread_name_prefix="bucket-migration-version-verify",
            ) as executor:
                for pair in self._iter_version_aware_size_only_pairs(
                    source_ctx,
                    target_ctx,
                    source_bucket=source_bucket,
                    target_bucket=target_bucket,
                    control_check=control_check,
                ):
                    size_only_count += 1
                    pair_batch.append(pair)
                    if len(pair_batch) < worker_count:
                        continue
                    if not flush_pair_batch(executor):
                        return -1, 0, [], method_counts
                if not flush_pair_batch(executor):
                    return -1, 0, [], method_counts
        except _MigrationControlRequested:
            return -1, 0, [], method_counts

        return size_only_count, verified_count, failed_keys, method_counts

    def _iter_bucket_diff_entries(
        self,
        source_ctx: _ResolvedContext,
        target_ctx: _ResolvedContext,
        *,
        source_bucket: str,
        target_bucket: str,
        source_client: Optional[Any] = None,
        target_client: Optional[Any] = None,
    ):
        source_iter = iter(self._iter_bucket_objects(source_ctx, source_bucket, client=source_client))
        target_iter = iter(self._iter_bucket_objects(target_ctx, target_bucket, client=target_client))
        source_entry = next(source_iter, None)
        target_entry = next(target_iter, None)

        while source_entry is not None or target_entry is not None:
            if source_entry is not None and (
                target_entry is None or source_entry.key < target_entry.key
            ):
                yield _BucketDiffEntry(
                    kind="only_source",
                    key=source_entry.key,
                    source_size=source_entry.size,
                    target_size=0,
                    source_etag=source_entry.etag,
                    target_etag=None,
                    compare_by="presence",
                )
                source_entry = next(source_iter, None)
                continue

            if target_entry is not None and (
                source_entry is None or target_entry.key < source_entry.key
            ):
                yield _BucketDiffEntry(
                    kind="only_target",
                    key=target_entry.key,
                    source_size=0,
                    target_size=target_entry.size,
                    source_etag=None,
                    target_etag=target_entry.etag,
                    compare_by="presence",
                )
                target_entry = next(target_iter, None)
                continue

            if source_entry is None or target_entry is None:
                break
            key = source_entry.key
            source_size = source_entry.size
            target_size = target_entry.size
            source_etag = source_entry.etag
            target_etag = target_entry.etag
            source_md5 = self._etag_md5(source_etag)
            target_md5 = self._etag_md5(target_etag)
            if source_md5 and target_md5:
                compare_by = "md5"
                equal = source_md5 == target_md5
            else:
                compare_by = "size"
                equal = source_size == target_size
            yield _BucketDiffEntry(
                kind="matched" if equal else "different",
                key=key,
                source_size=source_size,
                target_size=target_size,
                source_etag=source_etag,
                target_etag=target_etag,
                compare_by=compare_by,
            )
            source_entry = next(source_iter, None)
            target_entry = next(target_iter, None)

    def _run_copy_actions(
        self,
        source_ctx: _ResolvedContext,
        target_ctx: _ResolvedContext,
        source_bucket: str,
        target_bucket: str,
        keys: list[str],
        *,
        parallelism_max: int,
        same_endpoint: bool,
        control_check: Callable[[], str],
        on_progress: Optional[Callable[..., None]] = None,
    ) -> int:
        if not keys:
            return 0
        copied = 0
        worker_count = max(1, min(int(parallelism_max), len(keys)))
        chunk_size = max(worker_count, worker_count * _RUN_ACTIONS_CHUNK_SIZE_MULTIPLIER)
        thread_local = threading.local()

        def _copy_worker(key: str) -> None:
            source_client = getattr(thread_local, "source_client", None)
            if source_client is None:
                source_client = self._context_client(source_ctx)
                thread_local.source_client = source_client
            target_client = getattr(thread_local, "target_client", None)
            if target_client is None:
                target_client = self._context_client(target_ctx)
                thread_local.target_client = target_client
            self._copy_single_object(
                source_ctx,
                target_ctx,
                source_bucket,
                target_bucket,
                key,
                same_endpoint,
                source_client=source_client,
                target_client=target_client,
            )

        for chunk in _chunked(keys, chunk_size):
            state = control_check()
            if state == "lost_lease":
                if on_progress is not None:
                    on_progress(force=True)
                raise _WorkerLeaseLostError("Worker lease lost while copying objects")
            if state in {"pause", "cancel"}:
                if on_progress is not None:
                    on_progress(force=True)
                return -1
            with ThreadPoolExecutor(max_workers=worker_count, thread_name_prefix="bucket-migration-copy") as executor:
                futures = {executor.submit(_copy_worker, key) for key in chunk}
                interrupted_state: Optional[str] = None
                pending = set(futures)
                while pending:
                    done, pending = wait(pending, timeout=_RUN_ACTIONS_WAIT_TIMEOUT_SECONDS)
                    state = control_check()
                    if state == "lost_lease":
                        interrupted_state = "lost_lease"
                    elif state in {"pause", "cancel"} and interrupted_state is None:
                        interrupted_state = state
                    for future in done:
                        future.result()
                        copied += 1
                        if on_progress is not None:
                            on_progress(copied_inc=1)
                if interrupted_state == "lost_lease":
                    if on_progress is not None:
                        on_progress(force=True)
                    raise _WorkerLeaseLostError("Worker lease lost while copying objects")
                if interrupted_state in {"pause", "cancel"}:
                    if on_progress is not None:
                        on_progress(force=True)
                    return -1
        if on_progress is not None:
            on_progress(force=True)
        return copied

    def _run_delete_actions(
        self,
        target_ctx: _ResolvedContext,
        target_bucket: str,
        keys: list[str],
        *,
        parallelism_max: int,
        control_check: Callable[[], str],
        on_progress: Optional[Callable[..., None]] = None,
    ) -> int:
        if not keys:
            return 0
        deleted = 0
        worker_count = max(1, min(int(parallelism_max), len(keys)))
        chunk_size = max(worker_count, worker_count * _RUN_ACTIONS_CHUNK_SIZE_MULTIPLIER)
        thread_local = threading.local()

        def _delete_worker(key: str) -> None:
            target_client = getattr(thread_local, "target_client", None)
            if target_client is None:
                target_client = self._context_client(target_ctx)
                thread_local.target_client = target_client
            self._delete_single_object(target_ctx, target_bucket, key, target_client=target_client)

        for chunk in _chunked(keys, chunk_size):
            state = control_check()
            if state == "lost_lease":
                if on_progress is not None:
                    on_progress(force=True)
                raise _WorkerLeaseLostError("Worker lease lost while deleting objects")
            if state in {"pause", "cancel"}:
                if on_progress is not None:
                    on_progress(force=True)
                return -1
            with ThreadPoolExecutor(max_workers=worker_count, thread_name_prefix="bucket-migration-delete") as executor:
                futures = {executor.submit(_delete_worker, key) for key in chunk}
                interrupted_state: Optional[str] = None
                pending = set(futures)
                while pending:
                    done, pending = wait(pending, timeout=_RUN_ACTIONS_WAIT_TIMEOUT_SECONDS)
                    state = control_check()
                    if state == "lost_lease":
                        interrupted_state = "lost_lease"
                    elif state in {"pause", "cancel"} and interrupted_state is None:
                        interrupted_state = state
                    for future in done:
                        future.result()
                        deleted += 1
                        if on_progress is not None:
                            on_progress(deleted_inc=1)
                if interrupted_state == "lost_lease":
                    if on_progress is not None:
                        on_progress(force=True)
                    raise _WorkerLeaseLostError("Worker lease lost while deleting objects")
                if interrupted_state in {"pause", "cancel"}:
                    if on_progress is not None:
                        on_progress(force=True)
                    return -1
        if on_progress is not None:
            on_progress(force=True)
        return deleted

    def _copy_single_object(
        self,
        source_ctx: _ResolvedContext,
        target_ctx: _ResolvedContext,
        source_bucket: str,
        target_bucket: str,
        key: str,
        same_endpoint: bool,
        *,
        source_client: Any | None = None,
        target_client: Any | None = None,
    ) -> None:
        resolved_source_client = source_client or self._context_client(source_ctx)
        resolved_target_client = target_client or self._context_client(target_ctx)
        if same_endpoint:
            copy_source = {"Bucket": source_bucket, "Key": key}
            try:
                head = self._head_object_with_version(
                    resolved_source_client,
                    source_bucket,
                    key,
                    version_id=None,
                )
                kwargs: dict[str, Any] = {
                    "Bucket": target_bucket,
                    "Key": key,
                    "CopySource": copy_source,
                    "MetadataDirective": "COPY",
                    "TaggingDirective": "COPY",
                }
                storage_class = head.get("StorageClass")
                if isinstance(storage_class, str) and storage_class.strip():
                    kwargs["StorageClass"] = storage_class.strip()
                resolved_target_client.copy_object(**kwargs)
                return
            except (ClientError, BotoCoreError) as exc:
                if not self._is_access_denied_error(exc):
                    raise RuntimeError(f"Unable to copy object '{key}' with x-amz-copy-source: {exc}") from exc
                logger.warning(
                    "CopyObject with x-amz-copy-source denied for '%s' (%s), falling back to stream-copy.",
                    key,
                    exc,
                )
                self._stream_copy_single_object(
                    source_ctx,
                    target_ctx,
                    source_bucket=source_bucket,
                    target_bucket=target_bucket,
                    key=key,
                    source_client=resolved_source_client,
                    target_client=resolved_target_client,
                )
                return

        self._stream_copy_single_object(
            source_ctx,
            target_ctx,
            source_bucket=source_bucket,
            target_bucket=target_bucket,
            key=key,
            source_client=resolved_source_client,
            target_client=resolved_target_client,
        )

    def _copy_single_object_version(
        self,
        source_ctx: _ResolvedContext,
        target_ctx: _ResolvedContext,
        *,
        source_bucket: str,
        target_bucket: str,
        key: str,
        version_id: str,
        same_endpoint: bool,
        source_client: Any | None = None,
        target_client: Any | None = None,
    ) -> None:
        resolved_source_client = source_client or self._context_client(source_ctx)
        resolved_target_client = target_client or self._context_client(target_ctx)
        if same_endpoint:
            copy_source = {"Bucket": source_bucket, "Key": key, "VersionId": version_id}
            head = self._head_object_with_version(
                resolved_source_client,
                source_bucket,
                key,
                version_id=version_id,
            )
            kwargs: dict[str, Any] = {
                "Bucket": target_bucket,
                "Key": key,
                "CopySource": copy_source,
                "MetadataDirective": "COPY",
                "TaggingDirective": "COPY",
            }
            storage_class = head.get("StorageClass")
            if isinstance(storage_class, str) and storage_class.strip():
                kwargs["StorageClass"] = storage_class.strip()
            try:
                resolved_target_client.copy_object(**kwargs)
                return
            except (ClientError, BotoCoreError) as exc:
                if not self._is_access_denied_error(exc):
                    raise RuntimeError(
                        f"Unable to copy object version '{version_id}' for '{key}' with x-amz-copy-source: {exc}"
                    ) from exc
                logger.warning(
                    "CopyObject with x-amz-copy-source denied for version '%s' of '%s' (%s), "
                    "falling back to stream-copy.",
                    version_id,
                    key,
                    exc,
                )

        self._stream_copy_single_object_version(
            source_ctx,
            target_ctx,
            source_bucket=source_bucket,
            target_bucket=target_bucket,
            key=key,
            version_id=version_id,
            source_client=resolved_source_client,
            target_client=resolved_target_client,
        )

    def _build_upload_extra_args(
        self,
        *,
        head: dict[str, Any],
        tags: tuple[tuple[str, str], ...],
    ) -> dict[str, Any]:
        extra_args: dict[str, Any] = {}
        metadata = head.get("Metadata") if isinstance(head.get("Metadata"), dict) else {}
        if metadata:
            extra_args["Metadata"] = {
                str(meta_key): str(meta_value)
                for meta_key, meta_value in metadata.items()
                if meta_key is not None and meta_value is not None
            }
        for head_field, extra_arg_field in (
            ("ContentType", "ContentType"),
            ("CacheControl", "CacheControl"),
            ("ContentDisposition", "ContentDisposition"),
            ("ContentEncoding", "ContentEncoding"),
            ("ContentLanguage", "ContentLanguage"),
            ("Expires", "Expires"),
            ("StorageClass", "StorageClass"),
        ):
            value = head.get(head_field)
            if value is not None:
                extra_args[extra_arg_field] = value
        if tags:
            extra_args["Tagging"] = urlencode({tag_key: tag_value for tag_key, tag_value in tags})
        return extra_args

    def _stream_copy_single_object(
        self,
        source_ctx: _ResolvedContext,
        target_ctx: _ResolvedContext,
        *,
        source_bucket: str,
        target_bucket: str,
        key: str,
        source_client: Any | None = None,
        target_client: Any | None = None,
    ) -> None:
        resolved_source_client = source_client or self._context_client(source_ctx)
        resolved_target_client = target_client or self._context_client(target_ctx)
        body = None
        try:
            head = self._head_object_with_version(
                resolved_source_client,
                source_bucket,
                key,
                version_id=None,
            )
            tags = self._get_object_tags_with_version(
                resolved_source_client,
                source_bucket,
                key,
                version_id=None,
            )
            response = resolved_source_client.get_object(Bucket=source_bucket, Key=key)
            body = response.get("Body")
            extra_args = self._build_upload_extra_args(head=head, tags=tags)
            if extra_args:
                resolved_target_client.upload_fileobj(body, target_bucket, key, ExtraArgs=extra_args)
            else:
                resolved_target_client.upload_fileobj(body, target_bucket, key)
        except (ClientError, BotoCoreError) as exc:
            raise RuntimeError(f"Unable to stream-copy object '{key}': {exc}") from exc
        finally:
            if body is not None:
                try:
                    body.close()
                except Exception:  # noqa: BLE001
                    pass

    def _stream_copy_single_object_version(
        self,
        source_ctx: _ResolvedContext,
        target_ctx: _ResolvedContext,
        *,
        source_bucket: str,
        target_bucket: str,
        key: str,
        version_id: str,
        source_client: Any | None = None,
        target_client: Any | None = None,
    ) -> None:
        resolved_source_client = source_client or self._context_client(source_ctx)
        resolved_target_client = target_client or self._context_client(target_ctx)
        body = None
        try:
            head = self._head_object_with_version(
                resolved_source_client,
                source_bucket,
                key,
                version_id=version_id,
            )
            tags = self._get_object_tags_with_version(
                resolved_source_client,
                source_bucket,
                key,
                version_id=version_id,
            )
            response = resolved_source_client.get_object(
                Bucket=source_bucket,
                Key=key,
                VersionId=version_id,
            )
            body = response.get("Body")
            extra_args = self._build_upload_extra_args(head=head, tags=tags)
            if extra_args:
                resolved_target_client.upload_fileobj(body, target_bucket, key, ExtraArgs=extra_args)
            else:
                resolved_target_client.upload_fileobj(body, target_bucket, key)
        except (ClientError, BotoCoreError) as exc:
            raise RuntimeError(
                f"Unable to stream-copy object version '{version_id}' for '{key}': {exc}"
            ) from exc
        finally:
            if body is not None:
                try:
                    body.close()
                except Exception:  # noqa: BLE001
                    pass

    def _delete_single_object(
        self,
        target_ctx: _ResolvedContext,
        target_bucket: str,
        key: str,
        *,
        target_client: Any | None = None,
    ) -> None:
        client = target_client or self._context_client(target_ctx)
        try:
            client.delete_object(Bucket=target_bucket, Key=key)
        except (ClientError, BotoCoreError) as exc:
            raise RuntimeError(f"Unable to delete target object '{key}': {exc}") from exc

    def _delete_objects_batch(self, client: Any, bucket_name: str, objects: list[dict[str, str]]) -> int:
        if not objects:
            return 0
        try:
            return _delete_objects_count(client, bucket_name, objects)
        except RuntimeError:
            raise
        except (ClientError, BotoCoreError) as exc:
            raise RuntimeError(f"Unable to delete objects in bucket '{bucket_name}': {exc}") from exc

    def _iter_bucket_objects(
        self,
        ctx: _ResolvedContext,
        bucket_name: str,
        *,
        client: Optional[Any] = None,
    ):
        resolved_client = client or self._context_client(ctx)
        continuation_token: Optional[str] = None
        while True:
            kwargs: dict[str, Any] = {"Bucket": bucket_name, "MaxKeys": 1000}
            if continuation_token:
                kwargs["ContinuationToken"] = continuation_token
            try:
                page = resolved_client.list_objects_v2(**kwargs)
            except (ClientError, BotoCoreError) as exc:
                raise RuntimeError(f"Unable to list objects in bucket '{bucket_name}': {exc}") from exc
            for entry in page.get("Contents", []) or []:
                key = entry.get("Key")
                if not isinstance(key, str) or not key:
                    continue
                etag_raw = entry.get("ETag")
                etag = etag_raw.strip().strip('"') if isinstance(etag_raw, str) else None
                yield _BucketObjectEntry(
                    key=key,
                    size=int(entry.get("Size") or 0),
                    etag=etag or None,
                )
            continuation_token = page.get("NextContinuationToken")
            if not continuation_token:
                break

    def _normalize_datetime(self, value: Any) -> datetime:
        if isinstance(value, datetime):
            if value.tzinfo is None:
                return value.replace(tzinfo=timezone.utc)
            return value.astimezone(timezone.utc)
        return datetime.fromtimestamp(0, tz=timezone.utc)

    def _stable_datetime_string(self, value: Any) -> Optional[str]:
        if not isinstance(value, datetime):
            return None
        return self._normalize_datetime(value).isoformat()

    def _version_group_sort_key(self, entry: _BucketVersionEntry) -> tuple[str, float, int]:
        return (
            entry.key,
            -self._normalize_datetime(entry.last_modified).timestamp(),
            entry.order_index,
        )

    def _version_replay_sort_key(self, entry: _BucketVersionEntry) -> tuple[float, int, int]:
        # list_object_versions returns reverse-chronological entries within a key,
        # while replay/verification needs oldest -> newest. When a backend rounds
        # several recreated entries to the same second, keep objects before delete
        # markers and reverse the order_index tie-breaker so versions replay in
        # their original logical order within the timestamp group.
        return (
            self._normalize_datetime(entry.last_modified).timestamp(),
            1 if entry.is_delete_marker else 0,
            -entry.order_index,
        )

    def _iter_bucket_version_timelines(
        self,
        ctx: _ResolvedContext,
        bucket_name: str,
        *,
        client: Optional[Any] = None,
    ):
        resolved_client = client or self._context_client(ctx)
        key_marker: Optional[str] = None
        version_marker: Optional[str] = None
        order_index = 0
        buffered_key: Optional[str] = None
        buffered_entries: list[_BucketVersionEntry] = []

        while True:
            kwargs: dict[str, Any] = {"Bucket": bucket_name}
            if key_marker:
                kwargs["KeyMarker"] = key_marker
            if version_marker:
                kwargs["VersionIdMarker"] = version_marker
            try:
                page = resolved_client.list_object_versions(**kwargs)
            except (ClientError, BotoCoreError) as exc:
                raise RuntimeError(f"Unable to list object versions in bucket '{bucket_name}': {exc}") from exc

            page_entries: list[_BucketVersionEntry] = []
            for raw in page.get("Versions", []) or []:
                key = raw.get("Key")
                version_id = raw.get("VersionId")
                if not isinstance(key, str) or not key or not isinstance(version_id, str) or not version_id:
                    continue
                etag_raw = raw.get("ETag")
                etag = etag_raw.strip().strip('"') if isinstance(etag_raw, str) else None
                page_entries.append(
                    _BucketVersionEntry(
                        key=key,
                        version_id=version_id,
                        is_delete_marker=False,
                        is_latest=bool(raw.get("IsLatest")),
                        last_modified=raw.get("LastModified"),
                        size=int(raw.get("Size") or 0),
                        etag=etag or None,
                        storage_class=raw.get("StorageClass"),
                        order_index=order_index,
                    )
                )
                order_index += 1
            for raw in page.get("DeleteMarkers", []) or []:
                key = raw.get("Key")
                version_id = raw.get("VersionId")
                if not isinstance(key, str) or not key or not isinstance(version_id, str) or not version_id:
                    continue
                page_entries.append(
                    _BucketVersionEntry(
                        key=key,
                        version_id=version_id,
                        is_delete_marker=True,
                        is_latest=bool(raw.get("IsLatest")),
                        last_modified=raw.get("LastModified"),
                        size=0,
                        etag=None,
                        storage_class=None,
                        order_index=order_index,
                    )
                )
                order_index += 1

            for entry in sorted(page_entries, key=self._version_group_sort_key):
                if buffered_key is None:
                    buffered_key = entry.key
                if entry.key != buffered_key:
                    yield buffered_key, sorted(buffered_entries, key=self._version_replay_sort_key)
                    buffered_key = entry.key
                    buffered_entries = []
                buffered_entries.append(entry)

            key_marker = page.get("NextKeyMarker")
            version_marker = page.get("NextVersionIdMarker")
            if not key_marker and not version_marker:
                break

        if buffered_key is not None:
            yield buffered_key, sorted(buffered_entries, key=self._version_replay_sort_key)

    def _version_watermark_signature(self, entry: _BucketVersionEntry) -> tuple[str, str, bool]:
        return (entry.key, entry.version_id, bool(entry.is_delete_marker))

    def _add_version_replay_watermark_entry(
        self,
        builder: _VersionReplayWatermarkBuilder,
        entry: _BucketVersionEntry,
    ) -> None:
        entry_dt = self._normalize_datetime(entry.last_modified)
        tie_entry = {
            "key": entry.key,
            "version_id": entry.version_id,
            "is_delete_marker": bool(entry.is_delete_marker),
        }
        if builder.latest_dt is None or entry_dt > builder.latest_dt:
            builder.latest_dt = entry_dt
            builder.tie_entries = [tie_entry]
            return
        if entry_dt == builder.latest_dt:
            builder.tie_entries.append(tie_entry)

    def _finish_version_replay_watermark(
        self,
        builder: _VersionReplayWatermarkBuilder,
    ) -> Optional[dict[str, Any]]:
        if builder.latest_dt is None:
            return None
        return {
            "last_modified": builder.latest_dt.isoformat(),
            "tie_entries": list(builder.tie_entries),
        }

    def _build_version_replay_watermark(self, entries: list[_BucketVersionEntry]) -> Optional[dict[str, Any]]:
        builder = _VersionReplayWatermarkBuilder()
        for entry in entries:
            self._add_version_replay_watermark_entry(builder, entry)
        return self._finish_version_replay_watermark(builder)

    def _entry_is_after_watermark(self, entry: _BucketVersionEntry, watermark: Optional[dict[str, Any]]) -> bool:
        if not isinstance(watermark, dict):
            return True
        raw_last_modified = watermark.get("last_modified")
        if not isinstance(raw_last_modified, str) or not raw_last_modified.strip():
            return True
        try:
            normalized_watermark = self._normalize_datetime(datetime.fromisoformat(raw_last_modified))
        except ValueError:
            return True
        entry_dt = self._normalize_datetime(entry.last_modified)
        if entry_dt > normalized_watermark:
            return True
        if entry_dt < normalized_watermark:
            return False
        tie_entries = watermark.get("tie_entries") if isinstance(watermark.get("tie_entries"), list) else []
        tie_set = {
            (
                str(raw.get("key") or ""),
                str(raw.get("version_id") or ""),
                bool(raw.get("is_delete_marker")),
            )
            for raw in tie_entries
            if isinstance(raw, dict)
        }
        return self._version_watermark_signature(entry) not in tie_set

    def _head_object_with_version(
        self,
        client: Any,
        bucket_name: str,
        key: str,
        *,
        version_id: Optional[str] = None,
    ) -> dict[str, Any]:
        kwargs: dict[str, Any] = {"Bucket": bucket_name, "Key": key}
        if version_id:
            kwargs["VersionId"] = version_id
        try:
            response = client.head_object(**kwargs)
        except (ClientError, BotoCoreError) as exc:
            raise RuntimeError(
                f"Unable to read metadata for '{key}' in bucket '{bucket_name}': {exc}"
            ) from exc
        return response if isinstance(response, dict) else {}

    def _get_object_tags_with_version(
        self,
        client: Any,
        bucket_name: str,
        key: str,
        *,
        version_id: Optional[str] = None,
    ) -> tuple[tuple[str, str], ...]:
        kwargs: dict[str, Any] = {"Bucket": bucket_name, "Key": key}
        if version_id:
            kwargs["VersionId"] = version_id
        try:
            response = client.get_object_tagging(**kwargs)
        except (ClientError, BotoCoreError) as exc:
            raise RuntimeError(f"Unable to fetch tags for '{key}' in bucket '{bucket_name}': {exc}") from exc
        tagset = response.get("TagSet") if isinstance(response, dict) else []
        tags: list[tuple[str, str]] = []
        for raw in tagset or []:
            key_value = str(raw.get("Key") or "").strip()
            if not key_value:
                continue
            tags.append((key_value, str(raw.get("Value") or "")))
        return tuple(sorted(tags))

    def _checksums_from_head_response(self, response: dict[str, Any]) -> dict[str, str]:
        checksums: dict[str, str] = {}
        for field in _VERSION_CHECKSUM_FIELDS:
            value = response.get(field)
            if isinstance(value, str) and value.strip():
                checksums[field] = value.strip()
        return checksums

    def _versioned_object_details(
        self,
        client: Any,
        bucket_name: str,
        key: str,
        *,
        version_id: Optional[str],
    ) -> _VersionedObjectDetails:
        head = self._head_object_with_version(client, bucket_name, key, version_id=version_id)
        checksums = self._checksums_from_head_response(head)
        etag_raw = head.get("ETag")
        etag = etag_raw.strip().strip('"') if isinstance(etag_raw, str) else None
        shared_checksum_compare = next((field for field in _VERSION_CHECKSUM_FIELDS if field in checksums), None)
        compare_by = shared_checksum_compare.lower() if shared_checksum_compare else (
            "md5" if self._etag_md5(etag) else "size"
        )
        metadata = head.get("Metadata") if isinstance(head.get("Metadata"), dict) else {}
        return _VersionedObjectDetails(
            size=int(head.get("ContentLength") or 0),
            etag=etag or None,
            compare_by=compare_by,
            checksums=checksums,
            content_type=head.get("ContentType"),
            cache_control=head.get("CacheControl"),
            content_disposition=head.get("ContentDisposition"),
            content_encoding=head.get("ContentEncoding"),
            content_language=head.get("ContentLanguage"),
            expires=self._stable_datetime_string(head.get("Expires")),
            storage_class=head.get("StorageClass"),
            metadata={str(key): str(value) for key, value in metadata.items() if key is not None and value is not None},
            tags=self._get_object_tags_with_version(client, bucket_name, key, version_id=version_id),
        )

    def _compare_versioned_object_details(
        self,
        source_details: _VersionedObjectDetails,
        target_details: _VersionedObjectDetails,
    ) -> tuple[bool, str, Optional[str]]:
        for field in _VERSION_CHECKSUM_FIELDS:
            source_value = source_details.checksums.get(field)
            target_value = target_details.checksums.get(field)
            if source_value and target_value:
                if source_value != target_value:
                    return False, field.lower(), f"{field.lower()}_mismatch"
                compare_by = field.lower()
                break
        else:
            source_md5 = self._etag_md5(source_details.etag)
            target_md5 = self._etag_md5(target_details.etag)
            if source_md5 and target_md5:
                compare_by = "md5"
                if source_md5 != target_md5:
                    return False, compare_by, "md5_mismatch"
            else:
                compare_by = "size"
                if source_details.size != target_details.size:
                    return False, compare_by, "size_mismatch"

        comparisons = (
            ("content_type", source_details.content_type, target_details.content_type),
            ("cache_control", source_details.cache_control, target_details.cache_control),
            ("content_disposition", source_details.content_disposition, target_details.content_disposition),
            ("content_encoding", source_details.content_encoding, target_details.content_encoding),
            ("content_language", source_details.content_language, target_details.content_language),
            ("expires", source_details.expires, target_details.expires),
            ("storage_class", source_details.storage_class, target_details.storage_class),
            ("metadata", source_details.metadata, target_details.metadata),
            ("tags", source_details.tags, target_details.tags),
        )
        for field_name, source_value, target_value in comparisons:
            if source_value != target_value:
                return False, compare_by, f"{field_name}_mismatch"
        return True, compare_by, None

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
        target_account: S3Account,
        target_bucket: str,
        migration: BucketMigration,
        item: BucketMigrationItem,
    ) -> None:
        if not self._needs_target_versioning_finalization(migration, item):
            return
        replication_state = self._load_item_replication_state(item)
        if replication_state.get("target_versioning_finalized") == "suspended":
            return
        self._buckets.set_versioning(target_bucket, target_account, enabled=False)
        replication_state["target_versioning_finalized"] = "suspended"
        self._store_item_replication_state(item, replication_state)
        self._add_event(
            migration,
            item=item,
            level="info",
            message="Target bucket versioning finalized to match suspended source state.",
        )

    def _list_current_objects(self, ctx: _ResolvedContext, bucket_name: str) -> dict[str, dict[str, Any]]:
        objects_by_key: dict[str, dict[str, Any]] = {}
        for entry in self._iter_bucket_objects(ctx, bucket_name):
            objects_by_key[entry.key] = {"size": entry.size, "etag": entry.etag}
        return objects_by_key

    def _compute_sync_diff(
        self,
        source_objects: dict[str, dict[str, Any]],
        target_objects: dict[str, dict[str, Any]],
        *,
        allow_delete: bool,
    ) -> _SyncDiff:
        source_keys = set(source_objects.keys())
        target_keys = set(target_objects.keys())
        only_source = sorted(source_keys - target_keys)
        only_target = sorted(target_keys - source_keys)
        common_keys = sorted(source_keys & target_keys)

        copy_keys: list[str] = list(only_source)
        matched_count = 0
        different_count = 0

        different_sample: list[dict[str, Any]] = []
        for key in common_keys:
            comparison = compare_object_entries(source_objects[key], target_objects[key], md5_resolver=self._etag_md5)
            if comparison.equal:
                matched_count += 1
                continue

            different_count += 1
            copy_keys.append(key)
            if len(different_sample) < 200:
                different_sample.append(
                    {
                        "key": key,
                        "source_size": comparison.source_size,
                        "target_size": comparison.target_size,
                        "source_etag": comparison.source_etag,
                        "target_etag": comparison.target_etag,
                        "compare_by": comparison.compare_by,
                    }
                )

        delete_keys = sorted(only_target) if allow_delete else []
        sample = {
            "only_source_sample": only_source[:200],
            "only_target_sample": only_target[:200],
            "different_sample": different_sample,
        }

        return _SyncDiff(
            copy_keys=sorted(copy_keys),
            delete_keys=delete_keys,
            source_count=len(source_keys),
            target_count=len(target_keys),
            matched_count=matched_count,
            different_count=different_count,
            only_source_count=len(only_source),
            only_target_count=len(only_target),
            sample=sample,
        )

    def _etag_md5(self, etag: Optional[str]) -> Optional[str]:
        if not etag:
            return None
        value = etag.strip().strip('"')
        if not value:
            return None
        if re.fullmatch(r"[0-9a-fA-F]{32}", value):
            return value.lower()
        return None

    def _is_same_endpoint(self, source_ctx: _ResolvedContext, target_ctx: _ResolvedContext) -> bool:
        source_endpoint = normalize_s3_endpoint(source_ctx.endpoint)
        target_endpoint = normalize_s3_endpoint(target_ctx.endpoint)
        return bool(source_endpoint and target_endpoint and source_endpoint == target_endpoint)
