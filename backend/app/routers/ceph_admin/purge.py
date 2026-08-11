# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import logging
from functools import partial

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import StreamingResponse

from app.db import User
from app.models.bucket_purge import BucketPurgeRequest, bucket_purge_confirmation_phrase
from app.routers.bucket_purge_stream import (
    BucketPurgeAuditLifecycle,
    record_bucket_purge_audit,
    stream_bucket_purge,
)
from app.routers.ceph_admin.dependencies import (
    CephAdminContext,
    build_ceph_admin_s3_context,
    get_ceph_admin_context,
)
from app.routers.dependencies import get_current_ceph_admin, require_bucket_purge_global_enabled
from app.services.bucket_purge_service import BucketPurgeOptions, BucketPurgeResolvedTarget, BucketPurgeService

router = APIRouter(prefix="/ceph-admin/endpoints/{endpoint_id}/buckets/purge", tags=["ceph-admin-bucket-purge"])
logger = logging.getLogger(__name__)


def _require_buckets_payload(payload: BucketPurgeRequest) -> list[str]:
    if payload.targets:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Ceph Admin bucket purge expects buckets, not targets.")
    if not payload.buckets:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="At least one bucket is required.")
    expected = bucket_purge_confirmation_phrase(len(payload.buckets))
    if (payload.confirmation or "").strip() != expected:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Confirmation must be exactly '{expected}'.")
    return payload.buckets


@router.post("/stream")
def stream_ceph_admin_bucket_purge(
    payload: BucketPurgeRequest,
    request: Request,
    _: None = Depends(require_bucket_purge_global_enabled),
    user: User = Depends(get_current_ceph_admin),
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> StreamingResponse:
    bucket_names = _require_buckets_payload(payload)
    account = build_ceph_admin_s3_context(ctx)
    options = BucketPurgeOptions(
        parallelism=payload.parallelism,
        include_versions=payload.include_versions,
        individual_deletes=True,
    )
    context_id = f"ceph-admin-{ctx.endpoint.id}"
    targets = [
        BucketPurgeResolvedTarget(
            account=account,
            bucket_name=bucket_name,
            context_id=context_id,
            context_name=ctx.endpoint.name,
        )
        for bucket_name in bucket_names
    ]
    service = BucketPurgeService()
    base_metadata = {
        "target_count": len(bucket_names),
        "bucket_sample": bucket_names[:20],
        "parallelism": options.parallelism,
        "include_versions": options.include_versions,
        "delete_strategy": "individual",
        "endpoint_id": ctx.endpoint.id,
        "endpoint_name": ctx.endpoint.name,
    }
    audit = BucketPurgeAuditLifecycle(
        record=partial(
            record_bucket_purge_audit,
            user_id=int(user.id),
            user_email=str(user.email),
            user_role=str(user.role),
            scope="ceph_admin",
            account_name=ctx.endpoint.name,
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
        failure_message="Ceph Admin bucket purge failed.",
        on_start=audit.on_start,
        on_result=audit.on_result,
        on_cancel=audit.on_cancel,
        on_error=audit.on_error,
    )
