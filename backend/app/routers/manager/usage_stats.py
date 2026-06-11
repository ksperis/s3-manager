# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.core.database import SessionLocal, get_db
from app.db import S3Account, User
from app.models.bucket_usage_stats import (
    BucketUsageStatsAggregateResponse,
    BucketUsageStatsLatestResponse,
    BucketUsageStatsScopeRequest,
)
from app.routers.bucket_usage_stats_stream import stream_bucket_usage_stats
from app.routers.dependencies import (
    get_account_context,
    get_current_account_admin,
    require_bucket_usage_stats_enabled,
)
from app.routers.http_errors import raise_bad_gateway_from_runtime
from app.routers.manager.buckets import _context_id_from_account
from app.services.bucket_listing_cache import get_cached_bucket_listing_for_account
from app.services.bucket_usage_stats_service import (
    BucketUsageStatsOptions,
    BucketUsageStatsResolvedTarget,
    BucketUsageStatsService,
)
from app.services.buckets_service import BucketsService, get_buckets_service

router = APIRouter(tags=["manager-bucket-usage-stats"])
logger = logging.getLogger(__name__)


def _require_bucket_management_context(account: S3Account) -> None:
    caps = getattr(account, "_manager_capabilities", None)
    if caps is not None and not bool(getattr(caps, "can_manage_buckets", False)):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Bucket management is not allowed for this context")


def _target_for_bucket(account: S3Account, bucket_name: str, *, context_id: str | None = None) -> BucketUsageStatsResolvedTarget:
    resolved_context_id = context_id or _context_id_from_account(account)
    context_name = getattr(account, "name", None)
    return BucketUsageStatsResolvedTarget(
        account=account,
        bucket_name=bucket_name,
        scope_kind="manager",
        scope_id=resolved_context_id,
        scope_name=context_name,
        context_id=resolved_context_id,
        context_name=context_name,
    )


def _list_manager_bucket_names(account: S3Account, service: BucketsService) -> list[str]:
    try:
        buckets = get_cached_bucket_listing_for_account(
            account=account,
            include=set(),
            with_stats=False,
            builder=lambda: service.list_buckets(account, include=set(), with_stats=False),
        )
    except RuntimeError as exc:
        raise_bad_gateway_from_runtime(exc)
    return [bucket.name for bucket in buckets if bucket.name]


@router.get("/manager/usage-stats/latest", response_model=BucketUsageStatsAggregateResponse)
def get_manager_usage_stats_aggregate(
    db: Session = Depends(get_db),
    _feature_user: object = Depends(require_bucket_usage_stats_enabled),
    account: S3Account = Depends(get_account_context),
    _: object = Depends(get_current_account_admin),
    bucket_service: BucketsService = Depends(get_buckets_service),
) -> BucketUsageStatsAggregateResponse:
    _require_bucket_management_context(account)
    context_id = _context_id_from_account(account)
    bucket_names = _list_manager_bucket_names(account, bucket_service)
    aggregate = BucketUsageStatsService().get_aggregate(
        db,
        scope_kind="manager",
        scope_id=context_id,
        scope_name=getattr(account, "name", None),
        bucket_names=bucket_names,
    )
    return BucketUsageStatsAggregateResponse(aggregate=aggregate)


@router.post("/manager/usage-stats/stream")
def stream_manager_usage_stats_aggregate(
    payload: BucketUsageStatsScopeRequest,
    request: Request,
    _feature_user: object = Depends(require_bucket_usage_stats_enabled),
    account: S3Account = Depends(get_account_context),
    actor: object = Depends(get_current_account_admin),
    bucket_service: BucketsService = Depends(get_buckets_service),
) -> StreamingResponse:
    _require_bucket_management_context(account)
    context_id = _context_id_from_account(account)
    bucket_names = _list_manager_bucket_names(account, bucket_service)
    targets = [_target_for_bucket(account, bucket_name, context_id=context_id) for bucket_name in bucket_names]
    service = BucketUsageStatsService(SessionLocal)
    return stream_bucket_usage_stats(
        request,
        run_check=lambda progress_callback, cancel_check: service.run(
            targets,
            BucketUsageStatsOptions(parallelism=payload.parallelism),
            progress_callback=progress_callback,
            cancel_check=cancel_check,
            actor_user=actor if isinstance(actor, User) else None,
            actor_email=getattr(actor, "email", None),
            actor_role=getattr(actor, "role", None),
        ),
        logger=logger,
        failure_message="Manager usage stats calculation failed.",
    )


@router.get("/manager/buckets/{bucket_name}/usage-stats", response_model=BucketUsageStatsLatestResponse)
def get_manager_bucket_usage_stats(
    bucket_name: str,
    db: Session = Depends(get_db),
    account: S3Account = Depends(get_account_context),
    _: object = Depends(get_current_account_admin),
) -> BucketUsageStatsLatestResponse:
    _require_bucket_management_context(account)
    context_id = _context_id_from_account(account)
    snapshot = BucketUsageStatsService().get_latest(
        db,
        scope_kind="manager",
        scope_id=context_id,
        bucket_name=bucket_name,
    )
    return BucketUsageStatsLatestResponse(snapshot=snapshot)


@router.post("/manager/buckets/{bucket_name}/usage-stats/stream")
def stream_manager_bucket_usage_stats_for_bucket(
    bucket_name: str,
    request: Request,
    account: S3Account = Depends(get_account_context),
    actor: object = Depends(get_current_account_admin),
) -> StreamingResponse:
    _require_bucket_management_context(account)
    context_id = request.query_params.get("account_id") or _context_id_from_account(account)
    target = _target_for_bucket(account, bucket_name, context_id=context_id)
    service = BucketUsageStatsService(SessionLocal)
    return stream_bucket_usage_stats(
        request,
        run_check=lambda progress_callback, cancel_check: service.run(
            [target],
            BucketUsageStatsOptions(parallelism=1),
            progress_callback=progress_callback,
            cancel_check=cancel_check,
            actor_user=actor if isinstance(actor, User) else None,
            actor_email=getattr(actor, "email", None),
            actor_role=getattr(actor, "role", None),
        ),
        logger=logger,
        failure_message="Manager bucket usage stats calculation failed.",
    )
