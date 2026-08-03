# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from datetime import UTC, datetime


def assume_utc(value: datetime | None) -> datetime | None:
    """Normalize a datetime to UTC, treating a naive value as already UTC."""
    if value is None:
        return None
    if value.tzinfo is None or value.utcoffset() is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def normalize_utc(value: datetime, *, name: str = "datetime") -> datetime:
    """Validate a timezone-aware datetime and normalize it to UTC."""
    if not isinstance(value, datetime):
        raise TypeError(f"{name} must be a datetime value")
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError(f"{name} must be timezone-aware")
    return value.astimezone(UTC)


def utcnow() -> datetime:
    """Return the current time as an aware UTC datetime."""
    return datetime.now(UTC)
