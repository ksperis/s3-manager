# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import asyncio
import logging
import threading


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
