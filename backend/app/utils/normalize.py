# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from typing import Optional

from app.db import StorageProvider


def normalize_storage_provider(provider: Optional[object]) -> StorageProvider:
    if provider is None:
        return StorageProvider.CEPH
    if isinstance(provider, StorageProvider):
        return provider
    try:
        return StorageProvider(str(provider))
    except Exception:
        return StorageProvider.CEPH


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
