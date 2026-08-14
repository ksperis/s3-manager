# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from dataclasses import dataclass
from time import monotonic
from typing import Callable

PROGRESS_EMIT_EVERY_ITEMS = 100
PROGRESS_EMIT_MIN_INTERVAL_SECONDS = 0.2


@dataclass(frozen=True)
class ListingProgressSnapshot:
    percent: int
    stage: str
    processed: int
    total: int
    message: str | None = None


class ListingCancelled(RuntimeError):
    pass


class ListingProgressEmitter:
    def __init__(self, callback: Callable[[ListingProgressSnapshot], None] | None) -> None:
        self._callback = callback
        self._last_emitted_at = 0.0
        self._last_snapshot: ListingProgressSnapshot | None = None

    def emit(
        self,
        *,
        percent: int,
        stage: str,
        processed: int = 0,
        total: int = 0,
        message: str | None = None,
        force: bool = False,
    ) -> None:
        if self._callback is None:
            return
        clamped_percent = max(0, min(100, int(percent)))
        if self._last_snapshot is not None:
            clamped_percent = max(clamped_percent, self._last_snapshot.percent)
        snapshot = ListingProgressSnapshot(
            percent=clamped_percent,
            stage=stage,
            processed=max(0, int(processed)),
            total=max(0, int(total)),
            message=message,
        )
        now = monotonic()
        if not force:
            is_progress_tick = snapshot.processed > 0 and (snapshot.processed % PROGRESS_EMIT_EVERY_ITEMS == 0)
            interval_elapsed = (now - self._last_emitted_at) >= PROGRESS_EMIT_MIN_INTERVAL_SECONDS
            if snapshot == self._last_snapshot:
                return
            if not is_progress_tick and not interval_elapsed and snapshot.processed != snapshot.total:
                return
        self._last_emitted_at = now
        self._last_snapshot = snapshot
        self._callback(snapshot)


def invoke_cancel_check(cancel_check: Callable[[], None] | None) -> None:
    if cancel_check is None:
        return
    cancel_check()


def interpolate_progress_percent(start: int, end: int, *, processed: int, total: int) -> int:
    clamped_start = max(0, min(100, int(start)))
    clamped_end = max(clamped_start, min(100, int(end)))
    safe_total = max(0, int(total))
    if safe_total <= 0:
        return clamped_start
    safe_processed = max(0, min(safe_total, int(processed)))
    span = clamped_end - clamped_start
    return clamped_start + round((span * safe_processed) / safe_total)


def build_listing_progress_callback(
    progress: ListingProgressEmitter | None,
    *,
    stage: str,
    message: str,
    start: int,
    end: int,
    total: int,
) -> Callable[[int], None]:
    def emit(processed: int) -> None:
        if progress is None:
            return
        progress.emit(
            percent=interpolate_progress_percent(start, end, processed=processed, total=total),
            stage=stage,
            processed=processed,
            total=total,
            message=message,
        )

    return emit
