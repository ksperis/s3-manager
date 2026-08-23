# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from typing import Optional

from app.db import StorageProvider


def normalize_optional_string(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized or None


def normalize_optional_scalar(value: object) -> str | None:
    if value is None:
        return None
    normalized = str(value).strip()
    return normalized or None


def normalize_text(value: object) -> str:
    return str(value or "").strip().lower()


def normalize_storage_provider(provider: object) -> StorageProvider:
    if isinstance(provider, StorageProvider):
        return provider
    if not isinstance(provider, str):
        raise ValueError("Storage provider must be 'ceph', 'aws', or 'other'.")
    try:
        return StorageProvider(str(provider).strip().lower())
    except ValueError as exc:
        raise ValueError(
            f"Unsupported storage provider: {provider!r}."
        ) from exc


def normalize_string_list(values: Optional[list[str]]) -> list[str]:
    if not values:
        return []
    seen: set[str] = set()
    normalized: list[str] = []
    for entry in values:
        if not isinstance(entry, str):
            continue
        cleaned = entry.strip()
        if not cleaned or cleaned in seen:
            continue
        seen.add(cleaned)
        normalized.append(cleaned)
    return normalized
