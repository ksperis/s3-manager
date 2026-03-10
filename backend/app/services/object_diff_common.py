# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, Literal, Optional

CompareBy = Literal["md5", "size"]


@dataclass(frozen=True)
class ObjectEntryComparison:
    source_size: int
    target_size: int
    source_etag: Optional[str]
    target_etag: Optional[str]
    compare_by: CompareBy
    equal: bool


def _optional_str(value: Any) -> Optional[str]:
    return value if isinstance(value, str) else None


def compare_object_entries(
    source_entry: dict[str, Any],
    target_entry: dict[str, Any],
    *,
    md5_resolver: Callable[[Optional[str]], Optional[str]],
) -> ObjectEntryComparison:
    source_size = int(source_entry.get("size") or 0)
    target_size = int(target_entry.get("size") or 0)
    source_etag = _optional_str(source_entry.get("etag"))
    target_etag = _optional_str(target_entry.get("etag"))

    source_md5 = md5_resolver(source_etag)
    target_md5 = md5_resolver(target_etag)
    if source_md5 and target_md5:
        return ObjectEntryComparison(
            source_size=source_size,
            target_size=target_size,
            source_etag=source_etag,
            target_etag=target_etag,
            compare_by="md5",
            equal=source_md5 == target_md5,
        )

    return ObjectEntryComparison(
        source_size=source_size,
        target_size=target_size,
        source_etag=source_etag,
        target_etag=target_etag,
        compare_by="size",
        equal=source_size == target_size,
    )
