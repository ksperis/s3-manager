# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from typing import Optional

SIZE_UNIT_MULTIPLIERS = {
    "mib": 1024 ** 2,
    "gib": 1024 ** 3,
    "tib": 1024 ** 4,
}


def normalize_size_unit(unit: Optional[str]) -> Optional[str]:
    if unit is None:
        return None
    normalized = unit.strip().lower()
    if not normalized:
        return None
    if normalized in SIZE_UNIT_MULTIPLIERS:
        return normalized
    raise ValueError("Unsupported size unit. Use MiB, GiB, or TiB.")


def size_to_bytes(value: Optional[float], unit: Optional[str], default_unit: str = "gib") -> Optional[int]:
    if value is None:
        return None
    try:
        numeric = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError("Quota size must be numeric.") from exc
    if numeric < 0:
        raise ValueError("Quota size must be zero or greater.")
    unit_key = normalize_size_unit(unit) or normalize_size_unit(default_unit) or "gib"
    multiplier = SIZE_UNIT_MULTIPLIERS[unit_key]
    return int(numeric * multiplier)
