# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.core.database import SessionLocal, get_db
from app.db import User
from app.models.bucket_usage_stats import (
    BucketUsageStatsAggregateResponse,
    BucketUsageStatsLatestResponse,
    BucketUsageStatsRequest,
    BucketUsageStatsScopeRequest,
)
from app.routers.bucket_usage_stats_stream import stream_bucket_usage_stats
from app.routers.ceph_admin.dependencies import (
    CephAdminContext,
    build_ceph_admin_s3_context,
    get_ceph_admin_context,
)
from app.routers.ceph_admin.buckets import _get_cached_rgw_bucket_entries
from app.routers.dependencies import get_current_ceph_admin
from app.utils.http_errors import sanitize_error_detail
from app.services.bucket_usage_stats_service import (
    BucketUsageStatsOptions,
    BucketUsageStatsResolvedTarget,
    BucketUsageStatsService,
)

router = APIRouter(tags=["ceph-admin-bucket-usage-stats"])
logger = logging.getLogger(__name__)


def _require_buckets_payload(payload: BucketUsageStatsRequest) -> list[str]:
    if payload.targets:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Ceph Admin usage stats expects buckets, not targets.",
        )
    if not payload.buckets:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="At least one bucket is required.")
    return payload.buckets


def _target_for_bucket(ctx: CephAdminContext, bucket_name: str) -> BucketUsageStatsResolvedTarget:
    account = build_ceph_admin_s3_context(ctx)
    context_id = f"ceph-admin-{ctx.endpoint.id}"
    return BucketUsageStatsResolvedTarget(
        account=account,
        bucket_name=bucket_name,
        scope_kind="ceph_admin",
        scope_id=str(ctx.endpoint.id),
        scope_name=ctx.endpoint.name,
        context_id=context_id,
        context_name=ctx.endpoint.name,
    )


def _list_ceph_bucket_names(ctx: CephAdminContext) -> list[str]:
    try:
        entries = _get_cached_rgw_bucket_entries(ctx, with_stats=False)
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=sanitize_error_detail(str(exc))) from exc
    names: list[str] = []
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        raw_name = entry.get("bucket") or entry.get("name")
        if isinstance(raw_name, str) and raw_name.strip():
            names.append(raw_name.strip())
    return list(dict.fromkeys(names))


@router.get("/ceph-admin/endpoints/{endpoint_id}/usage-stats/latest", response_model=BucketUsageStatsAggregateResponse)
def get_ceph_admin_usage_stats_aggregate(
    db: Session = Depends(get_db),
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> BucketUsageStatsAggregateResponse:
    bucket_names = _list_ceph_bucket_names(ctx)
    aggregate = BucketUsageStatsService().get_aggregate(
        db,
        scope_kind="ceph_admin",
        scope_id=str(ctx.endpoint.id),
        scope_name=ctx.endpoint.name,
        bucket_names=bucket_names,
    )
    return BucketUsageStatsAggregateResponse(aggregate=aggregate)


@router.post("/ceph-admin/endpoints/{endpoint_id}/usage-stats/stream")
def stream_ceph_admin_usage_stats_aggregate(
    payload: BucketUsageStatsScopeRequest,
    request: Request,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
    user: User = Depends(get_current_ceph_admin),
) -> StreamingResponse:
    bucket_names = _list_ceph_bucket_names(ctx)
    targets = [_target_for_bucket(ctx, bucket_name) for bucket_name in bucket_names]
    service = BucketUsageStatsService(SessionLocal)
    return stream_bucket_usage_stats(
        request,
        run_check=lambda progress_callback, cancel_check: service.run(
            targets,
            BucketUsageStatsOptions(parallelism=payload.parallelism),
            progress_callback=progress_callback,
            cancel_check=cancel_check,
            actor_user=user,
            actor_email=user.email,
            actor_role=user.role,
        ),
        logger=logger,
        failure_message="Ceph Admin usage stats calculation failed.",
    )


@router.get("/ceph-admin/endpoints/{endpoint_id}/buckets/{bucket_name}/usage-stats", response_model=BucketUsageStatsLatestResponse)
def get_ceph_admin_bucket_usage_stats(
    bucket_name: str,
    db: Session = Depends(get_db),
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> BucketUsageStatsLatestResponse:
    snapshot = BucketUsageStatsService().get_latest(
        db,
        scope_kind="ceph_admin",
        scope_id=str(ctx.endpoint.id),
        bucket_name=bucket_name,
    )
    return BucketUsageStatsLatestResponse(snapshot=snapshot)


@router.post("/ceph-admin/endpoints/{endpoint_id}/buckets/{bucket_name}/usage-stats/stream")
def stream_ceph_admin_bucket_usage_stats_for_bucket(
    bucket_name: str,
    request: Request,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
    user: User = Depends(get_current_ceph_admin),
) -> StreamingResponse:
    target = _target_for_bucket(ctx, bucket_name)
    service = BucketUsageStatsService(SessionLocal)
    return stream_bucket_usage_stats(
        request,
        run_check=lambda progress_callback, cancel_check: service.run(
            [target],
            BucketUsageStatsOptions(parallelism=1),
            progress_callback=progress_callback,
            cancel_check=cancel_check,
            actor_user=user,
            actor_email=user.email,
            actor_role=user.role,
        ),
        logger=logger,
        failure_message="Ceph Admin bucket usage stats calculation failed.",
    )


@router.post("/ceph-admin/endpoints/{endpoint_id}/bucket-usage-stats/stream")
def stream_ceph_admin_bucket_usage_stats(
    payload: BucketUsageStatsRequest,
    request: Request,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
    user: User = Depends(get_current_ceph_admin),
) -> StreamingResponse:
    bucket_names = _require_buckets_payload(payload)
    options = BucketUsageStatsOptions(parallelism=payload.parallelism)
    targets = [_target_for_bucket(ctx, bucket_name) for bucket_name in bucket_names]
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
        failure_message="Ceph Admin bucket usage stats calculation failed.",
    )
