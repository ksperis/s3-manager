# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Optional


DEFAULT_TAG_COLOR_KEY = "neutral"
TAG_COLOR_KEYS: tuple[str, ...] = (
    "neutral",
    "slate",
    "gray",
    "zinc",
    "stone",
    "red",
    "orange",
    "amber",
    "yellow",
    "lime",
    "green",
    "emerald",
    "teal",
    "cyan",
    "sky",
    "blue",
    "indigo",
    "violet",
    "purple",
    "fuchsia",
    "pink",
    "rose",
)

TAG_DOMAIN_ENDPOINT = "endpoint"
TAG_DOMAIN_ADMIN_MANAGED = "admin_managed"
TAG_DOMAIN_PRIVATE_CONNECTION_USER = "private_connection_user"


def normalize_tag_label(value: object) -> str:
    if not isinstance(value, str):
        raise ValueError("tag label is required.")
    cleaned = value.strip()
    if not cleaned:
        raise ValueError("tag label is required.")
    return cleaned


def build_tag_label_key(label: str) -> str:
    cleaned = normalize_tag_label(label)
    return cleaned.casefold()


def normalize_tag_color_key(value: object) -> str:
    if value is None:
        return DEFAULT_TAG_COLOR_KEY
    if not isinstance(value, str):
        raise ValueError("tag color_key is invalid.")
    cleaned = value.strip().lower()
    if not cleaned:
        return DEFAULT_TAG_COLOR_KEY
    if cleaned not in TAG_COLOR_KEYS:
        raise ValueError("tag color_key is invalid.")
    return cleaned


def _get_mapping_value(entry: object, key: str) -> object:
    if isinstance(entry, dict):
        return entry.get(key)
    return getattr(entry, key, None)


def normalize_tag_item(entry: object) -> dict[str, str]:
    if isinstance(entry, str):
        label = normalize_tag_label(entry)
        return {"label": label, "color_key": DEFAULT_TAG_COLOR_KEY}
    if not isinstance(entry, dict) and not hasattr(entry, "label"):
        raise ValueError("tags must be a list of tag definitions.")
    label = normalize_tag_label(_get_mapping_value(entry, "label"))
    color_key = normalize_tag_color_key(_get_mapping_value(entry, "color_key"))
    return {"label": label, "color_key": color_key}


def normalize_tag_items_input(value: object, *, allow_none: bool = False) -> Optional[list[dict[str, str]]]:
    if value is None:
        return None if allow_none else []
    if not isinstance(value, list):
        raise ValueError("tags must be a list of tag definitions.")
    seen: set[str] = set()
    normalized: list[dict[str, str]] = []
    for item in value:
        if isinstance(item, str) and not item.strip():
            continue
        normalized_item = normalize_tag_item(item)
        label_key = build_tag_label_key(normalized_item["label"])
        if label_key in seen:
            continue
        seen.add(label_key)
        normalized.append(normalized_item)
    return normalized


def extract_tag_labels(items: Optional[list[object]]) -> list[str]:
    normalized = normalize_tag_items_input(items, allow_none=False) or []
    return [item["label"] for item in normalized]


def tag_definition_sort_key(item: object) -> tuple[str, int]:
    label = str(_get_mapping_value(item, "label") or "")
    identifier = _get_mapping_value(item, "id")
    try:
        numeric_id = int(identifier or 0)
    except Exception:
        numeric_id = 0
    return (label.casefold(), numeric_id)
