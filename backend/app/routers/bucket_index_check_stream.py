# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import logging
import threading
import uuid
from typing import Callable

from fastapi import HTTPException, Request
from fastapi.responses import StreamingResponse

from app.models.ceph_admin import CephAdminBucketIndexCheckBatchProgress, CephAdminBucketIndexCheckBatchResult
from app.routers.ceph_admin.listing_common import normalize_http_error_detail
from app.routers.sse_worker import (
    SseMessageSender,
    build_sse_progress_callback,
    format_sse_event,
    stream_cancellable_worker,
)
from app.services.bucket_index_check_service import BucketIndexCheckCancelled

def stream_bucket_index_checks(
    request: Request,
    *,
    run_check: Callable[
        [Callable[[CephAdminBucketIndexCheckBatchProgress], None], Callable[[], None]],
        CephAdminBucketIndexCheckBatchResult,
    ],
    logger: logging.Logger,
) -> StreamingResponse:
    request_id = uuid.uuid4().hex

    def worker(push_message: SseMessageSender, cancel_event: threading.Event) -> None:
        progress_callback = build_sse_progress_callback(push_message, request_id=request_id)

        def cancel_check() -> None:
            if cancel_event.is_set():
                raise BucketIndexCheckCancelled()

        try:
            result = run_check(progress_callback, cancel_check)
            push_message(format_sse_event("result", result.model_dump(mode="json")))
            push_message(format_sse_event("done", {"request_id": request_id, "status": result.status}))
        except BucketIndexCheckCancelled:
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
        except Exception:  # pragma: no cover
            logger.exception("Ceph Admin bucket index checks failed.")
            push_message(
                format_sse_event(
                    "error",
                    {"request_id": request_id, "detail": "Ceph Admin bucket index checks failed."},
                )
            )
            push_message(format_sse_event("done", {"request_id": request_id, "status": "failed"}))

    return stream_cancellable_worker(
        request,
        worker=worker,
        logger=logger,
        operation="bucket_index_check",
        request_id=request_id,
    )
