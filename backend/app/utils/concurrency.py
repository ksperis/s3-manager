# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from collections.abc import Callable, Sequence
from concurrent.futures import ThreadPoolExecutor
from typing import TypeVar

T = TypeVar("T")
R = TypeVar("R")


def bounded_ordered_map(
    items: Sequence[T],
    worker: Callable[[T], R],
    *,
    max_workers: int,
    thread_name_prefix: str,
) -> list[R]:
    """Run independent network-bound reads in parallel while preserving input order."""
    if not items:
        return []

    worker_count = max(1, min(int(max_workers or 1), len(items)))
    if worker_count <= 1:
        return [worker(item) for item in items]

    with ThreadPoolExecutor(max_workers=worker_count, thread_name_prefix=thread_name_prefix) as executor:
        return list(executor.map(worker, items))
