# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import logging
from typing import Callable

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import StreamingResponse

from app.models.ceph_admin import (
    CephAdminRgwAccountSummary,
    PaginatedCephAdminAccountsResponse,
)
from app.routers.ceph_admin.account_listing import compute_accounts_listing
from app.routers.ceph_admin.dependencies import (
    CephAdminContext,
    get_ceph_admin_context,
)
from app.routers.ceph_admin.listing_common import stream_listing_response
from app.services.bucket_listing_shared import is_advanced_filter_stream_payload
from app.services.listing_progress import ListingProgressSnapshot

router = APIRouter(
    prefix="/ceph-admin/endpoints/{endpoint_id}/accounts",
    tags=["ceph-admin-accounts"],
)
logger = logging.getLogger(__name__)


def _compute_accounts_listing(
    *,
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=200),
    search: str | None = Query(None),
    advanced_filter: str | None = Query(None),
    sort_by: str = Query("account_id"),
    sort_dir: str = Query("asc"),
    include: list[str] = Query(default=[]),
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
    progress_callback: Callable[[ListingProgressSnapshot], None] | None = None,
    cancel_check: Callable[[], None] | None = None,
) -> PaginatedCephAdminAccountsResponse:
    return compute_accounts_listing(
        page=page,
        page_size=page_size,
        search=search,
        advanced_filter=advanced_filter,
        sort_by=sort_by,
        sort_dir=sort_dir,
        include=include,
        ctx=ctx,
        progress_callback=progress_callback,
        cancel_check=cancel_check,
    )


@router.get("", response_model=PaginatedCephAdminAccountsResponse)
def list_rgw_accounts(
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=200),
    search: str | None = Query(None),
    advanced_filter: str | None = Query(None),
    sort_by: str = Query("account_id"),
    sort_dir: str = Query("asc"),
    include: list[str] = Query(default=[]),
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> PaginatedCephAdminAccountsResponse:
    return _compute_accounts_listing(
        page=page,
        page_size=page_size,
        search=search,
        advanced_filter=advanced_filter,
        sort_by=sort_by,
        sort_dir=sort_dir,
        include=include,
        ctx=ctx,
    )


@router.get("/stream")
async def stream_rgw_accounts(
    request: Request,
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=200),
    search: str | None = Query(None),
    advanced_filter: str | None = Query(None),
    sort_by: str = Query("account_id"),
    sort_dir: str = Query("asc"),
    include: list[str] = Query(default=[]),
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> StreamingResponse:
    if not is_advanced_filter_stream_payload(advanced_filter):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "advanced_filter must be provided as a JSON payload for "
                "streaming search"
            ),
        )

    return stream_listing_response(
        request,
        compute=lambda progress_callback, cancel_check: _compute_accounts_listing(
            page=page,
            page_size=page_size,
            search=search,
            advanced_filter=advanced_filter,
            sort_by=sort_by,
            sort_dir=sort_dir,
            include=include,
            ctx=ctx,
            progress_callback=progress_callback,
            cancel_check=cancel_check,
        ),
        logger=logger,
        failure_message="RGW accounts streaming search failed",
    )
