# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.core.database import SessionLocal, get_db
from app.db import User
from app.models.bucket_usage_stats import BucketUsageStatsRequest
from app.routers.bucket_usage_stats_stream import stream_bucket_usage_stats
from app.routers.dependencies import get_account_context, get_current_storage_ops_admin
from app.routers.execution_contexts import list_execution_contexts
from app.routers.manager.buckets import _context_id_from_account
from app.services.bucket_usage_stats_service import (
    BucketUsageStatsOptions,
    BucketUsageStatsResolvedTarget,
    BucketUsageStatsService,
)

router = APIRouter(prefix="/storage-ops/buckets/usage-stats", tags=["storage-ops-bucket-usage-stats"])
logger = logging.getLogger(__name__)


def _require_targets_payload(payload: BucketUsageStatsRequest):
    if payload.buckets:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Storage Ops usage stats expects targets, not buckets.",
        )
    if not payload.targets:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="At least one target is required.")
    return payload.targets


@router.post("/stream")
def stream_storage_ops_bucket_usage_stats(
    payload: BucketUsageStatsRequest,
    request: Request,
    user: User = Depends(get_current_storage_ops_admin),
    db: Session = Depends(get_db),
) -> StreamingResponse:
    requested_targets = _require_targets_payload(payload)
    contexts = list_execution_contexts(workspace="manager", user=user, db=db)
    context_names = {context.id: context.display_name for context in contexts}
    options = BucketUsageStatsOptions(parallelism=payload.parallelism)
    targets = []
    for target in requested_targets:
        account = get_account_context(
            request=request,
            account_ref=target.context_id,
            actor=user,
            db=db,
        )
        resolved_context_id = _context_id_from_account(account)
        context_name = context_names.get(target.context_id) or context_names.get(resolved_context_id) or resolved_context_id
        targets.append(
            BucketUsageStatsResolvedTarget(
                account=account,
                bucket_name=target.bucket_name,
                scope_kind="manager",
                scope_id=resolved_context_id,
                scope_name=context_name,
                context_id=resolved_context_id,
                context_name=context_name,
            )
        )
    service = BucketUsageStatsService(SessionLocal)
    return stream_bucket_usage_stats(
        request,
        run_check=lambda progress_callback, cancel_check: service.run(
            targets,
            options,
            progress_callback=progress_callback,
            cancel_check=cancel_check,
            actor_user=user,
            actor_email=user.email,
            actor_role=user.role,
        ),
        logger=logger,
        failure_message="Storage Ops bucket usage stats calculation failed.",
    )
