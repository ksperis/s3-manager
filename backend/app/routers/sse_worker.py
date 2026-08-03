# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import asyncio
import json
import logging
import threading

SSE_KEEPALIVE_INTERVAL_SECONDS = 10.0


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
