# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from collections.abc import Callable, Iterable
from concurrent.futures import ThreadPoolExecutor
from typing import TypeVar

T = TypeVar("T")
R = TypeVar("R")


def bounded_ordered_map(
    items: Iterable[T],
    fn: Callable[[T], R],
    *,
    max_workers: int,
    thread_name_prefix: str,
) -> list[R]:
    values = list(items)
    if not values:
        return []
    workers = max(1, min(max_workers, len(values)))
    with ThreadPoolExecutor(max_workers=workers, thread_name_prefix=thread_name_prefix) as executor:
        return list(executor.map(fn, values))
