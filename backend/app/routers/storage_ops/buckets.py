# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import logging
from typing import Callable, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.sensitive_data import sanitize_error_detail
from app.db import User
from app.models.ceph_admin import CephAdminBucketListingRequest
from app.models.storage_ops import PaginatedStorageOpsBucketsResponse
from app.routers.ceph_admin.listing_common import stream_listing_response
from app.routers.dependencies import (
    get_account_context,
    get_current_storage_ops_admin,
)
from app.routers.execution_contexts import list_execution_contexts
from app.services.bucket_listing_cache import invalidate_bucket_listing_cache_for_account
from app.services.bucket_listing_shared import BucketListingFilterError, is_advanced_filter_stream_payload
from app.services.bucket_owner_enrichment import invalidate_bucket_owner_metadata_cache
from app.services.buckets_service import BucketsService, get_buckets_service
from app.services.listing_progress import ListingProgressSnapshot
from app.services.s3_execution_context import S3ExecutionContext
from app.services.storage_ops_bucket_listing_service import (
    StorageOpsContextRef,
    build_storage_ops_context_refs,
    compute_storage_ops_bucket_listing,
    resolve_storage_ops_contexts,
)

router = APIRouter(prefix="/storage-ops/buckets", tags=["storage-ops-buckets"])
logger = logging.getLogger(__name__)


def _collect_context_refs(user: User, db: Session) -> list[StorageOpsContextRef]:
    contexts = list_execution_contexts(workspace="manager", user=user, db=db)
    return build_storage_ops_context_refs(contexts)


def _resolve_context_account(
    ref: StorageOpsContextRef,
    *,
    request: Request,
    db: Session,
    user: User,
) -> S3ExecutionContext | None:
    try:
        return get_account_context(request=request, account_ref=ref.context_id, actor=user, db=db)
    except HTTPException as exc:
        if exc.status_code in {status.HTTP_403_FORBIDDEN, status.HTTP_404_NOT_FOUND}:
            return None
        raise


def _compute_storage_ops_listing(
    *,
    request: Request,
    db: Session,
    user: User,
    service: BucketsService,
    page: int,
    page_size: int,
    filter: str | None,
    advanced_filter: str | None,
    sort_by: str,
    sort_dir: str,
    include: list[str],
    with_stats: bool,
    progress_callback: Callable[[ListingProgressSnapshot], None] | None = None,
    cancel_check: Callable[[], None] | None = None,
) -> PaginatedStorageOpsBucketsResponse:
    try:
        return compute_storage_ops_bucket_listing(
            load_context_refs=lambda: _collect_context_refs(user, db),
            resolve_account=lambda ref: _resolve_context_account(
                ref,
                request=request,
                db=db,
                user=user,
            ),
            service=service,
            page=page,
            page_size=page_size,
            filter=filter,
            advanced_filter=advanced_filter,
            sort_by=sort_by,
            sort_dir=sort_dir,
            include=include,
            with_stats=with_stats,
            progress_callback=progress_callback,
            cancel_check=cancel_check,
        )
    except BucketListingFilterError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=sanitize_error_detail(str(exc)),
        ) from exc


@router.post("/cache/refresh")
def refresh_storage_ops_bucket_listing_cache(
    request: Request,
    user: User = Depends(get_current_storage_ops_admin),
    db: Session = Depends(get_db),
) -> dict[str, object]:
    refs = _collect_context_refs(user, db)
    resolved_contexts = resolve_storage_ops_contexts(
        refs=refs,
        resolve_account=lambda ref: _resolve_context_account(
            ref,
            request=request,
            db=db,
            user=user,
        ),
    )
    endpoint_ids: set[int] = set()
    for context in resolved_contexts:
        invalidate_bucket_listing_cache_for_account(context.account)
        endpoint_id = int(getattr(getattr(context.account, "storage_endpoint", None), "id", 0) or 0)
        if endpoint_id > 0:
            endpoint_ids.add(endpoint_id)
    for endpoint_id in endpoint_ids:
        invalidate_bucket_owner_metadata_cache(endpoint_id)
    return {"refreshed": True, "contexts": len(resolved_contexts), "endpoints": len(endpoint_ids)}


@router.get("", response_model=PaginatedStorageOpsBucketsResponse)
def list_storage_ops_buckets(
    request: Request,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=200),
    filter: str | None = Query(default=None),
    advanced_filter: str | None = Query(default=None),
    sort_by: str = Query(default="name"),
    sort_dir: Literal["asc", "desc"] = Query(default="asc"),
    include: list[str] = Query(default=[]),
    with_stats: bool = Query(default=True),
    user: User = Depends(get_current_storage_ops_admin),
    db: Session = Depends(get_db),
    service: BucketsService = Depends(get_buckets_service),
) -> PaginatedStorageOpsBucketsResponse:
    return _compute_storage_ops_listing(
        request=request,
        db=db,
        user=user,
        service=service,
        page=page,
        page_size=page_size,
        filter=filter,
        advanced_filter=advanced_filter,
        sort_by=sort_by,
        sort_dir=sort_dir,
        include=include,
        with_stats=with_stats,
    )


@router.post("/query", response_model=PaginatedStorageOpsBucketsResponse)
def query_storage_ops_buckets(
    payload: CephAdminBucketListingRequest,
    request: Request,
    user: User = Depends(get_current_storage_ops_admin),
    db: Session = Depends(get_db),
    service: BucketsService = Depends(get_buckets_service),
) -> PaginatedStorageOpsBucketsResponse:
    return _compute_storage_ops_listing(
        request=request,
        db=db,
        user=user,
        service=service,
        page=payload.page,
        page_size=payload.page_size,
        filter=payload.filter,
        advanced_filter=payload.advanced_filter,
        sort_by=payload.sort_by,
        sort_dir=payload.sort_dir,
        include=payload.include,
        with_stats=payload.with_stats,
    )


@router.get("/stream")
async def stream_storage_ops_buckets(
    request: Request,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=200),
    filter: str | None = Query(default=None),
    advanced_filter: str | None = Query(default=None),
    sort_by: str = Query(default="name"),
    sort_dir: Literal["asc", "desc"] = Query(default="asc"),
    include: list[str] = Query(default=[]),
    with_stats: bool = Query(default=True),
    user: User = Depends(get_current_storage_ops_admin),
    db: Session = Depends(get_db),
    service: BucketsService = Depends(get_buckets_service),
) -> StreamingResponse:
    if not is_advanced_filter_stream_payload(advanced_filter):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="advanced_filter must be provided as a JSON payload for streaming search",
        )

    return stream_listing_response(
        request,
        compute=lambda progress_callback, cancel_check: _compute_storage_ops_listing(
            request=request,
            db=db,
            user=user,
            service=service,
            page=page,
            page_size=page_size,
            filter=filter,
            advanced_filter=advanced_filter,
            sort_by=sort_by,
            sort_dir=sort_dir,
            include=include,
            with_stats=with_stats,
            progress_callback=progress_callback,
            cancel_check=cancel_check,
        ),
        logger=logger,
        failure_message="Storage Ops bucket streaming failed",
    )
