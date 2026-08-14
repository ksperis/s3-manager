# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Any, Callable, Optional

from app.utils.s3_etag import etag_md5

from ._shared import (
    _DIFF_CONTROL_CHECK_INTERVAL_OBJECTS,
    _BucketDiffEntry,
    _BucketVersionEntry,
    _ResolvedContext,
    _SyncDiff,
    _VersionAwareDiff,
    _VersionTimelineComparison,
    _VersionTimelineDiffKey,
    _WorkerLeaseLostError,
)


class BucketMigrationObjectComparisonMixin:
    def _version_aware_diff_to_sync_diff(self, diff: _VersionAwareDiff) -> _SyncDiff:
        return _SyncDiff(
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
            source_md5 = etag_md5(source_etag)
            target_md5 = etag_md5(target_etag)
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

