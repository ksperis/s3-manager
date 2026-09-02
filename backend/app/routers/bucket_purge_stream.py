# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import logging
import threading
import uuid
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Any

from fastapi import HTTPException, Request
from fastapi.responses import StreamingResponse

from app.core.database import SessionLocal
from app.db import User
from app.models.bucket_purge import BucketPurgeProgress, BucketPurgeResult
from app.routers.ceph_admin.listing_common import normalize_http_error_detail
from app.routers.sse_worker import (
    SseMessageSender,
    build_sse_progress_callback,
    format_sse_event,
    stream_cancellable_worker,
)
from app.services.audit_service import AuditService
from app.services.bucket_purge_service import BucketPurgeCancelled
from app.services.s3_execution_context import S3ExecutionTarget


def record_bucket_purge_audit(
    *,
    user_id: int,
    user_email: str,
    user_role: str,
    scope: str,
    request_id: str,
    action: str,
    entity_type: str = "bucket_purge",
    entity_id: str | None = None,
    account: S3ExecutionTarget | None = None,
    account_name: str | None = None,
    status: str = "success",
    message: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> None:
    db = SessionLocal()
    try:
        AuditService(db).record_action(
            user=db.get(User, user_id),
            user_email=user_email,
            user_role=user_role,
            scope=scope,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id or request_id,
            account=account,
            account_name=account_name,
            status=status,
            message=message,
            metadata=metadata,
            request_id=request_id,
        )
    finally:
        db.close()


def _result_completed(result: BucketPurgeResult) -> bool:
    return result.status == "completed"


def _standard_result_metadata(result: BucketPurgeResult) -> dict[str, Any]:
    return {
        "result_status": result.status,
        "deleted_objects": result.deleted_objects,
        "deleted_versions": result.deleted_versions,
        "failed_count": result.failed_count,
    }


@dataclass(frozen=True, slots=True)
class BucketPurgeAuditLifecycle:
    record: Callable[..., None]
    base_metadata: Mapping[str, Any]
    start_action: str = "start_bucket_purge"
    result_action: str = "finish_bucket_purge"
    cancel_action: str = "cancel_bucket_purge"
    error_action: str = "fail_bucket_purge"
    cancel_message: str = "Bucket purge canceled"
    result_failure_action: str | None = None
    result_succeeded: Callable[[BucketPurgeResult], bool] = _result_completed
    result_metadata: Callable[[BucketPurgeResult], dict[str, Any]] = _standard_result_metadata
    after_result: Callable[[BucketPurgeResult], None] | None = None

    def on_start(self, request_id: str) -> None:
        self.record(
            request_id=request_id,
            action=self.start_action,
            metadata=dict(self.base_metadata),
        )

    def on_result(self, request_id: str, result: BucketPurgeResult) -> None:
        if self.after_result:
            self.after_result(result)
        succeeded = self.result_succeeded(result)
        action = self.result_action if succeeded or self.result_failure_action is None else self.result_failure_action
        self.record(
            request_id=request_id,
            action=action,
            status="success" if succeeded else "failure",
            metadata={**self.base_metadata, **self.result_metadata(result)},
        )

    def on_cancel(self, request_id: str) -> None:
        self.record(
            request_id=request_id,
            action=self.cancel_action,
            status="failure",
            message=self.cancel_message,
            metadata=dict(self.base_metadata),
        )

    def on_error(self, request_id: str, detail: str) -> None:
        self.record(
            request_id=request_id,
            action=self.error_action,
            status="failure",
            message=detail,
            metadata=dict(self.base_metadata),
        )


def stream_bucket_purge(
    request: Request,
    *,
    run_purge: Callable[[Callable[[BucketPurgeProgress], None], Callable[[], None]], BucketPurgeResult],
    logger: logging.Logger,
    failure_message: str,
    on_start: Callable[[str], None] | None = None,
    on_result: Callable[[str, BucketPurgeResult], None] | None = None,
    on_cancel: Callable[[str], None] | None = None,
    on_error: Callable[[str, str], None] | None = None,
) -> StreamingResponse:
    request_id = uuid.uuid4().hex

    def worker(push_message: SseMessageSender, cancel_event: threading.Event) -> None:
        progress_callback = build_sse_progress_callback(push_message, request_id=request_id)

        def cancel_check() -> None:
            if cancel_event.is_set():
                raise BucketPurgeCancelled()

        try:
            if on_start:
                on_start(request_id)
            result = run_purge(progress_callback, cancel_check)
            if on_result:
                on_result(request_id, result)
            push_message(format_sse_event("result", result.model_dump(mode="json")))
            push_message(format_sse_event("done", {"request_id": request_id, "status": result.status}))
        except BucketPurgeCancelled:
            if on_cancel:
                on_cancel(request_id)
            push_message(format_sse_event("done", {"request_id": request_id, "status": "canceled"}))
        except HTTPException as exc:
            detail = normalize_http_error_detail(exc.detail)
            if on_error:
                on_error(request_id, str(detail))
            push_message(
                format_sse_event(
                    "error",
                    {
                        "request_id": request_id,
                        "detail": detail,
                        "status_code": exc.status_code,
                    },
                )
            )
            push_message(format_sse_event("done", {"request_id": request_id, "status": "failed"}))
        except Exception as exc:  # pragma: no cover
            logger.exception("%s: %s", failure_message, exc)
            if on_error:
                on_error(request_id, failure_message)
            push_message(format_sse_event("error", {"request_id": request_id, "detail": failure_message}))
            push_message(format_sse_event("done", {"request_id": request_id, "status": "failed"}))

    return stream_cancellable_worker(
        request,
        worker=worker,
        logger=logger,
        operation="bucket_purge",
        request_id=request_id,
    )
