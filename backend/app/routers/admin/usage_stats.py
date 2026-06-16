# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.core.database import SessionLocal, get_db
from app.db import S3Account, StorageEndpoint, StorageProvider, User
from app.models.bucket_usage_stats import BucketUsageStatsAggregateResponse, BucketUsageStatsScopeRequest
from app.routers.bucket_usage_stats_stream import stream_bucket_usage_stats
from app.routers.dependencies import get_current_super_admin
from app.services.bucket_usage_stats_service import (
    BucketUsageStatsAggregateTarget,
    BucketUsageStatsOptions,
    BucketUsageStatsResolvedTarget,
    BucketUsageStatsService,
)
from app.services.buckets_service import BucketsService, get_buckets_service

router = APIRouter(tags=["admin-bucket-usage-stats"])
logger = logging.getLogger(__name__)


def _resolve_ceph_endpoint(db: Session, endpoint_id: int) -> StorageEndpoint:
    endpoint = db.query(StorageEndpoint).filter(StorageEndpoint.id == endpoint_id).first()
    if not endpoint:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Endpoint not found.")
    try:
        provider = StorageProvider(endpoint.provider)
    except Exception:
        provider = StorageProvider.OTHER
    if provider != StorageProvider.CEPH:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This endpoint is not a Ceph endpoint.")
    return endpoint


def _manager_scope_id(account: S3Account) -> str:
    account_id = getattr(account, "id", None)
    if not isinstance(account_id, int) or account_id <= 0:
        raise ValueError("Managed S3 account is missing a local identifier.")
    return str(account_id)


def _account_label(account: S3Account) -> str:
    return getattr(account, "name", None) or getattr(account, "rgw_account_id", None) or f"Account {account.id}"


def _managed_accounts_for_endpoint(db: Session, endpoint_id: int) -> list[S3Account]:
    return (
        db.query(S3Account)
        .filter(S3Account.storage_endpoint_id == endpoint_id)
        .order_by(S3Account.name.asc(), S3Account.id.asc())
        .all()
    )


def _list_account_bucket_names(account: S3Account, bucket_service: BucketsService) -> list[str]:
    access_key, secret_key = account.effective_rgw_credentials()
    if not access_key or not secret_key:
        raise RuntimeError("S3 account credentials are missing.")
    buckets = bucket_service.list_buckets(account, include=set(), with_stats=False)
    return [bucket.name for bucket in buckets if bucket.name]


def _build_admin_managed_scope(
    *,
    db: Session,
    endpoint: StorageEndpoint,
    bucket_service: BucketsService,
) -> tuple[list[BucketUsageStatsResolvedTarget], list[BucketUsageStatsAggregateTarget], list[str], int, int, int]:
    accounts = _managed_accounts_for_endpoint(db, endpoint.id)
    resolved_targets: list[BucketUsageStatsResolvedTarget] = []
    aggregate_targets: list[BucketUsageStatsAggregateTarget] = []
    warnings: list[str] = []
    skipped_account_count = 0
    accounts_with_listed_buckets = 0

    if not accounts:
        warnings.append("No managed S3 accounts are linked to this endpoint.")

    for account in accounts:
        try:
            bucket_names = _list_account_bucket_names(account, bucket_service)
        except Exception as exc:  # noqa: BLE001
            skipped_account_count += 1
            logger.warning("Unable to list managed account buckets for usage stats account=%s: %s", account.id, exc)
            if skipped_account_count <= 3:
                warnings.append(f"{_account_label(account)} skipped: bucket listing failed.")
            continue

        accounts_with_listed_buckets += 1
        context_id = _manager_scope_id(account)
        for bucket_name in bucket_names:
            resolved_targets.append(
                BucketUsageStatsResolvedTarget(
                    account=account,
                    bucket_name=bucket_name,
                    scope_kind="manager",
                    scope_id=context_id,
                    scope_name=account.name,
                    context_id=context_id,
                    context_name=account.name,
                )
            )
            aggregate_targets.append(
                BucketUsageStatsAggregateTarget(
                    scope_kind="manager",
                    scope_id=context_id,
                    bucket_name=bucket_name,
                )
            )

    if skipped_account_count > 0:
        warnings.insert(0, f"{skipped_account_count} managed account(s) could not be scanned for bucket usage stats.")

    return (
        resolved_targets,
        aggregate_targets,
        warnings,
        len(accounts),
        accounts_with_listed_buckets,
        skipped_account_count,
    )


@router.get("/admin/usage-stats/latest", response_model=BucketUsageStatsAggregateResponse)
def get_admin_managed_usage_stats_aggregate(
    endpoint_id: int = Query(..., alias="endpoint_id"),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_super_admin),
    bucket_service: BucketsService = Depends(get_buckets_service),
) -> BucketUsageStatsAggregateResponse:
    endpoint = _resolve_ceph_endpoint(db, endpoint_id)
    _, aggregate_targets, warnings, managed_account_count, accounts_with_listed_buckets, skipped_account_count = (
        _build_admin_managed_scope(db=db, endpoint=endpoint, bucket_service=bucket_service)
    )
    aggregate = BucketUsageStatsService().get_aggregate_for_targets(
        db,
        scope_kind="admin_managed",
        scope_id=str(endpoint.id),
        scope_name=endpoint.name,
        targets=aggregate_targets,
        warnings=warnings,
        managed_account_count=managed_account_count,
        accounts_with_listed_buckets=accounts_with_listed_buckets,
        skipped_account_count=skipped_account_count,
    )
    return BucketUsageStatsAggregateResponse(aggregate=aggregate)


@router.post("/admin/usage-stats/stream")
def stream_admin_managed_usage_stats_aggregate(
    payload: BucketUsageStatsScopeRequest,
    request: Request,
    endpoint_id: int = Query(..., alias="endpoint_id"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_super_admin),
    bucket_service: BucketsService = Depends(get_buckets_service),
) -> StreamingResponse:
    endpoint = _resolve_ceph_endpoint(db, endpoint_id)
    targets, _, _, _, _, _ = _build_admin_managed_scope(db=db, endpoint=endpoint, bucket_service=bucket_service)
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
        failure_message="Admin managed usage stats calculation failed.",
    )
