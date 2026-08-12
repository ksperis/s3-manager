# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import JSONResponse, StreamingResponse

from app.models.ceph_admin import (
    CephAdminAdminOpsResult,
    CephAdminBucketIndexCheckBatchRequest,
    CephAdminBucketIndexCheckRequest,
)
from app.routers.bucket_index_check_stream import stream_bucket_index_checks
from app.routers.ceph_admin.admin_ops_common import (
    execute_admin_operation as _execute,
    invalidate_bucket_admin_ops_caches,
    qualified_bucket,
    require_confirmation,
)
from app.routers.ceph_admin.dependencies import CephAdminContext, get_ceph_admin_context
from app.services.bucket_index_check_service import (
    BucketIndexCheckService,
    execute_bucket_index_check_operation,
)

router = APIRouter()
logger = logging.getLogger(__name__)


@router.post("/buckets/{bucket}/index-check", response_model=CephAdminAdminOpsResult)
def check_bucket_index(
    bucket: str,
    payload: CephAdminBucketIndexCheckRequest,
    tenant: Optional[str] = Query(default=None),
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> JSONResponse:
    operation = "check_bucket_index"
    action = "ceph_admin.bucket.index_check"
    target = qualified_bucket(bucket, tenant)
    if payload.fix:
        require_confirmation(
            ctx,
            actual=payload.confirmation,
            expected=f"FIX BUCKET INDEX {target}",
            action=action,
            entity_type="rgw_bucket",
            entity_id=target,
        )
    options = {"fix": payload.fix, "check_objects": payload.check_objects}
    return _execute(
        ctx,
        operation=operation,
        action=action,
        entity_type="rgw_bucket",
        entity_id=target,
        call=lambda: execute_bucket_index_check_operation(
            ctx.rgw_admin,
            bucket=bucket,
            tenant=tenant,
            fix=payload.fix,
            check_objects=payload.check_objects,
        ),
        metadata={"options": options},
        invalidate=invalidate_bucket_admin_ops_caches,
    )


@router.post("/bucket-index-check/stream")
def stream_bucket_index_check_batch(
    payload: CephAdminBucketIndexCheckBatchRequest,
    request: Request,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> StreamingResponse:
    service = BucketIndexCheckService()

    def run_check(progress_callback, cancel_check):
        result = service.run(
            ctx.rgw_admin,
            payload.targets,
            endpoint_id=int(ctx.endpoint.id),
            endpoint_name=ctx.endpoint.name,
            parallelism=payload.parallelism,
            progress_callback=progress_callback,
            cancel_check=cancel_check,
        )
        invalidate_bucket_admin_ops_caches(int(ctx.endpoint.id))
        return result

    return stream_bucket_index_checks(request, run_check=run_check, logger=logger)
