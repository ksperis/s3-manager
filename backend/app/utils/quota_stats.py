# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from typing import Any, Dict, Optional, Tuple


def _parse_bool(value: Any) -> Optional[bool]:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"true", "1", "yes", "enabled", "enable"}:
            return True
        if normalized in {"false", "0", "no", "disabled", "disable"}:
            return False
    return None


def _parse_int(value: Any) -> Optional[int]:
    if value is None:
        return None
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, (int, float)):
        return int(value)
    if isinstance(value, str):
        normalized = value.strip()
        if not normalized:
            return None
        try:
            return int(float(normalized))
        except ValueError:
            return None
    return None


def extract_quota_limits(
    payload: Optional[Dict[str, Any]],
    *,
    keys: Tuple[str, ...] = ("quota", "user_quota", "account_quota"),
) -> Tuple[Optional[int], Optional[int]]:
    if not isinstance(payload, dict):
        return None, None
    quota: Optional[Dict[str, Any]] = None
    for key in keys:
        value = payload.get(key)
        if isinstance(value, dict):
            quota = value
            break
    if not isinstance(quota, dict):
        return None, None

    enabled = _parse_bool(quota.get("enabled"))
    if enabled is False:
        return None, None

    max_size = _parse_int(quota.get("max_size") or quota.get("max_size_bytes"))
    if max_size is None or max_size <= 0:
        max_size_kb = _parse_int(quota.get("max_size_kb"))
        if max_size_kb is not None and max_size_kb > 0:
            max_size = max_size_kb * 1024
        else:
            max_size = None
    if max_size is not None and max_size <= 0:
        max_size = None

    max_objects = _parse_int(quota.get("max_objects"))
    if max_objects is not None and max_objects <= 0:
        max_objects = None

    return max_size, max_objects


def bytes_to_gb(value: Optional[int]) -> Optional[float]:
    if value is None:
        return None
    if value <= 0:
        return None
    gb = value / (1024 ** 3)
    return int(gb) if gb.is_integer() else round(gb, 3)
