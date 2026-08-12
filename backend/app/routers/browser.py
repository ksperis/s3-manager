# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""User-facing S3 browser endpoints.

These endpoints back the `/browser` surface.

They are credential-first and can be used with:
- RGW accounts (account-centric) for members with bucket permissions
- S3 users (when explicitly linked)
- User-scoped S3 connections (selector `conn-<id>`)
- Ceph Admin endpoint context (selector `ceph-admin-<endpoint_id>`)

The endpoints reuse the existing `account_id` selector and context resolution
logic implemented in :func:`app.routers.dependencies.get_account_context`.
"""

from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.db import User
from app.models.access_context import ManagerActor
from app.models.app_settings import BrowserSettings
from app.models.base import ApiModel
from app.models.bucket import BucketVersioningStatus
from app.models.browser import (
    BrowserBucket,
    BrowserObjectSortBy,
    BrowserUsageSummary,
    BrowserObjectSortDir,
    BucketCorsStatus,
    ListBrowserObjectsResponse,
    ObjectColumnsRequest,
    ObjectColumnsResponse,
    PaginatedBrowserBucketsResponse,
    SseCustomerContext,
)
from app.routers import browser_bucket_config, browser_objects, browser_transfers
from app.routers.browser_common import EnsureCorsPayload
from app.utils.http_errors import raise_bad_gateway_from_runtime
from app.routers.dependencies import (
    get_account_context,
    get_audit_service,
    get_current_account_admin,
    get_optional_sse_customer_context,
    require_portal_browser_basic_route,
    require_browser_workspace_surface,
)
from app.services.app_settings_service import load_app_settings
from app.services.audit_service import AuditService
from app.services.browser_service import BrowserService, get_browser_service
from app.services.browser_usage_summary_service import (
    BrowserUsageSummaryService,
    get_browser_usage_summary_service,
)
from app.services.s3_execution_context import S3ExecutionContext

router = APIRouter(
    prefix="/browser",
    tags=["browser"],
    dependencies=[
        Depends(require_portal_browser_basic_route),
        Depends(require_browser_workspace_surface),
    ],
)
router.include_router(browser_bucket_config.router)
router.include_router(browser_objects.router)
router.include_router(browser_transfers.router)


class CreateBucketPayload(ApiModel):
    name: str
    versioning: bool = False


@router.get("/settings", response_model=BrowserSettings)
def get_browser_settings(_: ManagerActor = Depends(get_current_account_admin)) -> BrowserSettings:
    return load_app_settings().browser


def get_browser_usage_service(db: Session = Depends(get_db)) -> BrowserUsageSummaryService:
    return get_browser_usage_summary_service(db)


@router.get("/buckets", response_model=list[BrowserBucket], response_model_exclude_none=True)
def list_buckets(
    account: S3ExecutionContext = Depends(get_account_context),
    service: BrowserService = Depends(get_browser_service),
    _: ManagerActor = Depends(get_current_account_admin),
) -> list[BrowserBucket]:
    try:
        return service.list_buckets(account)
    except RuntimeError as exc:
        raise_bad_gateway_from_runtime(exc)

@router.get(
    "/buckets/search",
    response_model=PaginatedBrowserBucketsResponse,
    response_model_exclude_none=True,
)
def search_buckets(
    search: Optional[str] = None,
    exact: bool = Query(default=False),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    account: S3ExecutionContext = Depends(get_account_context),
    service: BrowserService = Depends(get_browser_service),
    _: ManagerActor = Depends(get_current_account_admin),
) -> PaginatedBrowserBucketsResponse:
    try:
        return service.search_buckets(
            account,
            search=search,
            exact=exact,
            page=page,
            page_size=page_size,
        )
    except RuntimeError as exc:
        raise_bad_gateway_from_runtime(exc)


@router.get(
    "/usage-summary",
    response_model=BrowserUsageSummary,
    response_model_exclude_none=True,
)
def get_usage_summary(
    account: S3ExecutionContext = Depends(get_account_context),
    service: BrowserUsageSummaryService = Depends(get_browser_usage_service),
    _: ManagerActor = Depends(get_current_account_admin),
) -> BrowserUsageSummary:
    return service.build(account)


@router.post("/buckets", status_code=status.HTTP_201_CREATED)
def create_bucket(
    payload: CreateBucketPayload,
    account: S3ExecutionContext = Depends(get_account_context),
    service: BrowserService = Depends(get_browser_service),
    actor: ManagerActor = Depends(get_current_account_admin),
    audit_service: AuditService = Depends(get_audit_service),
) -> dict[str, Any]:
    bucket_name = payload.name.strip()
    if not bucket_name:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Bucket name is required")
    try:
        service.create_bucket(bucket_name, account, versioning=payload.versioning)
        audit_service.record_action(
            user=actor,
            scope="browser",
            action="create_bucket",
            entity_type="bucket",
            entity_id=bucket_name,
            account=account,
            metadata={"versioning": bool(payload.versioning)},
        )
        return {
            "message": f"Bucket '{bucket_name}' created",
            "name": bucket_name,
            "versioning": bool(payload.versioning),
        }
    except RuntimeError as exc:
        raise_bad_gateway_from_runtime(exc)


@router.get("/buckets/{bucket_name}/versioning", response_model=BucketVersioningStatus)
def get_bucket_versioning(
    bucket_name: str,
    account: S3ExecutionContext = Depends(get_account_context),
    service: BrowserService = Depends(get_browser_service),
    _: ManagerActor = Depends(get_current_account_admin),
) -> BucketVersioningStatus:
    try:
        status_value = service.get_bucket_versioning(bucket_name, account)
        enabled = status_value == "Enabled"
        return BucketVersioningStatus(status=status_value, enabled=enabled)
    except RuntimeError as exc:
        raise_bad_gateway_from_runtime(exc)


@router.get("/buckets/{bucket_name}/objects", response_model=ListBrowserObjectsResponse)
def list_objects(
    bucket_name: str,
    prefix: str = "",
    continuation_token: Optional[str] = None,
    max_keys: int = Query(default=1000, ge=1, le=1000),
    query: Optional[str] = None,
    query_exact: bool = Query(default=False),
    query_case_sensitive: bool = Query(default=False),
    item_type: Optional[str] = None,
    storage_class: Optional[str] = None,
    recursive: bool = Query(default=False),
    sort_by: BrowserObjectSortBy = Query(default="name"),
    sort_dir: BrowserObjectSortDir = Query(default="asc"),
    force_refresh: bool = Query(default=False),
    account: S3ExecutionContext = Depends(get_account_context),
    service: BrowserService = Depends(get_browser_service),
    _: ManagerActor = Depends(get_current_account_admin),
) -> ListBrowserObjectsResponse:
    try:
        return service.list_objects(
            bucket_name,
            account,
            prefix=prefix,
            continuation_token=continuation_token,
            max_keys=max_keys,
            query=query,
            query_exact=query_exact,
            query_case_sensitive=query_case_sensitive,
            item_type=item_type,
            storage_class=storage_class,
            recursive=recursive,
            sort_by=sort_by,
            sort_dir=sort_dir,
            force_refresh=force_refresh,
        )
    except RuntimeError as exc:
        raise_bad_gateway_from_runtime(exc)


@router.post("/buckets/{bucket_name}/objects/columns", response_model=ObjectColumnsResponse)
def get_object_columns(
    bucket_name: str,
    payload: ObjectColumnsRequest,
    account: S3ExecutionContext = Depends(get_account_context),
    service: BrowserService = Depends(get_browser_service),
    sse_customer: Optional[SseCustomerContext] = Depends(get_optional_sse_customer_context),
    _: ManagerActor = Depends(get_current_account_admin),
) -> ObjectColumnsResponse:
    try:
        return service.get_object_columns(
            bucket_name,
            account,
            keys=payload.keys,
            columns=set(payload.columns),
            sse_customer=sse_customer,
        )
    except RuntimeError as exc:
        raise_bad_gateway_from_runtime(exc)


@router.get("/buckets/{bucket_name}/cors", response_model=BucketCorsStatus)
def get_bucket_cors(
    bucket_name: str,
    origin: Optional[str] = None,
    account: S3ExecutionContext = Depends(get_account_context),
    service: BrowserService = Depends(get_browser_service),
    _: ManagerActor = Depends(get_current_account_admin),
) -> BucketCorsStatus:
    return service.get_bucket_cors_status(bucket_name, account, origin=origin)


@router.post("/buckets/{bucket_name}/cors/ensure", response_model=BucketCorsStatus)
def ensure_bucket_cors(
    bucket_name: str,
    payload: EnsureCorsPayload,
    account: S3ExecutionContext = Depends(get_account_context),
    service: BrowserService = Depends(get_browser_service),
    actor: ManagerActor = Depends(get_current_account_admin),
    audit_service: AuditService = Depends(get_audit_service),
) -> BucketCorsStatus:
    if not payload.origin:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing origin")
    try:
        status_result = service.ensure_bucket_cors(bucket_name, account, payload.origin)
        audit_service.record_action(
            user=actor,
            scope="browser",
            action="ensure_bucket_cors",
            entity_type="bucket",
            entity_id=bucket_name,
            account=account,
            metadata={"origin": payload.origin},
        )
        return status_result
    except RuntimeError as exc:
        raise_bad_gateway_from_runtime(exc)
