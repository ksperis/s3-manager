# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import StreamingResponse

from app.db import S3Account
from app.models.bucket_integrity import BucketIntegrityCheckRequest
from app.routers.bucket_integrity_stream import stream_bucket_integrity_check
from app.routers.dependencies import (
    get_account_context,
    get_current_account_admin,
    require_bucket_integrity_check_enabled,
)
from app.services.bucket_integrity_service import (
    BucketIntegrityCheckService,
    BucketIntegrityOptions,
    BucketIntegrityResolvedTarget,
)

router = APIRouter(prefix="/manager/bucket-integrity", tags=["manager-bucket-integrity"])
logger = logging.getLogger(__name__)


def _require_buckets_payload(payload: BucketIntegrityCheckRequest) -> list[str]:
    if payload.targets:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Manager integrity check expects buckets, not targets.",
        )
    if not payload.buckets:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="At least one bucket is required.")
    return payload.buckets


def _require_bucket_management_context(account: S3Account) -> None:
    caps = getattr(account, "_manager_capabilities", None)
    if caps is not None and not bool(getattr(caps, "can_manage_buckets", False)):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Bucket management is not allowed for this context")


@router.post("/stream")
def stream_manager_bucket_integrity_check(
    payload: BucketIntegrityCheckRequest,
    request: Request,
    _tool_user: object = Depends(require_bucket_integrity_check_enabled),
    account: S3Account = Depends(get_account_context),
    _: object = Depends(get_current_account_admin),
) -> StreamingResponse:
    bucket_names = _require_buckets_payload(payload)
    _require_bucket_management_context(account)
    options = BucketIntegrityOptions(
        parallelism=payload.parallelism,
        all_versions=payload.all_versions,
        since=payload.since,
        max_mb_per_object=payload.max_mb_per_object,
    )
    context_id = request.query_params.get("account_id")
    context_name = getattr(account, "name", None)
    targets = [
        BucketIntegrityResolvedTarget(
            account=account,
            bucket_name=bucket_name,
            context_id=context_id,
            context_name=context_name,
        )
        for bucket_name in bucket_names
    ]
    service = BucketIntegrityCheckService()
    return stream_bucket_integrity_check(
        request,
        run_check=lambda progress_callback, cancel_check: service.run(
            targets,
            options,
            progress_callback=progress_callback,
            cancel_check=cancel_check,
        ),
        logger=logger,
        failure_message="Manager bucket integrity check failed.",
    )
