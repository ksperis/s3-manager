# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import StreamingResponse

from app.models.bucket_integrity import BucketIntegrityCheckRequest
from app.routers.bucket_integrity_stream import stream_bucket_integrity_check
from app.routers.ceph_admin.dependencies import (
    CephAdminContext,
    get_ceph_admin_context,
)
from app.services.s3_execution_context import build_ceph_admin_s3_context
from app.services.bucket_integrity_service import (
    BucketIntegrityCheckService,
    BucketIntegrityOptions,
    BucketIntegrityResolvedTarget,
)

router = APIRouter(
    prefix="/ceph-admin/endpoints/{endpoint_id}/buckets/integrity-check",
    tags=["ceph-admin-bucket-integrity"],
)
logger = logging.getLogger(__name__)


def _require_buckets_payload(payload: BucketIntegrityCheckRequest) -> list[str]:
    if payload.targets:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Ceph Admin integrity check expects buckets, not targets.",
        )
    if not payload.buckets:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="At least one bucket is required.")
    return payload.buckets


@router.post("/stream")
def stream_ceph_admin_bucket_integrity_check(
    payload: BucketIntegrityCheckRequest,
    request: Request,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> StreamingResponse:
    bucket_names = _require_buckets_payload(payload)
    account = build_ceph_admin_s3_context(ctx)
    options = BucketIntegrityOptions(
        parallelism=payload.parallelism,
        all_versions=payload.all_versions,
        check_mode=payload.check_mode,
        since=payload.since,
        max_mb_per_object=payload.max_mb_per_object,
    )
    targets = [
        BucketIntegrityResolvedTarget(
            account=account,
            bucket_name=bucket_name,
            context_id=f"ceph-admin-{ctx.endpoint.id}",
            context_name=ctx.endpoint.name,
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
        failure_message="Ceph Admin bucket integrity check failed.",
    )
