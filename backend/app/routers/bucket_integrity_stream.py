# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import logging
import threading
import uuid
from typing import Callable

from fastapi import HTTPException, Request
from fastapi.responses import StreamingResponse

from app.models.bucket_integrity import BucketIntegrityCheckProgress, BucketIntegrityCheckResult
from app.routers.ceph_admin.listing_common import normalize_http_error_detail
from app.routers.sse_worker import (
    SseMessageSender,
    build_sse_progress_callback,
    format_sse_event,
    stream_cancellable_worker,
)
from app.services.bucket_integrity_service import BucketIntegrityCheckCancelled

def stream_bucket_integrity_check(
    request: Request,
    *,
    run_check: Callable[[Callable[[BucketIntegrityCheckProgress], None], Callable[[], None]], BucketIntegrityCheckResult],
    logger: logging.Logger,
    failure_message: str,
) -> StreamingResponse:
    request_id = uuid.uuid4().hex

    def worker(push_message: SseMessageSender, cancel_event: threading.Event) -> None:
        progress_callback = build_sse_progress_callback(push_message, request_id=request_id)

        def cancel_check() -> None:
            if cancel_event.is_set():
                raise BucketIntegrityCheckCancelled()

        try:
            result = run_check(progress_callback, cancel_check)
            push_message(format_sse_event("result", result.model_dump(mode="json")))
            push_message(format_sse_event("done", {"request_id": request_id, "status": result.status}))
        except BucketIntegrityCheckCancelled:
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

    return stream_cancellable_worker(
        request,
        worker=worker,
        logger=logger,
        operation="bucket_integrity_check",
        request_id=request_id,
    )
