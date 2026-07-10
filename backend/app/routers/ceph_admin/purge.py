# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import StreamingResponse

from app.core.database import SessionLocal
from app.db import User
from app.models.bucket_purge import BucketPurgeRequest, BucketPurgeResult, bucket_purge_confirmation_phrase
from app.routers.bucket_purge_stream import stream_bucket_purge
from app.routers.ceph_admin.dependencies import CephAdminContext, get_ceph_admin_context
from app.routers.ceph_admin.integrity import _build_endpoint_account
from app.routers.dependencies import get_current_ceph_admin, require_bucket_purge_global_enabled
from app.services.audit_service import AuditService
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


def _record_audit(
    *,
    user_id: int,
    user_email: str,
    user_role: str,
    request_id: str,
    endpoint_name: str | None,
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
            scope="ceph_admin",
            action=action,
            entity_type="bucket_purge",
            entity_id=request_id,
            account_name=endpoint_name,
            status=status,
            message=message,
            metadata=metadata,
            request_id=request_id,
        )
    finally:
        db.close()


@router.post("/stream")
def stream_ceph_admin_bucket_purge(
    payload: BucketPurgeRequest,
    request: Request,
    _: None = Depends(require_bucket_purge_global_enabled),
    user: User = Depends(get_current_ceph_admin),
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> StreamingResponse:
    bucket_names = _require_buckets_payload(payload)
    account = _build_endpoint_account(ctx)
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
    actor = {
        "user_id": int(user.id),
        "user_email": str(user.email),
        "user_role": str(user.role),
    }

    def on_start(request_id: str) -> None:
        _record_audit(
            **actor,
            request_id=request_id,
            endpoint_name=ctx.endpoint.name,
            action="start_bucket_purge",
            metadata=base_metadata,
        )

    def on_result(request_id: str, result: BucketPurgeResult) -> None:
        _record_audit(
            **actor,
            request_id=request_id,
            endpoint_name=ctx.endpoint.name,
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
            endpoint_name=ctx.endpoint.name,
            action="cancel_bucket_purge",
            status="failure",
            message="Bucket purge canceled",
            metadata=base_metadata,
        )

    def on_error(request_id: str, detail: str) -> None:
        _record_audit(
            **actor,
            request_id=request_id,
            endpoint_name=ctx.endpoint.name,
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
        failure_message="Ceph Admin bucket purge failed.",
        on_start=on_start,
        on_result=on_result,
        on_cancel=on_cancel,
        on_error=on_error,
    )
