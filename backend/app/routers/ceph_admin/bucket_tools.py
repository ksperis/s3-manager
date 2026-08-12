# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Ceph Admin bucket maintenance, backup, comparison, and object tools."""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.bucket_config_backup import (
    BucketConfigBackupRequest,
    BucketConfigBackupResponse,
    BucketConfigBackupSource,
)
from app.models.ceph_admin import CephAdminBucketCompareRequest, CephAdminBucketCompareResult
from app.models.browser import ListBrowserObjectsResponse
from app.routers.ceph_admin.bucket_listing_cache import invalidate_bucket_listing_cache
from app.routers.ceph_admin.dependencies import (
    CephAdminContext,
    _resolve_storage_endpoint,
    build_ceph_admin_s3_context,
    get_ceph_admin_context,
)
from app.services.bucket_config_backup_service import (
    BucketConfigBackupService,
    quota_from_bucket_summary,
)
from app.services.bucket_listing_enrichment import _build_bucket_summary
from app.services.bucket_owner_enrichment import invalidate_bucket_owner_metadata_cache
from app.services.buckets_service import BucketsService
from app.services.browser_service import BrowserService, get_browser_service
from app.services.rgw_admin import RGWAdminError
from app.services.s3_execution_context import S3ExecutionContext
from app.utils.http_errors import raise_bad_gateway_from_runtime

router = APIRouter()


def _build_endpoint_context_from_credentials(endpoint, access_key: str, secret_key: str) -> S3ExecutionContext:
    return S3ExecutionContext.from_ceph_admin_endpoint(
        endpoint,
        access_key=access_key,
        secret_key=secret_key,
    )


@router.post("/cache/refresh")
def refresh_bucket_listing_cache(
    endpoint_id: int,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> dict[str, object]:
    resolved_endpoint_id = int(getattr(ctx.endpoint, "id", endpoint_id) or endpoint_id)
    invalidate_bucket_listing_cache(resolved_endpoint_id)
    invalidate_bucket_owner_metadata_cache(resolved_endpoint_id)
    return {"refreshed": True, "endpoint_id": resolved_endpoint_id}


@router.post("/config-backup", response_model=BucketConfigBackupResponse)
def backup_bucket_configs(
    payload: BucketConfigBackupRequest,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> BucketConfigBackupResponse:
    service = BucketConfigBackupService(BucketsService())
    account = build_ceph_admin_s3_context(ctx)

    def quota_loader(bucket_name: str) -> dict[str, int | None]:
        try:
            raw = ctx.rgw_admin.get_bucket_info(bucket_name, stats=True, allow_not_found=True)
        except RGWAdminError as exc:
            raise RuntimeError(f"Unable to fetch bucket quota: {exc}") from exc
        if not isinstance(raw, dict):
            raise RuntimeError("Unable to fetch bucket quota: bucket not found")
        summary = _build_bucket_summary(raw)
        return quota_from_bucket_summary(summary)

    return service.build_backup(
        account=account,
        bucket_names=payload.buckets,
        features=payload.features,
        source=BucketConfigBackupSource(
            surface="ceph-admin",
            endpoint_id=ctx.endpoint.id,
            endpoint_name=ctx.endpoint.name,
        ),
        quota_loader=quota_loader,
    )


@router.post("/compare", response_model=CephAdminBucketCompareResult)
def compare_bucket_pair(
    endpoint_id: int,
    payload: CephAdminBucketCompareRequest,
    db: Session = Depends(get_db),
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> CephAdminBucketCompareResult:
    source_account = build_ceph_admin_s3_context(ctx)
    target_endpoint = _resolve_storage_endpoint(db, payload.target_endpoint_id)
    target_access_key = getattr(target_endpoint, "ceph_admin_access_key", None)
    target_secret_key = getattr(target_endpoint, "ceph_admin_secret_key", None)
    if not target_access_key or not target_secret_key:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Target endpoint Ceph Admin credentials are not configured",
        )
    target_account = _build_endpoint_context_from_credentials(
        target_endpoint,
        target_access_key,
        target_secret_key,
    )

    service = BucketsService()
    content_diff = None
    config_diff = None
    try:
        if payload.include_content:
            content_diff = service.compare_bucket_content(
                payload.source_bucket,
                source_account,
                payload.target_bucket,
                target_account,
                ignore_modified_after=payload.ignore_modified_after,
            )
        if payload.include_config:
            config_diff = service.compare_bucket_configuration(
                payload.source_bucket,
                source_account,
                payload.target_bucket,
                target_account,
                include_sections=set(payload.config_features) if payload.config_features is not None else None,
            )
    except RuntimeError as exc:
        raise_bad_gateway_from_runtime(exc)
    has_differences = bool(
        (
            content_diff is not None
            and (
                content_diff.different_count > 0
                or content_diff.only_source_count > 0
                or content_diff.only_target_count > 0
            )
        )
        or (config_diff.changed if config_diff else False)
    )
    return CephAdminBucketCompareResult(
        source_endpoint_id=endpoint_id,
        target_endpoint_id=payload.target_endpoint_id,
        source_bucket=payload.source_bucket,
        target_bucket=payload.target_bucket,
        has_differences=has_differences,
        content_diff=content_diff,
        config_diff=config_diff,
    )


@router.get("/{bucket_name}/objects", response_model=ListBrowserObjectsResponse)
def list_bucket_objects(
    bucket_name: str,
    prefix: str = "",
    continuation_token: str | None = None,
    max_keys: int = Query(default=1000, ge=1, le=1000),
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
    service: BrowserService = Depends(get_browser_service),
) -> ListBrowserObjectsResponse:
    try:
        return service.list_objects(
            bucket_name,
            build_ceph_admin_s3_context(ctx),
            prefix=prefix,
            continuation_token=continuation_token,
            max_keys=max_keys,
        )
    except RuntimeError as exc:
        raise_bad_gateway_from_runtime(exc)

