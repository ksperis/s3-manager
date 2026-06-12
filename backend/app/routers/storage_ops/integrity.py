# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.db import User
from app.models.bucket_integrity import BucketIntegrityCheckRequest
from app.routers.bucket_integrity_stream import stream_bucket_integrity_check
from app.routers.dependencies import get_account_context, get_current_storage_ops_admin
from app.routers.execution_contexts import list_execution_contexts
from app.services.bucket_integrity_service import (
    BucketIntegrityCheckService,
    BucketIntegrityOptions,
    BucketIntegrityResolvedTarget,
)

router = APIRouter(prefix="/storage-ops/buckets/integrity-check", tags=["storage-ops-bucket-integrity"])
logger = logging.getLogger(__name__)


def _require_targets_payload(payload: BucketIntegrityCheckRequest):
    if payload.buckets:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Storage Ops integrity check expects targets, not buckets.",
        )
    if not payload.targets:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="At least one target is required.")
    return payload.targets


@router.post("/stream")
def stream_storage_ops_bucket_integrity_check(
    payload: BucketIntegrityCheckRequest,
    request: Request,
    user: User = Depends(get_current_storage_ops_admin),
    db: Session = Depends(get_db),
) -> StreamingResponse:
    requested_targets = _require_targets_payload(payload)
    contexts = list_execution_contexts(workspace="manager", user=user, db=db)
    context_names = {context.id: context.display_name for context in contexts}
    options = BucketIntegrityOptions(
        parallelism=payload.parallelism,
        all_versions=payload.all_versions,
        check_mode=payload.check_mode,
        since=payload.since,
        max_mb_per_object=payload.max_mb_per_object,
    )
    targets = [
        BucketIntegrityResolvedTarget(
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
        failure_message="Storage Ops bucket integrity check failed.",
    )
