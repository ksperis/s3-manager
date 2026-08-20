# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from typing import Optional, Tuple, Dict, Any, Iterable


def _usage_bytes_from_entry(entry: Optional[Dict[str, Any]]) -> Optional[int]:
    if not isinstance(entry, dict):
        return None
    for field, multiplier in (("size_kb_actual", 1024), ("size_kb", 1024), ("size_actual", 1), ("size", 1)):
        value = entry.get(field)
        if value is None:
            continue
        try:
            return int(float(value) * multiplier)
        except (TypeError, ValueError):
            continue
    return None


def _usage_objects_from_entry(entry: Optional[Dict[str, Any]]) -> Optional[int]:
    if not isinstance(entry, dict):
        return None
    value = entry.get("num_objects")
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def extract_usage_stats(usage: Optional[Dict[str, Any]]) -> Tuple[Optional[int], Optional[int]]:
    """
    Normalizes RGW usage payloads and returns quota-aligned (bytes, objects)
    regardless of the underlying field naming.
    """
    if not isinstance(usage, dict):
        return None, None

    total_bytes = usage.get("total_bytes")
    total_objects = usage.get("total_objects")
    if total_objects is None:
        total_objects = usage.get("num_objects")
    if total_bytes is None and "size_kb_actual" in usage:
        try:
            total_bytes = int(float(usage["size_kb_actual"]) * 1024)
        except (TypeError, ValueError):
            total_bytes = None

    if total_bytes is not None or total_objects is not None:
        return total_bytes, total_objects

    bytes_acc = 0
    objects_acc = 0
    has_bytes = False
    has_objects = False

    for stats in usage.values():
        if not isinstance(stats, dict):
            continue
        size_bytes = _usage_bytes_from_entry(stats)
        if size_bytes is not None:
            bytes_acc += size_bytes
            has_bytes = True
        num_objects = _usage_objects_from_entry(stats)
        if num_objects is not None:
            objects_acc += num_objects
            has_objects = True

    return (bytes_acc if has_bytes else None, objects_acc if has_objects else None)


def compute_usage_ratio_percent(used: object, quota: object) -> float | None:
    if isinstance(used, bool) or isinstance(quota, bool):
        return None
    try:
        used_value = float(used)
        quota_value = float(quota)
    except (TypeError, ValueError):
        return None
    if quota_value <= 0:
        return None
    percent = (used_value / quota_value) * 100.0
    if not percent == percent:  # NaN guard without math import
        return None
    return max(0.0, percent)


def aggregate_bucket_usage(entries: Iterable[Any]) -> tuple[Optional[int], Optional[int], int]:
    total_bytes = 0
    total_objects = 0
    has_bytes = False
    has_objects = False
    bucket_count = 0

    for entry in entries:
        bucket_count += 1
        usage = entry.get("usage") if isinstance(entry, dict) else None
        used_bytes, object_count = extract_usage_stats(usage)
        if used_bytes is not None:
            total_bytes += used_bytes
            has_bytes = True
        if object_count is not None:
            total_objects += object_count
            has_objects = True

    return (
        total_bytes if has_bytes else None,
        total_objects if has_objects else None,
        bucket_count,
    )


def summarize_bucket_usage(
    entries: Iterable[Any],
) -> tuple[list[dict[str, Any]], Optional[int], Optional[int], int]:
    bucket_usage: list[dict[str, Any]] = []
    total_bytes = 0
    total_objects = 0
    has_bytes = False
    has_objects = False

    for entry in entries:
        if not isinstance(entry, dict):
            continue
        name = entry.get("bucket") or entry.get("name")
        if not name:
            continue
        used_bytes, object_count = extract_usage_stats(entry.get("usage"))
        bucket_usage.append(
            {
                "name": str(name),
                "used_bytes": used_bytes,
                "object_count": object_count,
            }
        )
        if used_bytes is not None:
            total_bytes += int(used_bytes)
            has_bytes = True
        if object_count is not None:
            total_objects += int(object_count)
            has_objects = True

    bucket_usage.sort(key=lambda item: item.get("used_bytes") or 0, reverse=True)
    return (
        bucket_usage,
        total_bytes if has_bytes else None,
        total_objects if has_objects else None,
        len(bucket_usage),
    )


def build_bucket_overview(bucket_usage: list[dict[str, Any]]) -> dict[str, Any]:
    bucket_count = len(bucket_usage)
    non_empty_buckets = [entry for entry in bucket_usage if (entry.get("used_bytes") or 0) > 0]
    object_samples = [
        entry.get("object_count") or 0
        for entry in bucket_usage
        if entry.get("object_count") not in (None, 0)
    ]
    avg_bucket_size = (
        int(sum((entry.get("used_bytes") or 0) for entry in non_empty_buckets) / len(non_empty_buckets))
        if non_empty_buckets
        else None
    )
    avg_object_count = int(sum(object_samples) / len(object_samples)) if object_samples else None
    largest_bucket = max(bucket_usage, key=lambda entry: entry.get("used_bytes") or 0, default=None)
    most_objects_bucket = max(bucket_usage, key=lambda entry: entry.get("object_count") or 0, default=None)
    return {
        "bucket_count": bucket_count,
        "non_empty_buckets": len(non_empty_buckets),
        "empty_buckets": bucket_count - len(non_empty_buckets),
        "avg_bucket_size_bytes": avg_bucket_size,
        "avg_objects_per_bucket": avg_object_count,
        "largest_bucket": largest_bucket,
        "most_objects_bucket": most_objects_bucket,
    }
