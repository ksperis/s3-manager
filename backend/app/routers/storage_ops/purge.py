# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.core.database import SessionLocal, get_db
from app.db import User
from app.models.bucket_purge import BucketPurgeRequest, BucketPurgeResult, bucket_purge_confirmation_phrase
from app.routers.bucket_purge_stream import stream_bucket_purge
from app.routers.dependencies import get_account_context, get_current_storage_ops_admin, require_bucket_purge_global_enabled
from app.routers.execution_contexts import list_execution_contexts
from app.services.audit_service import AuditService
from app.services.bucket_purge_service import BucketPurgeOptions, BucketPurgeResolvedTarget, BucketPurgeService

router = APIRouter(prefix="/storage-ops/buckets/purge", tags=["storage-ops-bucket-purge"])
logger = logging.getLogger(__name__)


def _require_targets_payload(payload: BucketPurgeRequest):
    if payload.buckets:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Storage Ops bucket purge expects targets, not buckets.")
    if not payload.targets:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="At least one target is required.")
    expected = bucket_purge_confirmation_phrase(len(payload.targets))
    if (payload.confirmation or "").strip() != expected:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Confirmation must be exactly '{expected}'.")
    return payload.targets


def _record_audit(
    *,
    user_id: int,
    user_email: str,
    user_role: str,
    request_id: str,
    action: str,
    status: str = "success",
    message: str | None = None,
    metadata: dict | None = None,
) -> None:
    db = SessionLocal()
    try:
        user = db.get(User, user_id)
        AuditService(db).record_action(
            user=user,
            user_email=user_email,
            user_role=user_role,
            scope="storage_ops",
            action=action,
            entity_type="bucket_purge",
            entity_id=request_id,
            status=status,
            message=message,
            metadata=metadata,
            request_id=request_id,
        )
    finally:
        db.close()


@router.post("/stream")
def stream_storage_ops_bucket_purge(
    payload: BucketPurgeRequest,
    request: Request,
    _: None = Depends(require_bucket_purge_global_enabled),
    user: User = Depends(get_current_storage_ops_admin),
    db: Session = Depends(get_db),
) -> StreamingResponse:
    requested_targets = _require_targets_payload(payload)
    contexts = list_execution_contexts(workspace="manager", user=user, db=db)
    context_names = {context.id: context.display_name for context in contexts}
    options = BucketPurgeOptions(parallelism=payload.parallelism, include_versions=payload.include_versions)
    targets = [
        BucketPurgeResolvedTarget(
            account=get_account_context(
                request=request,
                account_ref=target.context_id,
                actor=user,
                db=db,
            ),
            bucket_name=target.bucket_name,
            context_id=target.context_id,
            context_name=context_names.get(target.context_id) or target.context_id,
        )
        for target in requested_targets
    ]
    service = BucketPurgeService()
    base_metadata = {
        "target_count": len(requested_targets),
        "bucket_sample": [target.bucket_name for target in requested_targets[:20]],
        "parallelism": options.parallelism,
        "include_versions": options.include_versions,
        "context_sample": [target.context_id for target in requested_targets[:20]],
    }
    actor = {
        "user_id": int(user.id),
        "user_email": str(user.email),
        "user_role": str(user.role),
    }

    def on_start(request_id: str) -> None:
        _record_audit(**actor, request_id=request_id, action="start_bucket_purge", metadata=base_metadata)

    def on_result(request_id: str, result: BucketPurgeResult) -> None:
        _record_audit(
            **actor,
            request_id=request_id,
            action="finish_bucket_purge",
            status="success" if result.status == "completed" else "failure",
            metadata={
                **base_metadata,
                "result_status": result.status,
                "deleted_objects": result.deleted_objects,
                "deleted_versions": result.deleted_versions,
                "failed_count": result.failed_count,
            },
        )

    def on_cancel(request_id: str) -> None:
        _record_audit(
            **actor,
            request_id=request_id,
            action="cancel_bucket_purge",
            status="failure",
            message="Bucket purge canceled",
            metadata=base_metadata,
        )

    def on_error(request_id: str, detail: str) -> None:
        _record_audit(
            **actor,
            request_id=request_id,
            action="fail_bucket_purge",
            status="failure",
            message=detail,
            metadata=base_metadata,
        )

    return stream_bucket_purge(
        request,
        run_purge=lambda progress_callback, cancel_check: service.run(
            targets,
            options,
            progress_callback=progress_callback,
            cancel_check=cancel_check,
        ),
        logger=logger,
        failure_message="Storage Ops bucket purge failed.",
        on_start=on_start,
        on_result=on_result,
        on_cancel=on_cancel,
        on_error=on_error,
    )
