# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from collections import OrderedDict
from dataclasses import dataclass

from app.utils.cache import prune_expired_lru_cache


@dataclass
class _Entry:
    expires_at: float


def test_prune_expired_lru_cache_removes_expired_entries_before_capacity_eviction():
    cache = OrderedDict(
        [
            ("oldest", _Entry(expires_at=20)),
            ("expired", _Entry(expires_at=5)),
            ("newest", _Entry(expires_at=30)),
        ]
    )

    prune_expired_lru_cache(cache, now=10, max_entries=1)

    assert list(cache) == ["newest"]
