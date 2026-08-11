# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import asyncio
from collections.abc import Callable
import json
import logging
import threading

from fastapi import Request
from fastapi.responses import StreamingResponse

SSE_KEEPALIVE_INTERVAL_SECONDS = 10.0
SSE_RESPONSE_HEADERS = {
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
}
SseMessageSender = Callable[[str], None]
SseWorker = Callable[[SseMessageSender, threading.Event], None]


def format_sse_event(event: str, payload: dict[str, object]) -> str:
    payload_json = json.dumps(
        payload,
        separators=(",", ":"),
        ensure_ascii=False,
        default=str,
    )
    lines = [f"event: {event}"]
    lines.extend(f"data: {line}" for line in payload_json.splitlines() or [payload_json])
    lines.append("")
    return "\n".join(lines) + "\n"


async def wait_for_cancellable_worker(
    worker_task: asyncio.Task,
    cancel_event: threading.Event,
    *,
    logger: logging.Logger,
    operation: str,
    request_id: str,
) -> None:
    cancel_event.set()
    try:
        await asyncio.shield(worker_task)
    except asyncio.CancelledError:
        raise
    except Exception:  # noqa: BLE001
        logger.debug(
            "SSE worker cleanup failed after cancellation",
            extra={"operation": operation, "request_id": request_id},
            exc_info=True,
        )


def stream_cancellable_worker(
    request: Request,
    *,
    worker: SseWorker,
    logger: logging.Logger,
    operation: str,
    request_id: str,
) -> StreamingResponse:
    async def event_generator():
        loop = asyncio.get_running_loop()
        queue: asyncio.Queue[str | None] = asyncio.Queue()
        cancel_event = threading.Event()

        def push_message(payload: str | None) -> None:
            loop.call_soon_threadsafe(queue.put_nowait, payload)

        def run_worker() -> None:
            try:
                worker(push_message, cancel_event)
            finally:
                push_message(None)

        worker_task = asyncio.create_task(asyncio.to_thread(run_worker))
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
                operation=operation,
                request_id=request_id,
            )

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers=SSE_RESPONSE_HEADERS,
    )
