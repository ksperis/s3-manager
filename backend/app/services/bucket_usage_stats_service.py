# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import json
from collections import defaultdict
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import PurePosixPath
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
from app.services.long_running_s3_client import LongRunningS3ClientService
from app.services.s3_execution_context import S3ExecutionTarget
from app.utils.time import utcnow


ProgressCallback = Callable[[BucketUsageStatsProgress], None]
CancelCheck = Callable[[], None]

_PROGRESS_EVERY_LISTED = 500
_PROGRESS_MIN_INTERVAL_SECONDS = 0.5

_DATA_TYPE_LABELS = {
    "documents": "Documents",
    "images": "Images",
    "videos": "Videos",
    "audio": "Audio",
    "archives": "Archives",
    "scientific_data": "Scientific data",
    "source_code": "Source code",
    "backups": "Backups",
    "other": "Other",
    "unknown": "Unknown",
}
_DATA_TYPE_ORDER = list(_DATA_TYPE_LABELS.keys())

_DOCUMENT_EXTENSIONS = {
    "doc",
    "docx",
    "odt",
    "ods",
    "odp",
    "pdf",
    "ppt",
    "pptx",
    "rtf",
    "txt",
    "xls",
    "xlsx",
}
_IMAGE_EXTENSIONS = {"avif", "bmp", "gif", "heic", "ico", "jpeg", "jpg", "png", "svg", "tif", "tiff", "webp"}
_VIDEO_EXTENSIONS = {"3gp", "avi", "m4v", "mkv", "mov", "mp4", "mpeg", "mpg", "ts", "webm"}
_AUDIO_EXTENSIONS = {"aac", "aiff", "flac", "m4a", "mp3", "ogg", "wav", "wma"}
_ARCHIVE_EXTENSIONS = {"7z", "bz2", "gz", "rar", "tar", "tbz", "tgz", "txz", "xz", "zip", "zst"}
_SCIENTIFIC_EXTENSIONS = {
    "avro",
    "bam",
    "cdf",
    "csv",
    "dta",
    "fasta",
    "fastq",
    "feather",
    "fits",
    "h5",
    "hdf5",
    "mzml",
    "nc",
    "netcdf",
    "orc",
    "parquet",
    "sam",
    "sav",
    "tsv",
    "vcf",
}
_SOURCE_EXTENSIONS = {
    "bash",
    "c",
    "cc",
    "cpp",
    "cs",
    "css",
    "go",
    "h",
    "hpp",
    "htm",
    "html",
    "ini",
    "java",
    "js",
    "json",
    "jsx",
    "kt",
    "kts",
    "php",
    "ps1",
    "py",
    "rb",
    "rs",
    "scala",
    "scss",
    "sh",
    "sql",
    "swift",
    "toml",
    "ts",
    "tsx",
    "xml",
    "yaml",
    "yml",
    "zsh",
}
_BACKUP_EXTENSIONS = {"bak", "backup", "dump"}
_BACKUP_NAME_MARKERS = ("backup", "backups", "snapshot", "snapshots", "dump", "dumps")

_SIZE_BUCKETS: tuple[tuple[str, str, int | None, int | None], ...] = (
    ("0_b", "0 B", 0, 0),
    ("1_b_128_kib", "1 B-128 KiB", 1, 128 * 1024),
    ("128_kib_1_mib", "128 KiB-1 MiB", 128 * 1024 + 1, 1024 * 1024),
    ("1_mib_10_mib", "1-10 MiB", 1024 * 1024 + 1, 10 * 1024 * 1024),
    ("10_mib_100_mib", "10-100 MiB", 10 * 1024 * 1024 + 1, 100 * 1024 * 1024),
    ("100_mib_1_gib", "100 MiB-1 GiB", 100 * 1024 * 1024 + 1, 1024 * 1024 * 1024),
    ("1_gib_10_gib", "1-10 GiB", 1024 * 1024 * 1024 + 1, 10 * 1024 * 1024 * 1024),
    ("gt_10_gib", ">10 GiB", 10 * 1024 * 1024 * 1024 + 1, None),
)
_AGE_BUCKETS: tuple[tuple[str, str, int | None, int | None], ...] = (
    ("lt_7d", "<7d", 0, 7),
    ("7_30d", "7-30d", 7, 30),
    ("30_90d", "30-90d", 30, 90),
    ("90_365d", "90-365d", 90, 365),
    ("1_3y", "1-3y", 365, 3 * 365),
    ("gt_3y", ">3y", 3 * 365, None),
)
_CURRENT_LABELS = {
    "current": "Current versions",
    "noncurrent": "Non-current versions",
}


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


@dataclass(frozen=True)
class _ObjectVersionEntry:
    key: str
    size: int
    last_modified: datetime | None
    storage_class: str | None
    is_latest: bool


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


def _normalize_dt(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _storage_error_code(exc: Exception) -> str:
    if not isinstance(exc, ClientError):
        return ""
    error = exc.response.get("Error", {}) if hasattr(exc, "response") else {}
    return str(error.get("Code") or "").strip().lower()


def _is_version_listing_unsupported(exc: Exception) -> bool:
    code = _storage_error_code(exc)
    if code in {"notimplemented", "notsupported", "unsupported", "methodnotallowed", "notallowed"}:
        return True
    detail = str(exc).lower()
    return any(marker in detail for marker in ("not implemented", "not supported", "unsupported operation"))


def _format_storage_error(exc: Exception) -> str:
    if isinstance(exc, ClientError):
        error = exc.response.get("Error", {}) if hasattr(exc, "response") else {}
        code = str(error.get("Code") or "").strip()
        message = str(error.get("Message") or "").strip()
        parts = [part for part in (code, message) if part and part.lower() != "none"]
        return ": ".join(parts) if parts else str(exc)
    return str(exc)


def _dedupe_bucket_names(bucket_names: Iterable[str] | None) -> list[str] | None:
    if bucket_names is None:
        return None
    return list(dict.fromkeys(name.strip() for name in bucket_names if name and name.strip()))


def classify_data_type(key: str) -> str:
    normalized = (key or "").strip().lower()
    if not normalized or normalized.endswith("/"):
        return "unknown"
    name = PurePosixPath(normalized).name
    if not name:
        return "unknown"
    stem = name.rsplit(".", 1)[0] if "." in name else name
    extension = name.rsplit(".", 1)[1] if "." in name else ""
    compound_extension = ".".join(name.split(".")[-2:]) if name.count(".") >= 2 else extension
    tokens = [token for token in stem.replace("_", "-").split("-") if token]

    if extension in _BACKUP_EXTENSIONS or compound_extension in {"sql.gz", "sql.zip", "dump.gz", "dump.zip"}:
        return "backups"
    if any(marker in tokens or marker in stem for marker in _BACKUP_NAME_MARKERS):
        return "backups"
    if extension in _DOCUMENT_EXTENSIONS:
        return "documents"
    if extension in _IMAGE_EXTENSIONS:
        return "images"
    if extension in _SOURCE_EXTENSIONS or name in {"dockerfile", "makefile", "gemfile", "rakefile"}:
        return "source_code"
    if extension in _VIDEO_EXTENSIONS:
        return "videos"
    if extension in _AUDIO_EXTENSIONS:
        return "audio"
    if extension in _ARCHIVE_EXTENSIONS or compound_extension in {"tar.gz", "tar.bz2", "tar.xz", "tar.zst"}:
        return "archives"
    if extension in _SCIENTIFIC_EXTENSIONS:
        return "scientific_data"
    if extension:
        return "other"
    return "unknown"


def _size_bucket_key(size: int) -> tuple[str, str]:
    safe_size = max(0, int(size or 0))
    for key, label, lower, upper in _SIZE_BUCKETS:
        if upper is None and lower is not None and safe_size >= lower:
            return key, label
        if lower is not None and upper is not None and lower <= safe_size <= upper:
            return key, label
    return "unknown", "Unknown"


def _age_bucket_key(last_modified: datetime | None, now: datetime) -> tuple[str, str]:
    normalized = _normalize_dt(last_modified)
    if normalized is None:
        return "unknown", "Unknown"
    normalized_now = _normalize_dt(now) or datetime.now(timezone.utc)
    age_days = max(0, int((normalized_now - normalized).total_seconds() // 86400))
    for key, label, lower, upper in _AGE_BUCKETS:
        if upper is None and lower is not None and age_days >= lower:
            return key, label
        if lower is not None and upper is not None and lower <= age_days < upper:
            return key, label
    return "unknown", "Unknown"


class _DistributionBuilder:
    def __init__(self, labels: dict[str, str], order: Iterable[str] | None = None) -> None:
        self.labels = dict(labels)
        self.order = list(order or labels.keys())
        self.counts: dict[str, int] = defaultdict(int)
        self.bytes: dict[str, int] = defaultdict(int)

    def add(self, key: str, *, count: int = 1, bytes_value: int = 0, label: str | None = None) -> None:
        normalized = key or "unknown"
        if label is not None:
            self.labels[normalized] = label
        if normalized not in self.order:
            self.order.append(normalized)
        self.counts[normalized] += int(count)
        self.bytes[normalized] += max(0, int(bytes_value or 0))

    def entries(self, *, total_count: int, total_bytes: int, include_zero_keys: bool = False) -> list[BucketUsageStatsDistributionEntry]:
        keys = list(self.order)
        if not include_zero_keys:
            keys = [key for key in keys if self.counts.get(key, 0) or self.bytes.get(key, 0)]
        result: list[BucketUsageStatsDistributionEntry] = []
        for key in keys:
            count = int(self.counts.get(key, 0))
            bytes_value = int(self.bytes.get(key, 0))
            result.append(
                BucketUsageStatsDistributionEntry(
                    key=key,
                    label=self.labels.get(key, key),
                    count=count,
                    bytes=bytes_value,
                    ratio_count=(count / total_count) if total_count else 0,
                    ratio_bytes=(bytes_value / total_bytes) if total_bytes else 0,
                )
            )
        return result


class BucketUsageStatsService(LongRunningS3ClientService):
    s3_user_agent_extra = "s3-manager-bucket-usage-stats"

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
                yield _ObjectVersionEntry(
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
                yield _ObjectVersionEntry(
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
        now = utcnow()
        warnings: list[str] = []
        scan_mode: BucketUsageStatsScanMode = "versions"
        version_listing_available = True

        data_type_dist = _DistributionBuilder(_DATA_TYPE_LABELS, _DATA_TYPE_ORDER)
        storage_class_dist = _DistributionBuilder({}, [])
        size_dist = _DistributionBuilder({key: label for key, label, _, _ in _SIZE_BUCKETS}, [key for key, _, _, _ in _SIZE_BUCKETS])
        age_dist = _DistributionBuilder(
            {key: label for key, label, _, _ in _AGE_BUCKETS} | {"unknown": "Unknown"},
            [key for key, _, _, _ in _AGE_BUCKETS] + ["unknown"],
        )
        current_dist = _DistributionBuilder(_CURRENT_LABELS, ["current", "noncurrent"])

        object_version_count = 0
        current_version_count = 0
        noncurrent_version_count = 0
        delete_marker_count = 0
        total_bytes = 0
        current_bytes = 0
        noncurrent_bytes = 0
        last_progress_at = 0.0

        def emit_progress(message: str | None = None) -> None:
            nonlocal last_progress_at
            if progress_callback is None:
                return
            now_monotonic = monotonic()
            if message is None and object_version_count % _PROGRESS_EVERY_LISTED != 0 and now_monotonic - last_progress_at < _PROGRESS_MIN_INTERVAL_SECONDS:
                return
            last_progress_at = now_monotonic
            progress_callback(
                BucketUsageStatsProgress(
                    stage="list",
                    bucket_name=target.bucket_name,
                    context_id=target.context_id,
                    context_name=target.context_name,
                    listed_versions=object_version_count,
                    listed_delete_markers=delete_marker_count,
                    total_bytes=total_bytes,
                    message=message,
                )
            )

        try:
            iterator = self._iter_version_entries(client, target.bucket_name, cancel_check=cancel_check)
            emit_progress("Listing object versions")
            for raw_entry in iterator:
                if cancel_check:
                    cancel_check()
                if isinstance(raw_entry, dict) and raw_entry.get("delete_marker"):
                    delete_marker_count += 1
                    continue
                entry = raw_entry
                object_version_count += 1
                entry_bytes = entry.size
                total_bytes += entry_bytes
                if entry.is_latest:
                    current_version_count += 1
                    current_bytes += entry_bytes
                    current_dist.add("current", bytes_value=entry_bytes)
                else:
                    noncurrent_version_count += 1
                    noncurrent_bytes += entry_bytes
                    current_dist.add("noncurrent", bytes_value=entry_bytes)
                data_type_dist.add(classify_data_type(entry.key), bytes_value=entry_bytes)
                storage_class = (entry.storage_class or "STANDARD").strip().upper() or "STANDARD"
                storage_class_dist.add(storage_class, bytes_value=entry_bytes, label=storage_class)
                size_key, size_label = _size_bucket_key(entry_bytes)
                size_dist.add(size_key, bytes_value=entry_bytes, label=size_label)
                age_key, age_label = _age_bucket_key(entry.last_modified, now)
                age_dist.add(age_key, bytes_value=entry_bytes, label=age_label)
                emit_progress()
        except (ClientError, BotoCoreError, RuntimeError) as exc:
            if not _is_version_listing_unsupported(exc):
                raise RuntimeError(f"Unable to list object versions for '{target.bucket_name}': {_format_storage_error(exc)}") from exc
            warnings.append("Version listing is unavailable for this endpoint. Statistics were calculated from current objects only.")
            scan_mode = "current_only"
            version_listing_available = False
            object_version_count = 0
            current_version_count = 0
            noncurrent_version_count = 0
            delete_marker_count = 0
            total_bytes = 0
            current_bytes = 0
            noncurrent_bytes = 0
            data_type_dist = _DistributionBuilder(_DATA_TYPE_LABELS, _DATA_TYPE_ORDER)
            storage_class_dist = _DistributionBuilder({}, [])
            size_dist = _DistributionBuilder({key: label for key, label, _, _ in _SIZE_BUCKETS}, [key for key, _, _, _ in _SIZE_BUCKETS])
            age_dist = _DistributionBuilder(
                {key: label for key, label, _, _ in _AGE_BUCKETS} | {"unknown": "Unknown"},
                [key for key, _, _, _ in _AGE_BUCKETS] + ["unknown"],
            )
            current_dist = _DistributionBuilder(_CURRENT_LABELS, ["current", "noncurrent"])
            emit_progress("Listing current objects")
            try:
                for entry in self._iter_current_entries(client, target.bucket_name, cancel_check=cancel_check):
                    if cancel_check:
                        cancel_check()
                    object_version_count += 1
                    current_version_count += 1
                    entry_bytes = entry.size
                    total_bytes += entry_bytes
                    current_bytes += entry_bytes
                    data_type_dist.add(classify_data_type(entry.key), bytes_value=entry_bytes)
                    storage_class = (entry.storage_class or "STANDARD").strip().upper() or "STANDARD"
                    storage_class_dist.add(storage_class, bytes_value=entry_bytes, label=storage_class)
                    size_key, size_label = _size_bucket_key(entry_bytes)
                    size_dist.add(size_key, bytes_value=entry_bytes, label=size_label)
                    age_key, age_label = _age_bucket_key(entry.last_modified, now)
                    age_dist.add(age_key, bytes_value=entry_bytes, label=age_label)
                    emit_progress()
            except (ClientError, BotoCoreError, RuntimeError) as fallback_exc:
                raise RuntimeError(f"Unable to list current objects for '{target.bucket_name}': {_format_storage_error(fallback_exc)}") from fallback_exc

        if scan_mode == "current_only":
            current_vs_noncurrent = []
        else:
            current_vs_noncurrent = current_dist.entries(
                total_count=object_version_count,
                total_bytes=total_bytes,
                include_zero_keys=True,
            )

        return BucketUsageStatsSnapshot(
            scope_kind=target.scope_kind,
            scope_id=target.scope_id,
            scope_name=target.scope_name,
            bucket_name=target.bucket_name,
            scan_mode=scan_mode,
            version_listing_available=version_listing_available,
            object_version_count=object_version_count,
            current_version_count=current_version_count,
            noncurrent_version_count=noncurrent_version_count,
            delete_marker_count=delete_marker_count,
            total_bytes=total_bytes,
            current_bytes=current_bytes,
            noncurrent_bytes=noncurrent_bytes,
            data_type_distribution=data_type_dist.entries(total_count=object_version_count, total_bytes=total_bytes),
            storage_class_distribution=storage_class_dist.entries(total_count=object_version_count, total_bytes=total_bytes),
            size_distribution=size_dist.entries(total_count=object_version_count, total_bytes=total_bytes, include_zero_keys=True),
            age_distribution=age_dist.entries(total_count=object_version_count, total_bytes=total_bytes, include_zero_keys=True),
            current_vs_noncurrent=current_vs_noncurrent,
            warnings=warnings,
            calculated_at=now,
        )

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
                labels=_DATA_TYPE_LABELS,
                order=_DATA_TYPE_ORDER,
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
                labels={key: label for key, label, _, _ in _SIZE_BUCKETS},
                order=[key for key, _, _, _ in _SIZE_BUCKETS],
                include_zero_keys=True,
            ),
            age_distribution=self._merge_distribution_entries(
                [snapshot.age_distribution for snapshot in snapshots],
                total_count=object_version_count,
                total_bytes=total_bytes,
                labels={key: label for key, label, _, _ in _AGE_BUCKETS} | {"unknown": "Unknown"},
                order=[key for key, _, _, _ in _AGE_BUCKETS] + ["unknown"],
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
        builder = _DistributionBuilder(labels or {}, order)
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
        builder = _DistributionBuilder(_CURRENT_LABELS, ["current", "noncurrent"])
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
                    message=_format_storage_error(exc),
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
