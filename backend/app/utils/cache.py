# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from collections import OrderedDict
from typing import Protocol, TypeVar


class ExpiringCacheEntry(Protocol):
    expires_at: float


_KeyT = TypeVar("_KeyT")
_EntryT = TypeVar("_EntryT", bound=ExpiringCacheEntry)


def prune_expired_lru_cache(
    cache: OrderedDict[_KeyT, _EntryT],
    *,
    now: float,
    max_entries: int,
) -> None:
    expired = [key for key, entry in cache.items() if entry.expires_at <= now]
    for key in expired:
        cache.pop(key, None)
    while len(cache) > max_entries:
        cache.popitem(last=False)
