# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import logging
from functools import partial

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import StreamingResponse

from app.db import User
from app.models.access_context import ManagerActor
from app.models.bucket_purge import BucketPurgeRequest, bucket_purge_confirmation_phrase
from app.routers.bucket_purge_stream import (
    BucketPurgeAuditLifecycle,
    record_bucket_purge_audit,
    stream_bucket_purge,
)
from app.routers.dependencies import (
    get_account_context,
    get_current_account_admin,
    require_bucket_purge_enabled,
)
from app.routers.manager.access import require_bucket_management_context
from app.services.bucket_purge_service import BucketPurgeOptions, BucketPurgeResolvedTarget, BucketPurgeService
from app.services.s3_execution_context import S3ExecutionContext

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


@router.post("/stream")
def stream_manager_bucket_purge(
    payload: BucketPurgeRequest,
    request: Request,
    tool_user: User = Depends(require_bucket_purge_enabled),
    account: S3ExecutionContext = Depends(get_account_context),
    _: ManagerActor = Depends(get_current_account_admin),
) -> StreamingResponse:
    bucket_names = _require_buckets_payload(payload)
    require_bucket_management_context(account)
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
    audit = BucketPurgeAuditLifecycle(
        record=partial(
            record_bucket_purge_audit,
            user_id=int(tool_user.id),
            user_email=str(tool_user.email),
            user_role=str(tool_user.role),
            scope="manager",
            account=account,
        ),
        base_metadata=base_metadata,
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
        on_start=audit.on_start,
        on_result=audit.on_result,
        on_cancel=audit.on_cancel,
        on_error=audit.on_error,
    )
