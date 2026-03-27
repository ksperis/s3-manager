# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import json
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


def validate_string_list_input(value: object, *, allow_none: bool = False) -> Optional[list[str]]:
    if value is None:
        return None if allow_none else []
    if not isinstance(value, list):
        raise ValueError("tags must be a list of strings.")
    if any(not isinstance(entry, str) for entry in value):
        raise ValueError("tags must be a list of strings.")
    return normalize_string_list(value)


def parse_string_list_json(raw: Optional[str]) -> list[str]:
    if not raw:
        return []
    try:
        parsed = json.loads(raw)
    except (TypeError, ValueError, json.JSONDecodeError):
        return []
    if not isinstance(parsed, list):
        return []
    return normalize_string_list([entry for entry in parsed if isinstance(entry, str)])


def dump_string_list_json(values: Optional[list[str]]) -> str:
    return json.dumps(normalize_string_list(values), ensure_ascii=True)
