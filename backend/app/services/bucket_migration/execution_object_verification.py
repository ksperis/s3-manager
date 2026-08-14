# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import hashlib
import logging
import threading
from concurrent.futures import ThreadPoolExecutor, wait
from typing import Any, Callable, Optional

from botocore.exceptions import BotoCoreError, ClientError

from ._shared import (
    _DIFF_CONTROL_CHECK_INTERVAL_OBJECTS,
    _RUN_ACTIONS_CHUNK_SIZE_MULTIPLIER,
    _MigrationControlRequested,
    _ResolvedContext,
    _VersionTimelineDiffKey,
    _WorkerLeaseLostError,
    _chunked,
)

logger = logging.getLogger(__name__)


class BucketMigrationObjectVerificationMixin:
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

