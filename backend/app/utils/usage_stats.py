# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from typing import Optional, Tuple, Dict, Any


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


def extract_usage_stats(usage: Optional[Dict[str, Any]]) -> Tuple[Optional[int], Optional[int]]:
    """
    Normalizes RGW usage payloads and returns (bytes, objects)
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
        num_objects = stats.get("num_objects")
        if num_objects is not None:
            try:
                objects_acc += int(num_objects)
                has_objects = True
            except (TypeError, ValueError):
                pass

    return (bytes_acc if has_bytes else None, objects_acc if has_objects else None)
