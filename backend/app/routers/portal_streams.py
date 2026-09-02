# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import logging
import threading
import uuid

from fastapi import Request
from fastapi.responses import StreamingResponse

from app.core.sensitive_data import sanitized_error_log_detail
from app.db import User
from app.models.access_context import AccountAccess
from app.models.portal_versions import PortalDeletedPrefixRestoreProgress, PortalStorageSpaceVersionCleanupProgress
from app.routers.sse_worker import SseMessageSender, format_sse_event, stream_cancellable_worker
from app.services.audit_service import AuditService
from app.services.bucket_purge_service import BucketPurgeCancelled
from app.services.portal.trash_restore import PortalDeletedPrefixRestoreTarget
from app.services.portal.version_cleanup import PortalStorageSpaceVersionCleanupTarget
from app.services.portal_service import PortalService

logger = logging.getLogger(__name__)


def stream_portal_storage_space_version_cleanup(
    request: Request,
    *,
    actor: User,
    access: AccountAccess,
    service: PortalService,
    audit_service: AuditService,
    target: PortalStorageSpaceVersionCleanupTarget,
) -> StreamingResponse:
    request_id = uuid.uuid4().hex
    audit_metadata = {
        "request_id": request_id,
        "storage_space_id": target.storage_space_id,
        "storage_space_name": target.storage_space_name,
        "bucket_name": target.bucket_name,
    }

    def worker(push_message: SseMessageSender, cancel_event: threading.Event) -> None:
        def progress_callback(progress: PortalStorageSpaceVersionCleanupProgress) -> None:
            payload = progress.model_copy(update={"request_id": request_id}).model_dump(mode="json")
            push_message(format_sse_event("progress", payload))

        def cancel_check() -> None:
            if cancel_event.is_set():
                raise BucketPurgeCancelled()

        try:
            audit_service.record_action(
                user=actor,
                scope="portal",
                action="start_storage_space_history_cleanup",
                entity_type="storage_space",
                entity_id=target.storage_space_id,
                account=access.account,
                metadata=audit_metadata,
            )
            result = service.run_storage_space_version_cleanup(
                target,
                progress_callback=progress_callback,
                cancel_check=cancel_check,
            )
            audit_service.record_action(
                user=actor,
                scope="portal",
                action="finish_storage_space_history_cleanup",
                entity_type="storage_space",
                entity_id=target.storage_space_id,
                account=access.account,
                metadata={
                    **audit_metadata,
                    "deleted_versions": result.deleted_versions,
                    "deleted_delete_markers": result.deleted_delete_markers,
                    "bytes_freed": result.bytes_freed,
                },
            )
            push_message(format_sse_event("result", result.model_dump(mode="json")))
            push_message(format_sse_event("done", {"request_id": request_id, "status": result.status}))
        except BucketPurgeCancelled:
            audit_service.record_action(
                user=actor,
                scope="portal",
                action="cancel_storage_space_history_cleanup",
                entity_type="storage_space",
                entity_id=target.storage_space_id,
                account=access.account,
                metadata=audit_metadata,
                status="canceled",
                message="Storage Space history cleanup canceled",
            )
            push_message(format_sse_event("done", {"request_id": request_id, "status": "canceled"}))
        except Exception as exc:  # pragma: no cover - defensive streaming boundary.
            logger.exception("Portal Storage Space history cleanup failed: %s", exc)
            safe_message = sanitized_error_log_detail(exc)
            audit_service.record_action(
                user=actor,
                scope="portal",
                action="fail_storage_space_history_cleanup",
                entity_type="storage_space",
                entity_id=target.storage_space_id,
                account=access.account,
                metadata=audit_metadata,
                status="failed",
                message=safe_message,
            )
            push_message(format_sse_event("error", {"request_id": request_id, "detail": safe_message}))
            push_message(format_sse_event("done", {"request_id": request_id, "status": "failed"}))

    return stream_cancellable_worker(
        request,
        worker=worker,
        logger=logger,
        operation="portal_storage_space_history_cleanup",
        request_id=request_id,
    )


def stream_portal_deleted_prefix_restore(
    request: Request,
    *,
    actor: User,
    access: AccountAccess,
    service: PortalService,
    audit_service: AuditService,
    target: PortalDeletedPrefixRestoreTarget,
) -> StreamingResponse:
    request_id = uuid.uuid4().hex
    audit_metadata = {
        "request_id": request_id,
        "storage_space_id": target.storage_space_id,
        "storage_space_name": target.storage_space_name,
        "bucket_name": target.bucket_name,
        "prefix": target.prefix,
    }

    def worker(push_message: SseMessageSender, cancel_event: threading.Event) -> None:
        def progress_callback(progress: PortalDeletedPrefixRestoreProgress) -> None:
            payload = progress.model_copy(update={"request_id": request_id}).model_dump(mode="json")
            push_message(format_sse_event("progress", payload))

        def cancel_check() -> None:
            if cancel_event.is_set():
                raise BucketPurgeCancelled()

        try:
            audit_service.record_action(
                user=actor,
                scope="portal",
                action="start_restore_deleted_prefix",
                entity_type="storage_space",
                entity_id=target.storage_space_id,
                account=access.account,
                metadata=audit_metadata,
            )
            result = service.run_deleted_prefix_restore(
                target,
                progress_callback=progress_callback,
                cancel_check=cancel_check,
            )
            audit_service.record_action(
                user=actor,
                scope="portal",
                action="finish_restore_deleted_prefix",
                entity_type="storage_space",
                entity_id=target.storage_space_id,
                account=access.account,
                metadata={
                    **audit_metadata,
                    "restore_candidates": result.restore_candidates,
                    "restored_objects": result.restored_objects,
                    "failed_objects": result.failed_objects,
                },
                status="success" if result.status == "completed" else "partial",
            )
            push_message(format_sse_event("result", result.model_dump(mode="json")))
            push_message(format_sse_event("done", {"request_id": request_id, "status": result.status}))
        except BucketPurgeCancelled:
            audit_service.record_action(
                user=actor,
                scope="portal",
                action="cancel_restore_deleted_prefix",
                entity_type="storage_space",
                entity_id=target.storage_space_id,
                account=access.account,
                metadata=audit_metadata,
                status="canceled",
                message="Deleted prefix restoration canceled",
            )
            push_message(format_sse_event("done", {"request_id": request_id, "status": "canceled"}))
        except Exception as exc:  # pragma: no cover - defensive streaming boundary.
            logger.exception("Portal deleted prefix restoration failed: %s", exc)
            safe_message = sanitized_error_log_detail(exc)
            audit_service.record_action(
                user=actor,
                scope="portal",
                action="fail_restore_deleted_prefix",
                entity_type="storage_space",
                entity_id=target.storage_space_id,
                account=access.account,
                metadata=audit_metadata,
                status="failed",
                message=safe_message,
            )
            push_message(format_sse_event("error", {"request_id": request_id, "detail": safe_message}))
            push_message(format_sse_event("done", {"request_id": request_id, "status": "failed"}))

    return stream_cancellable_worker(
        request,
        worker=worker,
        logger=logger,
        operation="portal_deleted_prefix_restore",
        request_id=request_id,
    )
