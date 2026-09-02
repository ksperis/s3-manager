# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import json
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from dataclasses import dataclass
from datetime import datetime
from time import monotonic
from typing import Any, Callable, Iterable

from botocore.exceptions import BotoCoreError, ClientError
from sqlalchemy.orm import Session, sessionmaker

from app.db import User
from app.db.bucket_usage_stats import BucketUsageStatsSnapshot as BucketUsageStatsSnapshotRow
from app.models.bucket_usage_stats import (
    BucketUsageStatsAggregate,
    BucketUsageStatsBucketResult,
    BucketUsageStatsDistributionEntry,
    BucketUsageStatsProgress,
    BucketUsageStatsResult,
    BucketUsageStatsScanMode,
    BucketUsageStatsSnapshot,
    BucketUsageStatsStatus,
)
from app.services.bucket_usage_stats_scan import (
    AGE_BUCKETS,
    CURRENT_VERSION_LABELS,
    DATA_TYPE_LABELS,
    DATA_TYPE_ORDER,
    SIZE_BUCKETS,
    BucketUsageScan,
    DistributionBuilder,
    ObjectVersionEntry,
)
from app.services.long_running_s3_client import LongRunningS3ClientService
from app.services.s3_execution_context import S3ExecutionTarget
from app.utils.aws_errors import aws_error_code
from app.utils.s3_errors import format_s3_error
from app.utils.time import utcnow


ProgressCallback = Callable[[BucketUsageStatsProgress], None]
CancelCheck = Callable[[], None]


class BucketUsageStatsCancelled(RuntimeError):
    pass


@dataclass(frozen=True)
class BucketUsageStatsResolvedTarget:
    account: S3ExecutionTarget
    bucket_name: str
    scope_kind: str
    scope_id: str
    scope_name: str | None = None
    context_id: str | None = None
    context_name: str | None = None


@dataclass(frozen=True)
class BucketUsageStatsAggregateTarget:
    scope_kind: str
    scope_id: str
    bucket_name: str


@dataclass(frozen=True)
class BucketUsageStatsOptions:
    parallelism: int = 8


def _json_dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=True, sort_keys=True, default=str)


def _load_distribution_entries(
    value: str,
) -> list[BucketUsageStatsDistributionEntry]:
    payload = json.loads(value)
    if not isinstance(payload, list):
        raise ValueError("Bucket usage distribution must be a JSON list")
    return [BucketUsageStatsDistributionEntry.model_validate(entry) for entry in payload]


def _load_warnings(value: str | None) -> list[str]:
    if value is None:
        return []
    payload = json.loads(value)
    if not isinstance(payload, list) or any(
        not isinstance(item, str) for item in payload
    ):
        raise ValueError("Bucket usage warnings must be a JSON string list")
    return payload


def _is_version_listing_unsupported(exc: Exception) -> bool:
    code = aws_error_code(exc, lowercase=True)
    if code in {"notimplemented", "notsupported", "unsupported", "methodnotallowed", "notallowed"}:
        return True
    detail = str(exc).lower()
    return any(marker in detail for marker in ("not implemented", "not supported", "unsupported operation"))


def _dedupe_bucket_names(bucket_names: Iterable[str] | None) -> list[str] | None:
    if bucket_names is None:
        return None
    return list(dict.fromkeys(name.strip() for name in bucket_names if name and name.strip()))


class BucketUsageStatsService(LongRunningS3ClientService):
    s3_user_agent_extra = "bucketreef-bucket-usage-stats"

    def __init__(self, session_factory: sessionmaker[Session] | Callable[[], Session] | None = None) -> None:
        self.session_factory = session_factory

    def _iter_version_entries(
        self,
        client: Any,
        bucket_name: str,
        *,
        cancel_check: CancelCheck | None,
    ):
        paginator = client.get_paginator("list_object_versions")
        for page in paginator.paginate(Bucket=bucket_name):
            if cancel_check:
                cancel_check()
            for entry in page.get("Versions", []) or []:
                key = entry.get("Key")
                if not isinstance(key, str) or not key:
                    continue
                yield ObjectVersionEntry(
                    key=key,
                    size=max(0, int(entry.get("Size") or 0)),
                    last_modified=entry.get("LastModified") if isinstance(entry.get("LastModified"), datetime) else None,
                    storage_class=entry.get("StorageClass") if isinstance(entry.get("StorageClass"), str) else None,
                    is_latest=bool(entry.get("IsLatest")),
                )
            for entry in page.get("DeleteMarkers", []) or []:
                key = entry.get("Key")
                if isinstance(key, str) and key:
                    yield {"delete_marker": True}

    def _iter_current_entries(
        self,
        client: Any,
        bucket_name: str,
        *,
        cancel_check: CancelCheck | None,
    ):
        paginator = client.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=bucket_name):
            if cancel_check:
                cancel_check()
            for entry in page.get("Contents", []) or []:
                key = entry.get("Key")
                if not isinstance(key, str) or not key:
                    continue
                yield ObjectVersionEntry(
                    key=key,
                    size=max(0, int(entry.get("Size") or 0)),
                    last_modified=entry.get("LastModified") if isinstance(entry.get("LastModified"), datetime) else None,
                    storage_class=entry.get("StorageClass") if isinstance(entry.get("StorageClass"), str) else None,
                    is_latest=True,
                )

    def calculate_bucket(
        self,
        target: BucketUsageStatsResolvedTarget,
        *,
        progress_callback: ProgressCallback | None = None,
        cancel_check: CancelCheck | None = None,
    ) -> BucketUsageStatsSnapshot:
        client = self._build_client(target.account)
        calculated_at = utcnow()
        warnings: list[str] = []
        scan_mode: BucketUsageStatsScanMode = "versions"
        version_listing_available = True
        scan = BucketUsageScan(calculated_at)
        try:
            self._scan_version_entries(
                client,
                target,
                scan,
                progress_callback=progress_callback,
                cancel_check=cancel_check,
            )
        except (ClientError, BotoCoreError, RuntimeError) as exc:
            if not _is_version_listing_unsupported(exc):
                raise RuntimeError(
                    f"Unable to list object versions for '{target.bucket_name}': {format_s3_error(exc)}"
                ) from exc
            warnings.append(
                "Version listing is unavailable for this endpoint. "
                "Statistics were calculated from current objects only."
            )
            scan_mode = "current_only"
            version_listing_available = False
            scan = BucketUsageScan(calculated_at)
            try:
                self._scan_current_entries(
                    client,
                    target,
                    scan,
                    progress_callback=progress_callback,
                    cancel_check=cancel_check,
                )
            except (ClientError, BotoCoreError, RuntimeError) as fallback_exc:
                raise RuntimeError(
                    f"Unable to list current objects for '{target.bucket_name}': {format_s3_error(fallback_exc)}"
                ) from fallback_exc
        return scan.snapshot(
            target,
            scan_mode=scan_mode,
            version_listing_available=version_listing_available,
            warnings=warnings,
        )

    def _scan_version_entries(
        self,
        client: Any,
        target: BucketUsageStatsResolvedTarget,
        scan: BucketUsageScan,
        *,
        progress_callback: ProgressCallback | None,
        cancel_check: CancelCheck | None,
    ) -> None:
        scan.emit_progress(
            target,
            progress_callback,
            "Listing object versions",
        )
        entries = self._iter_version_entries(
            client,
            target.bucket_name,
            cancel_check=cancel_check,
        )
        for entry in entries:
            if cancel_check:
                cancel_check()
            if isinstance(entry, dict) and entry.get("delete_marker"):
                scan.add_delete_marker()
                continue
            scan.add_entry(entry)
            scan.emit_progress(target, progress_callback)

    def _scan_current_entries(
        self,
        client: Any,
        target: BucketUsageStatsResolvedTarget,
        scan: BucketUsageScan,
        *,
        progress_callback: ProgressCallback | None,
        cancel_check: CancelCheck | None,
    ) -> None:
        scan.emit_progress(
            target,
            progress_callback,
            "Listing current objects",
        )
        entries = self._iter_current_entries(
            client,
            target.bucket_name,
            cancel_check=cancel_check,
        )
        for entry in entries:
            if cancel_check:
                cancel_check()
            scan.add_entry(entry)
            scan.emit_progress(target, progress_callback)

    def get_latest(self, db: Session, *, scope_kind: str, scope_id: str, bucket_name: str) -> BucketUsageStatsSnapshot | None:
        row = (
            db.query(BucketUsageStatsSnapshotRow)
            .filter(
                BucketUsageStatsSnapshotRow.scope_kind == scope_kind,
                BucketUsageStatsSnapshotRow.scope_id == scope_id,
                BucketUsageStatsSnapshotRow.bucket_name == bucket_name,
            )
            .first()
        )
        return self._snapshot_from_row(row) if row else None

    def get_aggregate(
        self,
        db: Session,
        *,
        scope_kind: str,
        scope_id: str,
        scope_name: str | None = None,
        bucket_names: Iterable[str] | None = None,
    ) -> BucketUsageStatsAggregate:
        expected_bucket_names = _dedupe_bucket_names(bucket_names)
        expected_set = set(expected_bucket_names) if expected_bucket_names is not None else None
        rows = (
            db.query(BucketUsageStatsSnapshotRow)
            .filter(
                BucketUsageStatsSnapshotRow.scope_kind == scope_kind,
                BucketUsageStatsSnapshotRow.scope_id == scope_id,
            )
            .all()
        )
        snapshots = [
            self._snapshot_from_row(row)
            for row in rows
            if expected_set is None or row.bucket_name in expected_set
        ]
        bucket_count = len(expected_bucket_names) if expected_bucket_names is not None else len(snapshots)
        buckets_with_snapshot = len({snapshot.bucket_name for snapshot in snapshots})
        return self._build_aggregate(
            scope_kind=scope_kind,
            scope_id=scope_id,
            scope_name=scope_name,
            bucket_count=bucket_count,
            buckets_with_snapshot=buckets_with_snapshot,
            snapshots=snapshots,
        )

    def get_aggregate_for_targets(
        self,
        db: Session,
        *,
        scope_kind: str,
        scope_id: str,
        scope_name: str | None = None,
        targets: Iterable[BucketUsageStatsAggregateTarget],
        warnings: Iterable[str] | None = None,
        managed_account_count: int | None = None,
        accounts_with_listed_buckets: int | None = None,
        skipped_account_count: int | None = None,
    ) -> BucketUsageStatsAggregate:
        expected_targets: list[BucketUsageStatsAggregateTarget] = []
        seen_targets: set[tuple[str, str, str]] = set()
        for target in targets:
            normalized = BucketUsageStatsAggregateTarget(
                scope_kind=(target.scope_kind or "").strip(),
                scope_id=(target.scope_id or "").strip(),
                bucket_name=(target.bucket_name or "").strip(),
            )
            key = (normalized.scope_kind, normalized.scope_id, normalized.bucket_name)
            if not all(key) or key in seen_targets:
                continue
            seen_targets.add(key)
            expected_targets.append(normalized)

        rows_by_key: dict[tuple[str, str, str], BucketUsageStatsSnapshotRow] = {}
        for target_scope_kind, target_scope_id in sorted({(target.scope_kind, target.scope_id) for target in expected_targets}):
            rows = (
                db.query(BucketUsageStatsSnapshotRow)
                .filter(
                    BucketUsageStatsSnapshotRow.scope_kind == target_scope_kind,
                    BucketUsageStatsSnapshotRow.scope_id == target_scope_id,
                )
                .all()
            )
            for row in rows:
                rows_by_key[(row.scope_kind, row.scope_id, row.bucket_name)] = row

        snapshots: list[BucketUsageStatsSnapshot] = []
        covered_targets = 0
        for target in expected_targets:
            row = rows_by_key.get((target.scope_kind, target.scope_id, target.bucket_name))
            if row is None:
                continue
            snapshots.append(self._snapshot_from_row(row))
            covered_targets += 1

        return self._build_aggregate(
            scope_kind=scope_kind,
            scope_id=scope_id,
            scope_name=scope_name,
            bucket_count=len(expected_targets),
            buckets_with_snapshot=covered_targets,
            snapshots=snapshots,
            warnings=warnings,
            managed_account_count=managed_account_count,
            accounts_with_listed_buckets=accounts_with_listed_buckets,
            skipped_account_count=skipped_account_count,
        )

    def _build_aggregate(
        self,
        *,
        scope_kind: str,
        scope_id: str,
        scope_name: str | None,
        bucket_count: int,
        buckets_with_snapshot: int,
        snapshots: list[BucketUsageStatsSnapshot],
        warnings: Iterable[str] | None = None,
        managed_account_count: int | None = None,
        accounts_with_listed_buckets: int | None = None,
        skipped_account_count: int | None = None,
    ) -> BucketUsageStatsAggregate:
        missing_bucket_count = max(bucket_count - buckets_with_snapshot, 0)
        partial_scan_count = sum(1 for snapshot in snapshots if snapshot.scan_mode == "current_only" or not snapshot.version_listing_available)
        object_version_count = sum(snapshot.object_version_count for snapshot in snapshots)
        current_version_count = sum(snapshot.current_version_count for snapshot in snapshots)
        noncurrent_version_count = sum(snapshot.noncurrent_version_count for snapshot in snapshots)
        delete_marker_count = sum(snapshot.delete_marker_count for snapshot in snapshots)
        total_bytes = sum(snapshot.total_bytes for snapshot in snapshots)
        current_bytes = sum(snapshot.current_bytes for snapshot in snapshots)
        noncurrent_bytes = sum(snapshot.noncurrent_bytes for snapshot in snapshots)
        calculated_at_values = [snapshot.calculated_at for snapshot in snapshots if snapshot.calculated_at]

        aggregate_warnings: list[str] = []
        for warning in warnings or []:
            if warning and warning not in aggregate_warnings:
                aggregate_warnings.append(warning)
        if bucket_count > 0 and buckets_with_snapshot == 0:
            aggregate_warnings.append("No bucket usage stats snapshot is available yet.")
        elif missing_bucket_count > 0:
            aggregate_warnings.append("Some buckets do not have usage stats snapshots yet.")
        if partial_scan_count > 0:
            aggregate_warnings.append(
                "Some bucket snapshots were calculated from current-object listings only. Current/non-current distribution may be incomplete."
            )
        for snapshot in snapshots:
            for warning in snapshot.warnings:
                if warning not in aggregate_warnings:
                    aggregate_warnings.append(warning)

        return BucketUsageStatsAggregate(
            scope_kind=scope_kind,
            scope_id=scope_id,
            scope_name=scope_name,
            managed_account_count=managed_account_count,
            accounts_with_listed_buckets=accounts_with_listed_buckets,
            skipped_account_count=skipped_account_count,
            bucket_count=bucket_count,
            buckets_with_snapshot=buckets_with_snapshot,
            missing_bucket_count=missing_bucket_count,
            partial_scan_count=partial_scan_count,
            object_version_count=object_version_count,
            current_version_count=current_version_count,
            noncurrent_version_count=noncurrent_version_count,
            delete_marker_count=delete_marker_count,
            total_bytes=total_bytes,
            current_bytes=current_bytes,
            noncurrent_bytes=noncurrent_bytes,
            data_type_distribution=self._merge_distribution_entries(
                [snapshot.data_type_distribution for snapshot in snapshots],
                total_count=object_version_count,
                total_bytes=total_bytes,
                labels=DATA_TYPE_LABELS,
                order=DATA_TYPE_ORDER,
            ),
            storage_class_distribution=self._merge_distribution_entries(
                [snapshot.storage_class_distribution for snapshot in snapshots],
                total_count=object_version_count,
                total_bytes=total_bytes,
            ),
            size_distribution=self._merge_distribution_entries(
                [snapshot.size_distribution for snapshot in snapshots],
                total_count=object_version_count,
                total_bytes=total_bytes,
                labels={key: label for key, label, _, _ in SIZE_BUCKETS},
                order=[key for key, _, _, _ in SIZE_BUCKETS],
                include_zero_keys=True,
            ),
            age_distribution=self._merge_distribution_entries(
                [snapshot.age_distribution for snapshot in snapshots],
                total_count=object_version_count,
                total_bytes=total_bytes,
                labels={key: label for key, label, _, _ in AGE_BUCKETS} | {"unknown": "Unknown"},
                order=[key for key, _, _, _ in AGE_BUCKETS] + ["unknown"],
                include_zero_keys=True,
            ),
            current_vs_noncurrent=self._current_noncurrent_entries(
                current_count=current_version_count,
                current_bytes=current_bytes,
                noncurrent_count=noncurrent_version_count,
                noncurrent_bytes=noncurrent_bytes,
                total_count=object_version_count,
                total_bytes=total_bytes,
            ),
            warnings=aggregate_warnings,
            oldest_snapshot_at=min(calculated_at_values) if calculated_at_values else None,
            newest_snapshot_at=max(calculated_at_values) if calculated_at_values else None,
        )

    def _merge_distribution_entries(
        self,
        groups: list[list[BucketUsageStatsDistributionEntry]],
        *,
        total_count: int,
        total_bytes: int,
        labels: dict[str, str] | None = None,
        order: Iterable[str] | None = None,
        include_zero_keys: bool = False,
    ) -> list[BucketUsageStatsDistributionEntry]:
        builder = DistributionBuilder(labels or {}, order)
        for entries in groups:
            for entry in entries:
                builder.add(entry.key, count=entry.count, bytes_value=entry.bytes, label=entry.label)
        return builder.entries(total_count=total_count, total_bytes=total_bytes, include_zero_keys=include_zero_keys)

    def _current_noncurrent_entries(
        self,
        *,
        current_count: int,
        current_bytes: int,
        noncurrent_count: int,
        noncurrent_bytes: int,
        total_count: int,
        total_bytes: int,
    ) -> list[BucketUsageStatsDistributionEntry]:
        builder = DistributionBuilder(CURRENT_VERSION_LABELS, ["current", "noncurrent"])
        builder.add("current", count=current_count, bytes_value=current_bytes)
        builder.add("noncurrent", count=noncurrent_count, bytes_value=noncurrent_bytes)
        return builder.entries(total_count=total_count, total_bytes=total_bytes, include_zero_keys=True)

    def upsert_snapshot(self, db: Session, snapshot: BucketUsageStatsSnapshot) -> BucketUsageStatsSnapshot:
        row = (
            db.query(BucketUsageStatsSnapshotRow)
            .filter(
                BucketUsageStatsSnapshotRow.scope_kind == snapshot.scope_kind,
                BucketUsageStatsSnapshotRow.scope_id == snapshot.scope_id,
                BucketUsageStatsSnapshotRow.bucket_name == snapshot.bucket_name,
            )
            .first()
        )
        if row is None:
            row = BucketUsageStatsSnapshotRow(
                scope_kind=snapshot.scope_kind,
                scope_id=snapshot.scope_id,
                bucket_name=snapshot.bucket_name,
            )
            db.add(row)
        row.scope_name = snapshot.scope_name
        row.scan_mode = snapshot.scan_mode
        row.version_listing_available = bool(snapshot.version_listing_available)
        row.object_version_count = snapshot.object_version_count
        row.current_version_count = snapshot.current_version_count
        row.noncurrent_version_count = snapshot.noncurrent_version_count
        row.delete_marker_count = snapshot.delete_marker_count
        row.total_bytes = snapshot.total_bytes
        row.current_bytes = snapshot.current_bytes
        row.noncurrent_bytes = snapshot.noncurrent_bytes
        row.data_type_distribution_json = _json_dumps([entry.model_dump(mode="json") for entry in snapshot.data_type_distribution])
        row.storage_class_distribution_json = _json_dumps([entry.model_dump(mode="json") for entry in snapshot.storage_class_distribution])
        row.size_distribution_json = _json_dumps([entry.model_dump(mode="json") for entry in snapshot.size_distribution])
        row.age_distribution_json = _json_dumps([entry.model_dump(mode="json") for entry in snapshot.age_distribution])
        row.current_noncurrent_distribution_json = _json_dumps([entry.model_dump(mode="json") for entry in snapshot.current_vs_noncurrent])
        row.warnings_json = _json_dumps(snapshot.warnings) if snapshot.warnings else None
        row.calculated_at = snapshot.calculated_at
        db.commit()
        db.refresh(row)
        return self._snapshot_from_row(row)

    def calculate_and_persist(
        self,
        target: BucketUsageStatsResolvedTarget,
        *,
        progress_callback: ProgressCallback | None = None,
        cancel_check: CancelCheck | None = None,
        actor_user: User | None = None,
        actor_email: str | None = None,
        actor_role: str | None = None,
    ) -> BucketUsageStatsSnapshot:
        snapshot = self.calculate_bucket(target, progress_callback=progress_callback, cancel_check=cancel_check)
        if self.session_factory is None:
            raise RuntimeError("Session factory is required to persist bucket usage statistics")
        db = self.session_factory()
        try:
            return self.upsert_snapshot(db, snapshot)
        finally:
            db.close()

    def run(
        self,
        targets: list[BucketUsageStatsResolvedTarget],
        options: BucketUsageStatsOptions,
        *,
        progress_callback: ProgressCallback | None = None,
        cancel_check: CancelCheck | None = None,
        actor_user: User | None = None,
        actor_email: str | None = None,
        actor_role: str | None = None,
    ) -> BucketUsageStatsResult:
        started_at = utcnow()
        if progress_callback:
            progress_callback(
                BucketUsageStatsProgress(
                    stage="prepare",
                    total_buckets=len(targets),
                    message="Preparing bucket usage statistics calculation",
                )
            )

        max_workers = max(1, min(options.parallelism, 32, len(targets) or 1))
        bucket_results: list[BucketUsageStatsBucketResult] = []
        completed_buckets = 0
        failed_buckets = 0
        listed_versions = 0
        listed_delete_markers = 0
        total_bytes = 0

        def run_target(target: BucketUsageStatsResolvedTarget) -> BucketUsageStatsBucketResult:
            started = monotonic()
            try:
                snapshot = self.calculate_and_persist(
                    target,
                    progress_callback=progress_callback,
                    cancel_check=cancel_check,
                    actor_user=actor_user,
                    actor_email=actor_email,
                    actor_role=actor_role,
                )
                status_value: BucketUsageStatsStatus = "completed_with_warnings" if snapshot.warnings else "completed"
                return BucketUsageStatsBucketResult(
                    bucket_name=target.bucket_name,
                    context_id=target.context_id,
                    context_name=target.context_name,
                    status=status_value,
                    snapshot=snapshot,
                    duration_seconds=monotonic() - started,
                    message=snapshot.warnings[0] if snapshot.warnings else None,
                )
            except BucketUsageStatsCancelled:
                raise
            except Exception as exc:  # noqa: BLE001
                return BucketUsageStatsBucketResult(
                    bucket_name=target.bucket_name,
                    context_id=target.context_id,
                    context_name=target.context_name,
                    status="failed",
                    duration_seconds=monotonic() - started,
                    message=format_s3_error(exc),
                )

        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            pending = {executor.submit(run_target, target): target for target in targets}
            while pending:
                if cancel_check:
                    cancel_check()
                done, _ = wait(pending.keys(), timeout=0.2, return_when=FIRST_COMPLETED)
                for future in done:
                    pending.pop(future)
                    result = future.result()
                    bucket_results.append(result)
                    completed_buckets += 1
                    if result.status == "failed":
                        failed_buckets += 1
                    if result.snapshot:
                        listed_versions += result.snapshot.object_version_count
                        listed_delete_markers += result.snapshot.delete_marker_count
                        total_bytes += result.snapshot.total_bytes
                    if progress_callback:
                        progress_callback(
                            BucketUsageStatsProgress(
                                stage="completed",
                                bucket_name=result.bucket_name,
                                context_id=result.context_id,
                                context_name=result.context_name,
                                total_buckets=len(targets),
                                completed_buckets=completed_buckets,
                                listed_versions=listed_versions,
                                listed_delete_markers=listed_delete_markers,
                                total_bytes=total_bytes,
                                message=f"{completed_buckets}/{len(targets)} buckets completed",
                            )
                        )

        finished_at = utcnow()
        status_value: BucketUsageStatsStatus = "completed" if failed_buckets == 0 else ("failed" if failed_buckets == len(targets) else "completed_with_warnings")
        return BucketUsageStatsResult(
            status=status_value,
            total_buckets=len(targets),
            completed_buckets=completed_buckets,
            failed_buckets=failed_buckets,
            listed_versions=listed_versions,
            listed_delete_markers=listed_delete_markers,
            total_bytes=total_bytes,
            started_at=started_at,
            finished_at=finished_at,
            buckets=sorted(bucket_results, key=lambda item: ((item.context_name or item.context_id or ""), item.bucket_name)),
        )

    def _snapshot_from_row(self, row: BucketUsageStatsSnapshotRow) -> BucketUsageStatsSnapshot:
        return BucketUsageStatsSnapshot(
            scope_kind=row.scope_kind,
            scope_id=row.scope_id,
            scope_name=row.scope_name,
            bucket_name=row.bucket_name,
            scan_mode=row.scan_mode,
            version_listing_available=bool(row.version_listing_available),
            object_version_count=int(row.object_version_count or 0),
            current_version_count=int(row.current_version_count or 0),
            noncurrent_version_count=int(row.noncurrent_version_count or 0),
            delete_marker_count=int(row.delete_marker_count or 0),
            total_bytes=int(row.total_bytes or 0),
            current_bytes=int(row.current_bytes or 0),
            noncurrent_bytes=int(row.noncurrent_bytes or 0),
            data_type_distribution=_load_distribution_entries(row.data_type_distribution_json),
            storage_class_distribution=_load_distribution_entries(row.storage_class_distribution_json),
            size_distribution=_load_distribution_entries(row.size_distribution_json),
            age_distribution=_load_distribution_entries(row.age_distribution_json),
            current_vs_noncurrent=_load_distribution_entries(row.current_noncurrent_distribution_json),
            warnings=_load_warnings(row.warnings_json),
            calculated_at=row.calculated_at,
        )
