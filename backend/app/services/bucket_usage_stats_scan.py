# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import PurePosixPath
from time import monotonic
from typing import Callable, Iterable, Protocol

from app.models.bucket_usage_stats import (
    BucketUsageStatsDistributionEntry,
    BucketUsageStatsProgress,
    BucketUsageStatsScanMode,
    BucketUsageStatsSnapshot,
)
from app.utils.time import assume_utc


_PROGRESS_EVERY_LISTED = 500
_PROGRESS_MIN_INTERVAL_SECONDS = 0.5

DATA_TYPE_LABELS = {
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
DATA_TYPE_ORDER = list(DATA_TYPE_LABELS)

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
_IMAGE_EXTENSIONS = {
    "avif",
    "bmp",
    "gif",
    "heic",
    "ico",
    "jpeg",
    "jpg",
    "png",
    "svg",
    "tif",
    "tiff",
    "webp",
}
_VIDEO_EXTENSIONS = {
    "3gp",
    "avi",
    "m4v",
    "mkv",
    "mov",
    "mp4",
    "mpeg",
    "mpg",
    "ts",
    "webm",
}
_AUDIO_EXTENSIONS = {"aac", "aiff", "flac", "m4a", "mp3", "ogg", "wav", "wma"}
_ARCHIVE_EXTENSIONS = {
    "7z",
    "bz2",
    "gz",
    "rar",
    "tar",
    "tbz",
    "tgz",
    "txz",
    "xz",
    "zip",
    "zst",
}
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
_BACKUP_NAME_MARKERS = (
    "backup",
    "backups",
    "snapshot",
    "snapshots",
    "dump",
    "dumps",
)

SIZE_BUCKETS: tuple[tuple[str, str, int | None, int | None], ...] = (
    ("0_b", "0 B", 0, 0),
    ("1_b_128_kib", "1 B-128 KiB", 1, 128 * 1024),
    ("128_kib_1_mib", "128 KiB-1 MiB", 128 * 1024 + 1, 1024 * 1024),
    ("1_mib_10_mib", "1-10 MiB", 1024 * 1024 + 1, 10 * 1024 * 1024),
    (
        "10_mib_100_mib",
        "10-100 MiB",
        10 * 1024 * 1024 + 1,
        100 * 1024 * 1024,
    ),
    (
        "100_mib_1_gib",
        "100 MiB-1 GiB",
        100 * 1024 * 1024 + 1,
        1024 * 1024 * 1024,
    ),
    (
        "1_gib_10_gib",
        "1-10 GiB",
        1024 * 1024 * 1024 + 1,
        10 * 1024 * 1024 * 1024,
    ),
    ("gt_10_gib", ">10 GiB", 10 * 1024 * 1024 * 1024 + 1, None),
)
AGE_BUCKETS: tuple[tuple[str, str, int | None, int | None], ...] = (
    ("lt_7d", "<7d", 0, 7),
    ("7_30d", "7-30d", 7, 30),
    ("30_90d", "30-90d", 30, 90),
    ("90_365d", "90-365d", 90, 365),
    ("1_3y", "1-3y", 365, 3 * 365),
    ("gt_3y", ">3y", 3 * 365, None),
)
CURRENT_VERSION_LABELS = {
    "current": "Current versions",
    "noncurrent": "Non-current versions",
}


class BucketUsageStatsScanTarget(Protocol):
    bucket_name: str
    scope_kind: str
    scope_id: str
    scope_name: str | None
    context_id: str | None
    context_name: str | None


@dataclass(frozen=True)
class ObjectVersionEntry:
    key: str
    size: int
    last_modified: datetime | None
    storage_class: str | None
    is_latest: bool


def classify_data_type(key: str) -> str:
    normalized = (key or "").strip().lower()
    if not normalized or normalized.endswith("/"):
        return "unknown"
    name = PurePosixPath(normalized).name
    if not name:
        return "unknown"
    stem = name.rsplit(".", 1)[0] if "." in name else name
    extension = name.rsplit(".", 1)[1] if "." in name else ""
    compound_extension = (
        ".".join(name.split(".")[-2:]) if name.count(".") >= 2 else extension
    )
    tokens = [token for token in stem.replace("_", "-").split("-") if token]

    if extension in _BACKUP_EXTENSIONS or compound_extension in {
        "sql.gz",
        "sql.zip",
        "dump.gz",
        "dump.zip",
    }:
        return "backups"
    if any(marker in tokens or marker in stem for marker in _BACKUP_NAME_MARKERS):
        return "backups"
    if extension in _DOCUMENT_EXTENSIONS:
        return "documents"
    if extension in _IMAGE_EXTENSIONS:
        return "images"
    if extension in _SOURCE_EXTENSIONS or name in {
        "dockerfile",
        "makefile",
        "gemfile",
        "rakefile",
    }:
        return "source_code"
    if extension in _VIDEO_EXTENSIONS:
        return "videos"
    if extension in _AUDIO_EXTENSIONS:
        return "audio"
    if extension in _ARCHIVE_EXTENSIONS or compound_extension in {
        "tar.gz",
        "tar.bz2",
        "tar.xz",
        "tar.zst",
    }:
        return "archives"
    if extension in _SCIENTIFIC_EXTENSIONS:
        return "scientific_data"
    if extension:
        return "other"
    return "unknown"


def size_bucket_key(size: int) -> tuple[str, str]:
    safe_size = max(0, int(size or 0))
    for key, label, lower, upper in SIZE_BUCKETS:
        if upper is None and lower is not None and safe_size >= lower:
            return key, label
        if lower is not None and upper is not None and lower <= safe_size <= upper:
            return key, label
    return "unknown", "Unknown"


def age_bucket_key(
    last_modified: datetime | None,
    now: datetime,
) -> tuple[str, str]:
    normalized = assume_utc(last_modified)
    if normalized is None:
        return "unknown", "Unknown"
    normalized_now = assume_utc(now) or datetime.now(timezone.utc)
    age_days = max(0, int((normalized_now - normalized).total_seconds() // 86400))
    for key, label, lower, upper in AGE_BUCKETS:
        if upper is None and lower is not None and age_days >= lower:
            return key, label
        if lower is not None and upper is not None and lower <= age_days < upper:
            return key, label
    return "unknown", "Unknown"


class DistributionBuilder:
    def __init__(
        self,
        labels: dict[str, str],
        order: Iterable[str] | None = None,
    ) -> None:
        self.labels = dict(labels)
        self.order = list(order or labels.keys())
        self.counts: dict[str, int] = defaultdict(int)
        self.bytes: dict[str, int] = defaultdict(int)

    def add(
        self,
        key: str,
        *,
        count: int = 1,
        bytes_value: int = 0,
        label: str | None = None,
    ) -> None:
        normalized = key or "unknown"
        if label is not None:
            self.labels[normalized] = label
        if normalized not in self.order:
            self.order.append(normalized)
        self.counts[normalized] += int(count)
        self.bytes[normalized] += max(0, int(bytes_value or 0))

    def entries(
        self,
        *,
        total_count: int,
        total_bytes: int,
        include_zero_keys: bool = False,
    ) -> list[BucketUsageStatsDistributionEntry]:
        keys = list(self.order)
        if not include_zero_keys:
            keys = [
                key
                for key in keys
                if self.counts.get(key, 0) or self.bytes.get(key, 0)
            ]
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


class BucketUsageScan:
    def __init__(self, calculated_at: datetime) -> None:
        self.calculated_at = calculated_at
        self.data_types = DistributionBuilder(DATA_TYPE_LABELS, DATA_TYPE_ORDER)
        self.storage_classes = DistributionBuilder({}, [])
        self.sizes = DistributionBuilder(
            {key: label for key, label, _, _ in SIZE_BUCKETS},
            [key for key, _, _, _ in SIZE_BUCKETS],
        )
        self.ages = DistributionBuilder(
            {key: label for key, label, _, _ in AGE_BUCKETS}
            | {"unknown": "Unknown"},
            [key for key, _, _, _ in AGE_BUCKETS] + ["unknown"],
        )
        self.current_versions = DistributionBuilder(
            CURRENT_VERSION_LABELS,
            ["current", "noncurrent"],
        )
        self.object_version_count = 0
        self.current_version_count = 0
        self.noncurrent_version_count = 0
        self.delete_marker_count = 0
        self.total_bytes = 0
        self.current_bytes = 0
        self.noncurrent_bytes = 0
        self.last_progress_at = 0.0

    def add_entry(self, entry: ObjectVersionEntry) -> None:
        self.object_version_count += 1
        self.total_bytes += entry.size
        current_key = "current" if entry.is_latest else "noncurrent"
        if entry.is_latest:
            self.current_version_count += 1
            self.current_bytes += entry.size
        else:
            self.noncurrent_version_count += 1
            self.noncurrent_bytes += entry.size
        self.current_versions.add(current_key, bytes_value=entry.size)
        self.data_types.add(classify_data_type(entry.key), bytes_value=entry.size)
        storage_class = (
            (entry.storage_class or "STANDARD").strip().upper() or "STANDARD"
        )
        self.storage_classes.add(
            storage_class,
            bytes_value=entry.size,
            label=storage_class,
        )
        size_key, size_label = size_bucket_key(entry.size)
        self.sizes.add(size_key, bytes_value=entry.size, label=size_label)
        age_key, age_label = age_bucket_key(entry.last_modified, self.calculated_at)
        self.ages.add(age_key, bytes_value=entry.size, label=age_label)

    def add_delete_marker(self) -> None:
        self.delete_marker_count += 1

    def emit_progress(
        self,
        target: BucketUsageStatsScanTarget,
        callback: Callable[[BucketUsageStatsProgress], None] | None,
        message: str | None = None,
    ) -> None:
        if callback is None:
            return
        now_monotonic = monotonic()
        should_throttle = bool(
            message is None
            and self.object_version_count % _PROGRESS_EVERY_LISTED != 0
            and now_monotonic - self.last_progress_at
            < _PROGRESS_MIN_INTERVAL_SECONDS
        )
        if should_throttle:
            return
        self.last_progress_at = now_monotonic
        callback(
            BucketUsageStatsProgress(
                stage="list",
                bucket_name=target.bucket_name,
                context_id=target.context_id,
                context_name=target.context_name,
                listed_versions=self.object_version_count,
                listed_delete_markers=self.delete_marker_count,
                total_bytes=self.total_bytes,
                message=message,
            )
        )

    def snapshot(
        self,
        target: BucketUsageStatsScanTarget,
        *,
        scan_mode: BucketUsageStatsScanMode,
        version_listing_available: bool,
        warnings: list[str],
    ) -> BucketUsageStatsSnapshot:
        current_vs_noncurrent = (
            []
            if scan_mode == "current_only"
            else self.current_versions.entries(
                total_count=self.object_version_count,
                total_bytes=self.total_bytes,
                include_zero_keys=True,
            )
        )
        return BucketUsageStatsSnapshot(
            scope_kind=target.scope_kind,
            scope_id=target.scope_id,
            scope_name=target.scope_name,
            bucket_name=target.bucket_name,
            scan_mode=scan_mode,
            version_listing_available=version_listing_available,
            object_version_count=self.object_version_count,
            current_version_count=self.current_version_count,
            noncurrent_version_count=self.noncurrent_version_count,
            delete_marker_count=self.delete_marker_count,
            total_bytes=self.total_bytes,
            current_bytes=self.current_bytes,
            noncurrent_bytes=self.noncurrent_bytes,
            data_type_distribution=self.data_types.entries(
                total_count=self.object_version_count,
                total_bytes=self.total_bytes,
            ),
            storage_class_distribution=self.storage_classes.entries(
                total_count=self.object_version_count,
                total_bytes=self.total_bytes,
            ),
            size_distribution=self.sizes.entries(
                total_count=self.object_version_count,
                total_bytes=self.total_bytes,
                include_zero_keys=True,
            ),
            age_distribution=self.ages.entries(
                total_count=self.object_version_count,
                total_bytes=self.total_bytes,
                include_zero_keys=True,
            ),
            current_vs_noncurrent=current_vs_noncurrent,
            warnings=warnings,
            calculated_at=self.calculated_at,
        )
