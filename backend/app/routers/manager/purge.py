# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import StreamingResponse

from app.core.database import SessionLocal
from app.db import S3Account, User
from app.models.bucket_purge import BucketPurgeRequest, BucketPurgeResult, bucket_purge_confirmation_phrase
from app.routers.bucket_purge_stream import stream_bucket_purge
from app.routers.dependencies import (
    get_account_context,
    get_current_account_admin,
    require_bucket_purge_enabled,
)
from app.services.audit_service import AuditService
from app.services.bucket_purge_service import BucketPurgeOptions, BucketPurgeResolvedTarget, BucketPurgeService

router = APIRouter(prefix="/manager/bucket-purge", tags=["manager-bucket-purge"])
logger = logging.getLogger(__name__)


def _require_buckets_payload(payload: BucketPurgeRequest) -> list[str]:
    if payload.targets:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Manager bucket purge expects buckets, not targets.")
    if not payload.buckets:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="At least one bucket is required.")
    expected = bucket_purge_confirmation_phrase(len(payload.buckets))
    if (payload.confirmation or "").strip() != expected:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Confirmation must be exactly '{expected}'.")
    return payload.buckets


def _require_bucket_management_context(account: S3Account) -> None:
    caps = getattr(account, "_manager_capabilities", None)
    if caps is not None and not bool(getattr(caps, "can_manage_buckets", False)):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Bucket management is not allowed for this context")


def _record_audit(
    *,
    user_id: int,
    user_email: str,
    user_role: str,
    request_id: str,
    account: S3Account,
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
            scope="manager",
            action=action,
            entity_type="bucket_purge",
            entity_id=request_id,
            account_id=getattr(account, "id", None) if isinstance(getattr(account, "id", None), int) and account.id > 0 else None,
            account_name=getattr(account, "name", None),
            status=status,
            message=message,
            metadata=metadata,
            request_id=request_id,
        )
    finally:
        db.close()


@router.post("/stream")
def stream_manager_bucket_purge(
    payload: BucketPurgeRequest,
    request: Request,
    tool_user: User = Depends(require_bucket_purge_enabled),
    account: S3Account = Depends(get_account_context),
    _: object = Depends(get_current_account_admin),
) -> StreamingResponse:
    bucket_names = _require_buckets_payload(payload)
    _require_bucket_management_context(account)
    options = BucketPurgeOptions(parallelism=payload.parallelism, include_versions=payload.include_versions)
    context_id = request.query_params.get("account_id")
    context_name = getattr(account, "name", None)
    targets = [
        BucketPurgeResolvedTarget(
            account=account,
            bucket_name=bucket_name,
            context_id=context_id,
            context_name=context_name,
        )
        for bucket_name in bucket_names
    ]
    service = BucketPurgeService()
    base_metadata = {
        "target_count": len(bucket_names),
        "bucket_sample": bucket_names[:20],
        "parallelism": options.parallelism,
        "include_versions": options.include_versions,
        "context_id": context_id,
    }
    actor = {
        "user_id": int(tool_user.id),
        "user_email": str(tool_user.email),
        "user_role": str(tool_user.role),
    }

    def on_start(request_id: str) -> None:
        _record_audit(
            **actor,
            request_id=request_id,
            account=account,
            action="start_bucket_purge",
            metadata=base_metadata,
        )

    def on_result(request_id: str, result: BucketPurgeResult) -> None:
        _record_audit(
            **actor,
            request_id=request_id,
            account=account,
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
            account=account,
            action="cancel_bucket_purge",
            status="failure",
            message="Bucket purge canceled",
            metadata=base_metadata,
        )

    def on_error(request_id: str, detail: str) -> None:
        _record_audit(
            **actor,
            request_id=request_id,
            account=account,
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
        failure_message="Manager bucket purge failed.",
        on_start=on_start,
        on_result=on_result,
        on_cancel=on_cancel,
        on_error=on_error,
    )
