# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import logging
from typing import Callable, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.sensitive_data import sanitize_error_detail
from app.models.bucket_listing import BucketListingRequest
from app.models.ceph_admin import PaginatedCephAdminBucketsResponse
from app.routers.ceph_admin import bucket_config, bucket_tools
from app.routers.ceph_admin.dependencies import CephAdminContext, get_ceph_admin_context
from app.routers.ceph_admin.listing_common import stream_listing_response
from app.services.bucket_listing_shared import BucketListingFilterError, is_advanced_filter_stream_payload
from app.services.bucket_ui_tags_service import BucketUiTagsService
from app.services.ceph_admin_bucket_listing_service import (
    RequiredBucketStatsUnavailableError,
    compute_ceph_admin_bucket_listing,
)
from app.services.listing_progress import ListingProgressSnapshot
from app.services.rgw_admin import RGWAdminError
from app.utils.http_errors import raise_bad_gateway_from_runtime

router = APIRouter(prefix="/ceph-admin/endpoints/{endpoint_id}/buckets", tags=["ceph-admin-buckets"])
router.include_router(bucket_config.router)
router.include_router(bucket_tools.router)
logger = logging.getLogger(__name__)


@router.get("", response_model=PaginatedCephAdminBucketsResponse)
def list_buckets(
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=200),
    filter: str | None = Query(None),
    advanced_filter: str | None = Query(None),
    sort_by: str = Query("name"),
    sort_dir: str = Query("asc"),
    include: list[str] = Query(default=[]),
    with_stats: bool = True,
    ui_tag_ids: list[int] = Query(default=[]),
    ui_tag_match: Literal["any", "all"] = Query(default="any"),
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
    db: Session = Depends(get_db),
) -> PaginatedCephAdminBucketsResponse:
    return _compute_bucket_listing(
        page=page,
        page_size=page_size,
        filter=filter,
        advanced_filter=advanced_filter,
        sort_by=sort_by,
        sort_dir=sort_dir,
        include=include,
        with_stats=with_stats,
        ui_tag_ids=ui_tag_ids,
        ui_tag_match=ui_tag_match,
        ctx=ctx,
        db=db,
    )


@router.post("/query", response_model=PaginatedCephAdminBucketsResponse)
def query_buckets(
    payload: BucketListingRequest,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
    db: Session = Depends(get_db),
) -> PaginatedCephAdminBucketsResponse:
    return _compute_bucket_listing(
        page=payload.page,
        page_size=payload.page_size,
        filter=payload.filter,
        advanced_filter=payload.advanced_filter,
        sort_by=payload.sort_by,
        sort_dir=payload.sort_dir,
        include=payload.include,
        with_stats=payload.with_stats,
        ui_tag_ids=payload.ui_tag_ids,
        ui_tag_match=payload.ui_tag_match,
        ctx=ctx,
        db=db,
    )


def _compute_bucket_listing(
    *,
    page: int,
    page_size: int,
    filter: str | None,
    advanced_filter: str | None,
    sort_by: str,
    sort_dir: str,
    include: list[str],
    with_stats: bool,
    ui_tag_ids: list[int] | None = None,
    ui_tag_match: str = "any",
    ctx: CephAdminContext,
    db: Session | None = None,
    progress_callback: Callable[[ListingProgressSnapshot], None] | None = None,
    cancel_check: Callable[[], None] | None = None,
) -> PaginatedCephAdminBucketsResponse:
    try:
        actor = getattr(ctx, "actor", None)
        tag_service = BucketUiTagsService(db) if isinstance(db, Session) and actor is not None else None
        return compute_ceph_admin_bucket_listing(
            page=page,
            page_size=page_size,
            filter=filter,
            advanced_filter=advanced_filter,
            sort_by=sort_by,
            sort_dir=sort_dir,
            include=include,
            with_stats=with_stats,
            ui_tag_ids=ui_tag_ids if isinstance(ui_tag_ids, list) else [],
            ui_tag_match=ui_tag_match if ui_tag_match in {"any", "all"} else "any",
            bucket_ui_tags_service=tag_service,
            actor_user_id=int(actor.id) if actor is not None else None,
            ctx=ctx,
            progress_callback=progress_callback,
            cancel_check=cancel_check,
        )
    except BucketListingFilterError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=sanitize_error_detail(str(exc)),
        ) from exc
    except RequiredBucketStatsUnavailableError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=sanitize_error_detail(str(exc)),
        ) from exc
    except RGWAdminError as exc:
        raise_bad_gateway_from_runtime(exc)


@router.get("/stream")
async def stream_buckets(
    request: Request,
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=200),
    filter: str | None = Query(None),
    advanced_filter: str | None = Query(None),
    sort_by: str = Query("name"),
    sort_dir: str = Query("asc"),
    include: list[str] = Query(default=[]),
    with_stats: bool = True,
    ui_tag_ids: list[int] = Query(default=[]),
    ui_tag_match: Literal["any", "all"] = Query(default="any"),
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
    db: Session = Depends(get_db),
) -> StreamingResponse:
    if not is_advanced_filter_stream_payload(advanced_filter):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="advanced_filter must be provided as a JSON payload for streaming search",
        )

    return stream_listing_response(
        request,
        compute=lambda progress_callback, cancel_check: _compute_bucket_listing(
            page=page,
            page_size=page_size,
            filter=filter,
            advanced_filter=advanced_filter,
            sort_by=sort_by,
            sort_dir=sort_dir,
            include=include,
            with_stats=with_stats,
            ui_tag_ids=ui_tag_ids,
            ui_tag_match=ui_tag_match,
            ctx=ctx,
            db=db,
            progress_callback=progress_callback,
            cancel_check=cancel_check,
        ),
        logger=logger,
        failure_message="Bucket streaming search failed",
    )
