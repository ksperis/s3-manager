# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import asyncio
import json
import logging
import threading
import uuid
from typing import Callable

from fastapi import HTTPException, Request
from fastapi.responses import StreamingResponse

from app.models.bucket_usage_stats import BucketUsageStatsProgress, BucketUsageStatsResult
from app.routers.ceph_admin.listing_common import normalize_http_error_detail
from app.routers.sse_worker import wait_for_cancellable_worker
from app.services.bucket_usage_stats_service import BucketUsageStatsCancelled

SSE_KEEPALIVE_INTERVAL_SECONDS = 10.0


def format_sse_event(event: str, payload: dict[str, object]) -> str:
    payload_json = json.dumps(payload, separators=(",", ":"), ensure_ascii=False, default=str)
    lines = [f"event: {event}"]
    for line in payload_json.splitlines() or [payload_json]:
        lines.append(f"data: {line}")
    lines.append("")
    return "\n".join(lines) + "\n"


def stream_bucket_usage_stats(
    request: Request,
    *,
    run_check: Callable[[Callable[[BucketUsageStatsProgress], None], Callable[[], None]], BucketUsageStatsResult],
    logger: logging.Logger,
    failure_message: str,
) -> StreamingResponse:
    request_id = uuid.uuid4().hex

    async def event_generator():
        loop = asyncio.get_running_loop()
        queue: asyncio.Queue[str | None] = asyncio.Queue()
        cancel_event = threading.Event()

        def push_message(payload: str | None) -> None:
            loop.call_soon_threadsafe(queue.put_nowait, payload)

        def progress_callback(progress: BucketUsageStatsProgress) -> None:
            payload = progress.model_copy(update={"request_id": request_id}).model_dump(mode="json")
            push_message(format_sse_event("progress", payload))

        def cancel_check() -> None:
            if cancel_event.is_set():
                raise BucketUsageStatsCancelled()

        def worker() -> None:
            try:
                result = run_check(progress_callback, cancel_check)
                push_message(format_sse_event("result", result.model_dump(mode="json")))
                push_message(format_sse_event("done", {"request_id": request_id, "status": result.status}))
            except BucketUsageStatsCancelled:
                push_message(format_sse_event("done", {"request_id": request_id, "status": "canceled"}))
            except HTTPException as exc:
                push_message(
                    format_sse_event(
                        "error",
                        {
                            "request_id": request_id,
                            "detail": normalize_http_error_detail(exc.detail),
                            "status_code": exc.status_code,
                        },
                    )
                )
                push_message(format_sse_event("done", {"request_id": request_id, "status": "failed"}))
            except Exception as exc:  # pragma: no cover
                logger.exception("%s: %s", failure_message, exc)
                push_message(format_sse_event("error", {"request_id": request_id, "detail": failure_message}))
                push_message(format_sse_event("done", {"request_id": request_id, "status": "failed"}))
            finally:
                push_message(None)

        worker_task = asyncio.create_task(asyncio.to_thread(worker))
        try:
            while True:
                if await request.is_disconnected():
                    cancel_event.set()
                    break
                try:
                    message = await asyncio.wait_for(queue.get(), timeout=SSE_KEEPALIVE_INTERVAL_SECONDS)
                except asyncio.TimeoutError:
                    if await request.is_disconnected():
                        cancel_event.set()
                        break
                    yield ": keepalive\n\n"
                    continue
                if message is None:
                    break
                yield message
        finally:
            await wait_for_cancellable_worker(
                worker_task,
                cancel_event,
                logger=logger,
                operation="bucket_usage_stats",
                request_id=request_id,
            )

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
