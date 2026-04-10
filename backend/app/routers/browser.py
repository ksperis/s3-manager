# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""User-facing S3 browser endpoints.

These endpoints back the `/browser` surface.

They are credential-first and can be used with:
- RGW accounts (account-centric) for members with bucket permissions
- Legacy S3 users (when explicitly linked)
- User-scoped S3 connections (selector `conn-<id>`)
- Ceph Admin endpoint context (selector `ceph-admin-<endpoint_id>`)

The endpoints reuse the existing `account_id` selector and context resolution
logic implemented in :func:`app.routers.dependencies.get_account_context`.
"""

from typing import Any, NoReturn, Optional, Union

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.db import S3Account, User
from app.models.app_settings import BrowserSettings
from app.models.bucket import (
    Bucket,
    BucketAcl,
    BucketAclUpdate,
    BucketCreate,
    BucketCorsUpdate,
    BucketEncryptionConfiguration,
    BucketLifecycleConfig,
    BucketLoggingConfiguration,
    BucketNotificationConfiguration,
    BucketObjectLock,
    BucketObjectLockUpdate,
    BucketPolicyIn,
    BucketPolicyOut,
    BucketReplicationConfiguration,
    BucketProperties,
    BucketPublicAccessBlock,
    BucketQuotaUpdate,
    BucketTagsUpdate,
    BucketVersioningUpdate,
    BucketWebsiteConfiguration,
)
from app.models.browser import (
    BrowserBucket,
    BrowserObjectSortBy,
    BrowserStsCredentials,
    BrowserObjectSortDir,
    BucketVersioningStatus,
    BucketCorsStatus,
    CleanupObjectVersionsPayload,
    CleanupObjectVersionsResponse,
    CompleteMultipartUploadRequest,
    CopyObjectPayload,
    DeleteObjectsPayload,
    ListBrowserObjectsResponse,
    ListMultipartUploadsResponse,
    ListObjectVersionsResponse,
    ListPartsResponse,
    MultipartUploadInitRequest,
    MultipartUploadInitResponse,
    ObjectAcl,
    ObjectColumnsRequest,
    ObjectColumnsResponse,
    ObjectLegalHold,
    ObjectMetadata,
    ObjectMetadataUpdate,
    ObjectRestoreRequest,
    ObjectRetention,
    ObjectTags,
    PaginatedBrowserBucketsResponse,
    PresignPartRequest,
    PresignPartResponse,
    PresignRequest,
    PresignedUrl,
    SseCustomerContext,
    StsStatus,
)
from app.models.session import ManagerSessionPrincipal
from app.routers.browser_common import (
    CreateFolderPayload,
    EnsureCorsPayload,
    ProxyUploadResponse,
    record_browser_action as _common_record_browser_action,
    require_sse_feature as _common_require_sse_feature,
)
from app.routers.http_errors import raise_bad_gateway_from_runtime
from app.routers.dependencies import (
    get_account_context,
    get_audit_logger,
    get_current_account_admin,
    get_current_super_admin,
    get_optional_sse_customer_context,
)
from app.services.app_settings_service import load_app_settings
from app.services.audit_service import AuditService
from app.services import bucket_config_actions
from app.services.browser_service import BrowserService, get_browser_service
from app.services.buckets_service import BucketsService, get_buckets_service
router = APIRouter(prefix="/browser", tags=["browser"])

BrowserActor = Union[User, ManagerSessionPrincipal]


class CreateBucketPayload(BaseModel):
    name: str
    versioning: bool = False


def _invalidate_browser_listing_cache(
    browser_service: BrowserService,
    account: S3Account,
    *,
    bucket_name: Optional[str] = None,
) -> None:
    browser_service.invalidate_bucket_list_cache_for_account(account)
    if bucket_name:
        browser_service.invalidate_object_list_cache_for_account(account, bucket_name)


def _raise_legacy_route_removed(*, canonical: str) -> NoReturn:
    raise HTTPException(
        status_code=status.HTTP_410_GONE,
        detail=f"Legacy browser route removed. Use '{canonical}'.",
    )


@router.get("/settings", response_model=BrowserSettings)
def get_browser_settings(_: BrowserActor = Depends(get_current_account_admin)) -> BrowserSettings:
    return load_app_settings().browser


@router.get("/buckets", response_model=list[BrowserBucket])
def list_buckets(
    account: S3Account = Depends(get_account_context),
    service: BrowserService = Depends(get_browser_service),
    _: BrowserActor = Depends(get_current_account_admin),
) -> list[BrowserBucket]:
    try:
        return service.list_buckets(account)
    except RuntimeError as exc:
        raise_bad_gateway_from_runtime(exc)


@router.get("/buckets/search", response_model=PaginatedBrowserBucketsResponse)
def search_buckets(
    search: Optional[str] = None,
    exact: bool = Query(default=False),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    account: S3Account = Depends(get_account_context),
    service: BrowserService = Depends(get_browser_service),
    _: BrowserActor = Depends(get_current_account_admin),
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


@router.post("/buckets", status_code=status.HTTP_201_CREATED)
def create_bucket(
    payload: CreateBucketPayload,
    account: S3Account = Depends(get_account_context),
    service: BrowserService = Depends(get_browser_service),
    actor: BrowserActor = Depends(get_current_account_admin),
    audit_service: AuditService = Depends(get_audit_logger),
) -> dict[str, Any]:
    bucket_name = payload.name.strip()
    if not bucket_name:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Bucket name is required")
    try:
        service.create_bucket(bucket_name, account, versioning=payload.versioning)
        _common_record_browser_action(audit_service, actor=actor, scope="browser",
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


@router.get("/buckets/config", response_model=list[Bucket])
def list_bucket_configs(
    include: list[str] = Query(default=[], description="Optional extra fields to include (e.g. tags, versioning, cors)"),
    with_stats: bool = Query(True, description="Include usage/quota stats from admin listing"),
    account: S3Account = Depends(get_account_context),
    service: BucketsService = Depends(get_buckets_service),
    browser_service: BrowserService = Depends(get_browser_service),
    _: BrowserActor = Depends(get_current_account_admin),
) -> list[Bucket]:
    return bucket_config_actions.list_bucket_configs(
        service=service,
        account=account,
        include=include,
        with_stats=with_stats,
    )


@router.get("/buckets/config/{bucket_name}/stats", response_model=Bucket)
def get_bucket_config_stats(
    bucket_name: str,
    with_stats: bool = Query(True, description="Include usage/quota stats when available"),
    account: S3Account = Depends(get_account_context),
    service: BucketsService = Depends(get_buckets_service),
    _: BrowserActor = Depends(get_current_account_admin),
) -> Bucket:
    return bucket_config_actions.get_bucket_config_stats(
        service=service,
        account=account,
        bucket_name=bucket_name,
        with_stats=with_stats,
    )


@router.post("/buckets/config", status_code=status.HTTP_201_CREATED)
def create_bucket_config(
    payload: BucketCreate,
    account: S3Account = Depends(get_account_context),
    service: BucketsService = Depends(get_buckets_service),
    browser_service: BrowserService = Depends(get_browser_service),
    actor: BrowserActor = Depends(get_current_account_admin),
    audit_service: AuditService = Depends(get_audit_logger),
) -> dict[str, Any]:
    response, audit_metadata = bucket_config_actions.create_bucket_config(
        service=service,
        account=account,
        payload=payload,
    )
    _invalidate_browser_listing_cache(browser_service, account, bucket_name=payload.name)
    _common_record_browser_action(
        audit_service,
        actor=actor,
        scope="browser",
        action="create_bucket",
        entity_type="bucket",
        entity_id=payload.name,
        account=account,
        metadata=audit_metadata,
    )
    return response


@router.delete("/buckets/config/{bucket_name}")
def delete_bucket_config(
    bucket_name: str,
    force: bool = Query(False, description="Set to true to delete all objects before deleting the bucket"),
    account: S3Account = Depends(get_account_context),
    service: BucketsService = Depends(get_buckets_service),
    browser_service: BrowserService = Depends(get_browser_service),
    actor: BrowserActor = Depends(get_current_account_admin),
    audit_service: AuditService = Depends(get_audit_logger),
) -> dict[str, str]:
    response, audit_metadata = bucket_config_actions.delete_bucket_config(
        service=service,
        account=account,
        bucket_name=bucket_name,
        force=force,
    )
    _invalidate_browser_listing_cache(browser_service, account, bucket_name=bucket_name)
    _common_record_browser_action(
        audit_service,
        actor=actor,
        scope="browser",
        action="delete_bucket",
        entity_type="bucket",
        entity_id=bucket_name,
        account=account,
        metadata=audit_metadata,
    )
    return response


@router.put("/buckets/config/{bucket_name}/quota")
def update_bucket_quota_config(
    bucket_name: str,
    payload: BucketQuotaUpdate,
    account: S3Account = Depends(get_account_context),
    service: BucketsService = Depends(get_buckets_service),
    browser_service: BrowserService = Depends(get_browser_service),
    actor: User = Depends(get_current_super_admin),
    audit_service: AuditService = Depends(get_audit_logger),
) -> dict[str, str]:
    response, audit_metadata = bucket_config_actions.update_bucket_quota_config(
        service=service,
        account=account,
        bucket_name=bucket_name,
        payload=payload,
    )
    _invalidate_browser_listing_cache(browser_service, account, bucket_name=bucket_name)
    _common_record_browser_action(
        audit_service,
        actor=actor,
        scope="browser",
        action="update_bucket_quota",
        entity_type="bucket",
        entity_id=bucket_name,
        account=account,
        metadata=audit_metadata,
    )
    return response


@router.get("/buckets/config/{bucket_name}/properties", response_model=BucketProperties)
def get_bucket_properties_config(
    bucket_name: str,
    account: S3Account = Depends(get_account_context),
    service: BucketsService = Depends(get_buckets_service),
    browser_service: BrowserService = Depends(get_browser_service),
    _: BrowserActor = Depends(get_current_account_admin),
) -> BucketProperties:
    return bucket_config_actions.get_bucket_properties_config(
        service=service,
        account=account,
        bucket_name=bucket_name,
    )


@router.put("/buckets/config/{bucket_name}/versioning", status_code=status.HTTP_200_OK)
def update_bucket_versioning_config(
    bucket_name: str,
    payload: BucketVersioningUpdate,
    account: S3Account = Depends(get_account_context),
    service: BucketsService = Depends(get_buckets_service),
    browser_service: BrowserService = Depends(get_browser_service),
    actor: BrowserActor = Depends(get_current_account_admin),
    audit_service: AuditService = Depends(get_audit_logger),
) -> dict[str, Any]:
    response, audit_metadata = bucket_config_actions.update_bucket_versioning_config(
        service=service,
        account=account,
        bucket_name=bucket_name,
        payload=payload,
    )
    _invalidate_browser_listing_cache(browser_service, account, bucket_name=bucket_name)
    _common_record_browser_action(
        audit_service,
        actor=actor,
        scope="browser",
        action="update_bucket_versioning",
        entity_type="bucket",
        entity_id=bucket_name,
        account=account,
        metadata=audit_metadata,
    )
    return response


@router.get("/buckets/config/{bucket_name}/object-lock", response_model=BucketObjectLock)
def get_bucket_object_lock_config(
    bucket_name: str,
    account: S3Account = Depends(get_account_context),
    service: BucketsService = Depends(get_buckets_service),
    browser_service: BrowserService = Depends(get_browser_service),
    _: BrowserActor = Depends(get_current_account_admin),
) -> BucketObjectLock:
    return bucket_config_actions.get_bucket_object_lock_config(
        service=service,
        account=account,
        bucket_name=bucket_name,
    )


@router.put("/buckets/config/{bucket_name}/object-lock", response_model=BucketObjectLock)
def put_bucket_object_lock_config(
    bucket_name: str,
    payload: BucketObjectLockUpdate,
    account: S3Account = Depends(get_account_context),
    service: BucketsService = Depends(get_buckets_service),
    browser_service: BrowserService = Depends(get_browser_service),
    actor: BrowserActor = Depends(get_current_account_admin),
    audit_service: AuditService = Depends(get_audit_logger),
) -> BucketObjectLock:
    result, audit_metadata = bucket_config_actions.put_bucket_object_lock_config(
        service=service,
        account=account,
        bucket_name=bucket_name,
        payload=payload,
    )
    _invalidate_browser_listing_cache(browser_service, account, bucket_name=bucket_name)
    _common_record_browser_action(
        audit_service,
        actor=actor,
        scope="browser",
        action="update_bucket_object_lock",
        entity_type="bucket",
        entity_id=bucket_name,
        account=account,
        metadata=audit_metadata,
    )
    return result


@router.get("/buckets/config/{bucket_name}/encryption", response_model=BucketEncryptionConfiguration)
def get_bucket_encryption_config(
    bucket_name: str,
    account: S3Account = Depends(get_account_context),
    service: BucketsService = Depends(get_buckets_service),
    browser_service: BrowserService = Depends(get_browser_service),
    _: BrowserActor = Depends(get_current_account_admin),
) -> BucketEncryptionConfiguration:
    _common_require_sse_feature(account)
    return bucket_config_actions.get_bucket_encryption_config(
        service=service,
        account=account,
        bucket_name=bucket_name,
    )


@router.put("/buckets/config/{bucket_name}/encryption", response_model=BucketEncryptionConfiguration)
def put_bucket_encryption_config(
    bucket_name: str,
    payload: BucketEncryptionConfiguration,
    account: S3Account = Depends(get_account_context),
    service: BucketsService = Depends(get_buckets_service),
    browser_service: BrowserService = Depends(get_browser_service),
    actor: BrowserActor = Depends(get_current_account_admin),
    audit_service: AuditService = Depends(get_audit_logger),
) -> BucketEncryptionConfiguration:
    _common_require_sse_feature(account)
    result, audit_metadata = bucket_config_actions.put_bucket_encryption_config(
        service=service,
        account=account,
        bucket_name=bucket_name,
        payload=payload,
    )
    _invalidate_browser_listing_cache(browser_service, account, bucket_name=bucket_name)
    _common_record_browser_action(
        audit_service,
        actor=actor,
        scope="browser",
        action="update_bucket_encryption",
        entity_type="bucket",
        entity_id=bucket_name,
        account=account,
        metadata=audit_metadata,
    )
    return result


@router.delete("/buckets/config/{bucket_name}/encryption", status_code=status.HTTP_204_NO_CONTENT)
def delete_bucket_encryption_config(
    bucket_name: str,
    account: S3Account = Depends(get_account_context),
    service: BucketsService = Depends(get_buckets_service),
    browser_service: BrowserService = Depends(get_browser_service),
    actor: BrowserActor = Depends(get_current_account_admin),
    audit_service: AuditService = Depends(get_audit_logger),
) -> None:
    _common_require_sse_feature(account)
    bucket_config_actions.delete_bucket_encryption_config(
        service=service,
        account=account,
        bucket_name=bucket_name,
    )
    _invalidate_browser_listing_cache(browser_service, account, bucket_name=bucket_name)
    _common_record_browser_action(
        audit_service,
        actor=actor,
        scope="browser",
        action="delete_bucket_encryption",
        entity_type="bucket",
        entity_id=bucket_name,
        account=account,
    )


@router.get("/buckets/config/{bucket_name}/policy", response_model=BucketPolicyOut)
def get_bucket_policy_config(
    bucket_name: str,
    account: S3Account = Depends(get_account_context),
    service: BucketsService = Depends(get_buckets_service),
    browser_service: BrowserService = Depends(get_browser_service),
    _: BrowserActor = Depends(get_current_account_admin),
) -> BucketPolicyOut:
    return bucket_config_actions.get_bucket_policy_config(
        service=service,
        account=account,
        bucket_name=bucket_name,
    )


@router.put("/buckets/config/{bucket_name}/policy", response_model=BucketPolicyOut)
def put_bucket_policy_config(
    bucket_name: str,
    payload: BucketPolicyIn,
    account: S3Account = Depends(get_account_context),
    service: BucketsService = Depends(get_buckets_service),
    browser_service: BrowserService = Depends(get_browser_service),
    actor: BrowserActor = Depends(get_current_account_admin),
    audit_service: AuditService = Depends(get_audit_logger),
) -> BucketPolicyOut:
    result, audit_metadata = bucket_config_actions.put_bucket_policy_config(
        service=service,
        account=account,
        bucket_name=bucket_name,
        payload=payload,
    )
    _invalidate_browser_listing_cache(browser_service, account, bucket_name=bucket_name)
    _common_record_browser_action(
        audit_service,
        actor=actor,
        scope="browser",
        action="put_bucket_policy",
        entity_type="bucket",
        entity_id=bucket_name,
        account=account,
        metadata=audit_metadata,
    )
    return result


@router.delete("/buckets/config/{bucket_name}/policy", status_code=status.HTTP_204_NO_CONTENT)
def delete_bucket_policy_config(
    bucket_name: str,
    account: S3Account = Depends(get_account_context),
    service: BucketsService = Depends(get_buckets_service),
    browser_service: BrowserService = Depends(get_browser_service),
    actor: BrowserActor = Depends(get_current_account_admin),
    audit_service: AuditService = Depends(get_audit_logger),
) -> None:
    bucket_config_actions.delete_bucket_policy_config(
        service=service,
        account=account,
        bucket_name=bucket_name,
    )
    _invalidate_browser_listing_cache(browser_service, account, bucket_name=bucket_name)
    _common_record_browser_action(
        audit_service,
        actor=actor,
        scope="browser",
        action="delete_bucket_policy",
        entity_type="bucket",
        entity_id=bucket_name,
        account=account,
    )


@router.get("/buckets/config/{bucket_name}/acl", response_model=BucketAcl)
def get_bucket_acl_config(
    bucket_name: str,
    account: S3Account = Depends(get_account_context),
    service: BucketsService = Depends(get_buckets_service),
    browser_service: BrowserService = Depends(get_browser_service),
    _: BrowserActor = Depends(get_current_account_admin),
) -> BucketAcl:
    return bucket_config_actions.get_bucket_acl_config(
        service=service,
        account=account,
        bucket_name=bucket_name,
    )


@router.put("/buckets/config/{bucket_name}/acl", response_model=BucketAcl)
def put_bucket_acl_config(
    bucket_name: str,
    payload: BucketAclUpdate,
    account: S3Account = Depends(get_account_context),
    service: BucketsService = Depends(get_buckets_service),
    browser_service: BrowserService = Depends(get_browser_service),
    actor: BrowserActor = Depends(get_current_account_admin),
    audit_service: AuditService = Depends(get_audit_logger),
) -> BucketAcl:
    result, audit_metadata = bucket_config_actions.put_bucket_acl_config(
        service=service,
        account=account,
        bucket_name=bucket_name,
        payload=payload,
    )
    _invalidate_browser_listing_cache(browser_service, account, bucket_name=bucket_name)
    _common_record_browser_action(
        audit_service,
        actor=actor,
        scope="browser",
        action="update_bucket_acl",
        entity_type="bucket",
        entity_id=bucket_name,
        account=account,
        metadata=audit_metadata,
    )
    return result


@router.get("/buckets/config/{bucket_name}/public-access-block", response_model=BucketPublicAccessBlock)
def get_bucket_public_access_block_config(
    bucket_name: str,
    account: S3Account = Depends(get_account_context),
    service: BucketsService = Depends(get_buckets_service),
    browser_service: BrowserService = Depends(get_browser_service),
    _: BrowserActor = Depends(get_current_account_admin),
) -> BucketPublicAccessBlock:
    return bucket_config_actions.get_bucket_public_access_block_config(
        service=service,
        account=account,
        bucket_name=bucket_name,
    )


@router.put("/buckets/config/{bucket_name}/public-access-block", response_model=BucketPublicAccessBlock)
def put_bucket_public_access_block_config(
    bucket_name: str,
    payload: BucketPublicAccessBlock,
    account: S3Account = Depends(get_account_context),
    service: BucketsService = Depends(get_buckets_service),
    browser_service: BrowserService = Depends(get_browser_service),
    actor: BrowserActor = Depends(get_current_account_admin),
    audit_service: AuditService = Depends(get_audit_logger),
) -> BucketPublicAccessBlock:
    result, audit_metadata = bucket_config_actions.put_bucket_public_access_block_config(
        service=service,
        account=account,
        bucket_name=bucket_name,
        payload=payload,
    )
    _invalidate_browser_listing_cache(browser_service, account, bucket_name=bucket_name)
    _common_record_browser_action(
        audit_service,
        actor=actor,
        scope="browser",
        action="update_public_access_block",
        entity_type="bucket",
        entity_id=bucket_name,
        account=account,
        metadata=audit_metadata,
    )
    return result


@router.get("/buckets/config/{bucket_name}/lifecycle", response_model=BucketLifecycleConfig)
def get_bucket_lifecycle_config(
    bucket_name: str,
    account: S3Account = Depends(get_account_context),
    service: BucketsService = Depends(get_buckets_service),
    browser_service: BrowserService = Depends(get_browser_service),
    _: BrowserActor = Depends(get_current_account_admin),
) -> BucketLifecycleConfig:
    return bucket_config_actions.get_bucket_lifecycle_config(
        service=service,
        account=account,
        bucket_name=bucket_name,
    )


@router.put("/buckets/config/{bucket_name}/lifecycle", response_model=BucketLifecycleConfig)
def put_bucket_lifecycle_config(
    bucket_name: str,
    payload: BucketLifecycleConfig,
    account: S3Account = Depends(get_account_context),
    service: BucketsService = Depends(get_buckets_service),
    browser_service: BrowserService = Depends(get_browser_service),
    actor: BrowserActor = Depends(get_current_account_admin),
    audit_service: AuditService = Depends(get_audit_logger),
) -> BucketLifecycleConfig:
    result, audit_metadata = bucket_config_actions.put_bucket_lifecycle_config(
        service=service,
        account=account,
        bucket_name=bucket_name,
        payload=payload,
    )
    _invalidate_browser_listing_cache(browser_service, account, bucket_name=bucket_name)
    _common_record_browser_action(
        audit_service,
        actor=actor,
        scope="browser",
        action="update_bucket_lifecycle",
        entity_type="bucket",
        entity_id=bucket_name,
        account=account,
        metadata=audit_metadata,
    )
    return result


@router.delete("/buckets/config/{bucket_name}/lifecycle", status_code=status.HTTP_204_NO_CONTENT)
def delete_bucket_lifecycle_config(
    bucket_name: str,
    account: S3Account = Depends(get_account_context),
    service: BucketsService = Depends(get_buckets_service),
    browser_service: BrowserService = Depends(get_browser_service),
    actor: BrowserActor = Depends(get_current_account_admin),
    audit_service: AuditService = Depends(get_audit_logger),
) -> None:
    bucket_config_actions.delete_bucket_lifecycle_config(
        service=service,
        account=account,
        bucket_name=bucket_name,
    )
    _invalidate_browser_listing_cache(browser_service, account, bucket_name=bucket_name)
    _common_record_browser_action(
        audit_service,
        actor=actor,
        scope="browser",
        action="delete_bucket_lifecycle",
        entity_type="bucket",
        entity_id=bucket_name,
        account=account,
    )


@router.get("/buckets/config/{bucket_name}/cors")
def get_bucket_cors_config(
    bucket_name: str,
    account: S3Account = Depends(get_account_context),
    service: BucketsService = Depends(get_buckets_service),
    browser_service: BrowserService = Depends(get_browser_service),
    _: BrowserActor = Depends(get_current_account_admin),
) -> dict[str, Any]:
    return bucket_config_actions.get_bucket_cors_config(
        service=service,
        account=account,
        bucket_name=bucket_name,
    )


@router.put("/buckets/config/{bucket_name}/cors")
def put_bucket_cors_config(
    bucket_name: str,
    payload: BucketCorsUpdate,
    account: S3Account = Depends(get_account_context),
    service: BucketsService = Depends(get_buckets_service),
    browser_service: BrowserService = Depends(get_browser_service),
    actor: BrowserActor = Depends(get_current_account_admin),
    audit_service: AuditService = Depends(get_audit_logger),
) -> dict[str, Any]:
    response, audit_metadata = bucket_config_actions.put_bucket_cors_config(
        service=service,
        account=account,
        bucket_name=bucket_name,
        payload=payload,
    )
    _invalidate_browser_listing_cache(browser_service, account, bucket_name=bucket_name)
    _common_record_browser_action(
        audit_service,
        actor=actor,
        scope="browser",
        action="update_bucket_cors",
        entity_type="bucket",
        entity_id=bucket_name,
        account=account,
        metadata=audit_metadata,
    )
    return response


@router.delete("/buckets/config/{bucket_name}/cors", status_code=status.HTTP_204_NO_CONTENT)
def delete_bucket_cors_config(
    bucket_name: str,
    account: S3Account = Depends(get_account_context),
    service: BucketsService = Depends(get_buckets_service),
    browser_service: BrowserService = Depends(get_browser_service),
    actor: BrowserActor = Depends(get_current_account_admin),
    audit_service: AuditService = Depends(get_audit_logger),
) -> None:
    bucket_config_actions.delete_bucket_cors_config(
        service=service,
        account=account,
        bucket_name=bucket_name,
    )
    _invalidate_browser_listing_cache(browser_service, account, bucket_name=bucket_name)
    _common_record_browser_action(
        audit_service,
        actor=actor,
        scope="browser",
        action="delete_bucket_cors",
        entity_type="bucket",
        entity_id=bucket_name,
        account=account,
    )


@router.get("/buckets/config/{bucket_name}/notifications", response_model=BucketNotificationConfiguration)
def get_bucket_notifications_config(
    bucket_name: str,
    account: S3Account = Depends(get_account_context),
    service: BucketsService = Depends(get_buckets_service),
    browser_service: BrowserService = Depends(get_browser_service),
    _: BrowserActor = Depends(get_current_account_admin),
) -> BucketNotificationConfiguration:
    return bucket_config_actions.get_bucket_notifications_config(
        service=service,
        account=account,
        bucket_name=bucket_name,
    )


@router.put("/buckets/config/{bucket_name}/notifications", response_model=BucketNotificationConfiguration)
def put_bucket_notifications_config(
    bucket_name: str,
    payload: BucketNotificationConfiguration,
    account: S3Account = Depends(get_account_context),
    service: BucketsService = Depends(get_buckets_service),
    browser_service: BrowserService = Depends(get_browser_service),
    actor: BrowserActor = Depends(get_current_account_admin),
    audit_service: AuditService = Depends(get_audit_logger),
) -> BucketNotificationConfiguration:
    result, audit_metadata = bucket_config_actions.put_bucket_notifications_config(
        service=service,
        account=account,
        bucket_name=bucket_name,
        payload=payload,
    )
    _invalidate_browser_listing_cache(browser_service, account, bucket_name=bucket_name)
    _common_record_browser_action(
        audit_service,
        actor=actor,
        scope="browser",
        action="update_bucket_notifications",
        entity_type="bucket",
        entity_id=bucket_name,
        account=account,
        metadata=audit_metadata,
    )
    return result


@router.delete("/buckets/config/{bucket_name}/notifications", status_code=status.HTTP_204_NO_CONTENT)
def delete_bucket_notifications_config(
    bucket_name: str,
    account: S3Account = Depends(get_account_context),
    service: BucketsService = Depends(get_buckets_service),
    browser_service: BrowserService = Depends(get_browser_service),
    actor: BrowserActor = Depends(get_current_account_admin),
    audit_service: AuditService = Depends(get_audit_logger),
) -> None:
    bucket_config_actions.delete_bucket_notifications_config(
        service=service,
        account=account,
        bucket_name=bucket_name,
    )
    _invalidate_browser_listing_cache(browser_service, account, bucket_name=bucket_name)
    _common_record_browser_action(
        audit_service,
        actor=actor,
        scope="browser",
        action="delete_bucket_notifications",
        entity_type="bucket",
        entity_id=bucket_name,
        account=account,
    )


@router.get("/buckets/config/{bucket_name}/replication", response_model=BucketReplicationConfiguration)
def get_bucket_replication_config(
    bucket_name: str,
    account: S3Account = Depends(get_account_context),
    service: BucketsService = Depends(get_buckets_service),
    browser_service: BrowserService = Depends(get_browser_service),
    _: BrowserActor = Depends(get_current_account_admin),
) -> BucketReplicationConfiguration:
    return bucket_config_actions.get_bucket_replication_config(
        service=service,
        account=account,
        bucket_name=bucket_name,
    )


@router.put("/buckets/config/{bucket_name}/replication", response_model=BucketReplicationConfiguration)
def put_bucket_replication_config(
    bucket_name: str,
    payload: BucketReplicationConfiguration,
    account: S3Account = Depends(get_account_context),
    service: BucketsService = Depends(get_buckets_service),
    browser_service: BrowserService = Depends(get_browser_service),
    actor: BrowserActor = Depends(get_current_account_admin),
    audit_service: AuditService = Depends(get_audit_logger),
) -> BucketReplicationConfiguration:
    result, audit_metadata = bucket_config_actions.put_bucket_replication_config(
        service=service,
        account=account,
        bucket_name=bucket_name,
        payload=payload,
    )
    _invalidate_browser_listing_cache(browser_service, account, bucket_name=bucket_name)
    _common_record_browser_action(
        audit_service,
        actor=actor,
        scope="browser",
        action="update_bucket_replication",
        entity_type="bucket",
        entity_id=bucket_name,
        account=account,
        metadata=audit_metadata,
    )
    return result


@router.delete("/buckets/config/{bucket_name}/replication", status_code=status.HTTP_204_NO_CONTENT)
def delete_bucket_replication_config(
    bucket_name: str,
    account: S3Account = Depends(get_account_context),
    service: BucketsService = Depends(get_buckets_service),
    browser_service: BrowserService = Depends(get_browser_service),
    actor: BrowserActor = Depends(get_current_account_admin),
    audit_service: AuditService = Depends(get_audit_logger),
) -> None:
    bucket_config_actions.delete_bucket_replication_config(
        service=service,
        account=account,
        bucket_name=bucket_name,
    )
    _invalidate_browser_listing_cache(browser_service, account, bucket_name=bucket_name)
    _common_record_browser_action(
        audit_service,
        actor=actor,
        scope="browser",
        action="delete_bucket_replication",
        entity_type="bucket",
        entity_id=bucket_name,
        account=account,
    )


@router.get("/buckets/config/{bucket_name}/logging", response_model=BucketLoggingConfiguration)
def get_bucket_logging_config(
    bucket_name: str,
    account: S3Account = Depends(get_account_context),
    service: BucketsService = Depends(get_buckets_service),
    browser_service: BrowserService = Depends(get_browser_service),
    _: BrowserActor = Depends(get_current_account_admin),
) -> BucketLoggingConfiguration:
    return bucket_config_actions.get_bucket_logging_config(
        service=service,
        account=account,
        bucket_name=bucket_name,
    )


@router.put("/buckets/config/{bucket_name}/logging", response_model=BucketLoggingConfiguration)
def put_bucket_logging_config(
    bucket_name: str,
    payload: BucketLoggingConfiguration,
    account: S3Account = Depends(get_account_context),
    service: BucketsService = Depends(get_buckets_service),
    browser_service: BrowserService = Depends(get_browser_service),
    actor: BrowserActor = Depends(get_current_account_admin),
    audit_service: AuditService = Depends(get_audit_logger),
) -> BucketLoggingConfiguration:
    result, audit_metadata = bucket_config_actions.put_bucket_logging_config(
        service=service,
        account=account,
        bucket_name=bucket_name,
        payload=payload,
    )
    _invalidate_browser_listing_cache(browser_service, account, bucket_name=bucket_name)
    _common_record_browser_action(
        audit_service,
        actor=actor,
        scope="browser",
        action="update_bucket_logging",
        entity_type="bucket",
        entity_id=bucket_name,
        account=account,
        metadata=audit_metadata,
    )
    return result


@router.delete("/buckets/config/{bucket_name}/logging", status_code=status.HTTP_204_NO_CONTENT)
def delete_bucket_logging_config(
    bucket_name: str,
    account: S3Account = Depends(get_account_context),
    service: BucketsService = Depends(get_buckets_service),
    browser_service: BrowserService = Depends(get_browser_service),
    actor: BrowserActor = Depends(get_current_account_admin),
    audit_service: AuditService = Depends(get_audit_logger),
) -> None:
    bucket_config_actions.delete_bucket_logging_config(
        service=service,
        account=account,
        bucket_name=bucket_name,
    )
    _invalidate_browser_listing_cache(browser_service, account, bucket_name=bucket_name)
    _common_record_browser_action(
        audit_service,
        actor=actor,
        scope="browser",
        action="delete_bucket_logging",
        entity_type="bucket",
        entity_id=bucket_name,
        account=account,
    )


@router.get("/buckets/config/{bucket_name}/website", response_model=BucketWebsiteConfiguration)
def get_bucket_website_config(
    bucket_name: str,
    account: S3Account = Depends(get_account_context),
    service: BucketsService = Depends(get_buckets_service),
    browser_service: BrowserService = Depends(get_browser_service),
    _: BrowserActor = Depends(get_current_account_admin),
) -> BucketWebsiteConfiguration:
    return bucket_config_actions.get_bucket_website_config(
        service=service,
        account=account,
        bucket_name=bucket_name,
    )


@router.put("/buckets/config/{bucket_name}/website", response_model=BucketWebsiteConfiguration)
def put_bucket_website_config(
    bucket_name: str,
    payload: BucketWebsiteConfiguration,
    account: S3Account = Depends(get_account_context),
    service: BucketsService = Depends(get_buckets_service),
    browser_service: BrowserService = Depends(get_browser_service),
    actor: BrowserActor = Depends(get_current_account_admin),
    audit_service: AuditService = Depends(get_audit_logger),
) -> BucketWebsiteConfiguration:
    result, audit_metadata = bucket_config_actions.put_bucket_website_config(
        service=service,
        account=account,
        bucket_name=bucket_name,
        payload=payload,
    )
    _invalidate_browser_listing_cache(browser_service, account, bucket_name=bucket_name)
    _common_record_browser_action(
        audit_service,
        actor=actor,
        scope="browser",
        action="update_bucket_website",
        entity_type="bucket",
        entity_id=bucket_name,
        account=account,
        metadata=audit_metadata,
    )
    return result


@router.delete("/buckets/config/{bucket_name}/website", status_code=status.HTTP_204_NO_CONTENT)
def delete_bucket_website_config(
    bucket_name: str,
    account: S3Account = Depends(get_account_context),
    service: BucketsService = Depends(get_buckets_service),
    browser_service: BrowserService = Depends(get_browser_service),
    actor: BrowserActor = Depends(get_current_account_admin),
    audit_service: AuditService = Depends(get_audit_logger),
) -> None:
    bucket_config_actions.delete_bucket_website_config(
        service=service,
        account=account,
        bucket_name=bucket_name,
    )
    _invalidate_browser_listing_cache(browser_service, account, bucket_name=bucket_name)
    _common_record_browser_action(
        audit_service,
        actor=actor,
        scope="browser",
        action="delete_bucket_website",
        entity_type="bucket",
        entity_id=bucket_name,
        account=account,
    )


@router.get("/buckets/config/{bucket_name}/tags")
def get_bucket_tags_config(
    bucket_name: str,
    account: S3Account = Depends(get_account_context),
    service: BucketsService = Depends(get_buckets_service),
    browser_service: BrowserService = Depends(get_browser_service),
    _: BrowserActor = Depends(get_current_account_admin),
) -> dict[str, Any]:
    return bucket_config_actions.get_bucket_tags_config(
        service=service,
        account=account,
        bucket_name=bucket_name,
    )


@router.put("/buckets/config/{bucket_name}/tags")
def put_bucket_tags_config(
    bucket_name: str,
    payload: BucketTagsUpdate,
    account: S3Account = Depends(get_account_context),
    service: BucketsService = Depends(get_buckets_service),
    browser_service: BrowserService = Depends(get_browser_service),
    actor: BrowserActor = Depends(get_current_account_admin),
    audit_service: AuditService = Depends(get_audit_logger),
) -> dict[str, Any]:
    response, audit_metadata = bucket_config_actions.put_bucket_tags_config(
        service=service,
        account=account,
        bucket_name=bucket_name,
        payload=payload,
    )
    _invalidate_browser_listing_cache(browser_service, account, bucket_name=bucket_name)
    _common_record_browser_action(
        audit_service,
        actor=actor,
        scope="browser",
        action="update_bucket_tags",
        entity_type="bucket",
        entity_id=bucket_name,
        account=account,
        metadata=audit_metadata,
    )
    return response


@router.delete("/buckets/config/{bucket_name}/tags", status_code=status.HTTP_204_NO_CONTENT)
def delete_bucket_tags_config(
    bucket_name: str,
    account: S3Account = Depends(get_account_context),
    service: BucketsService = Depends(get_buckets_service),
    browser_service: BrowserService = Depends(get_browser_service),
    actor: BrowserActor = Depends(get_current_account_admin),
    audit_service: AuditService = Depends(get_audit_logger),
) -> None:
    bucket_config_actions.delete_bucket_tags_config(
        service=service,
        account=account,
        bucket_name=bucket_name,
    )
    _invalidate_browser_listing_cache(browser_service, account, bucket_name=bucket_name)
    _common_record_browser_action(
        audit_service,
        actor=actor,
        scope="browser",
        action="delete_bucket_tags",
        entity_type="bucket",
        entity_id=bucket_name,
        account=account,
    )


@router.get("/buckets/{bucket_name}/versioning", response_model=BucketVersioningStatus)
def get_bucket_versioning(
    bucket_name: str,
    account: S3Account = Depends(get_account_context),
    service: BrowserService = Depends(get_browser_service),
    _: BrowserActor = Depends(get_current_account_admin),
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
    account: S3Account = Depends(get_account_context),
    service: BrowserService = Depends(get_browser_service),
    _: BrowserActor = Depends(get_current_account_admin),
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
        )
    except RuntimeError as exc:
        raise_bad_gateway_from_runtime(exc)


@router.post("/buckets/{bucket_name}/objects/columns", response_model=ObjectColumnsResponse)
def get_object_columns(
    bucket_name: str,
    payload: ObjectColumnsRequest,
    account: S3Account = Depends(get_account_context),
    service: BrowserService = Depends(get_browser_service),
    sse_customer: Optional[SseCustomerContext] = Depends(get_optional_sse_customer_context),
    _: BrowserActor = Depends(get_current_account_admin),
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
    account: S3Account = Depends(get_account_context),
    service: BrowserService = Depends(get_browser_service),
    _: BrowserActor = Depends(get_current_account_admin),
) -> BucketCorsStatus:
    return service.get_bucket_cors_status(bucket_name, account, origin=origin)


@router.post("/buckets/{bucket_name}/cors/ensure", response_model=BucketCorsStatus)
def ensure_bucket_cors(
    bucket_name: str,
    payload: EnsureCorsPayload,
    account: S3Account = Depends(get_account_context),
    service: BrowserService = Depends(get_browser_service),
    actor: BrowserActor = Depends(get_current_account_admin),
    audit_service: AuditService = Depends(get_audit_logger),
) -> BucketCorsStatus:
    if not payload.origin:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing origin")
    try:
        status_result = service.ensure_bucket_cors(bucket_name, account, payload.origin)
        _common_record_browser_action(audit_service, actor=actor, scope="browser",
            action="ensure_bucket_cors",
            entity_type="bucket",
            entity_id=bucket_name,
            account=account,
            metadata={"origin": payload.origin},
        )
        return status_result
    except RuntimeError as exc:
        raise_bad_gateway_from_runtime(exc)


@router.get("/sts", response_model=StsStatus)
def get_sts_status(
    account: S3Account = Depends(get_account_context),
    service: BrowserService = Depends(get_browser_service),
    _: BrowserActor = Depends(get_current_account_admin),
) -> StsStatus:
    return service.check_sts(account)


@router.get("/sts/credentials", response_model=BrowserStsCredentials)
def get_sts_credentials(
    account: S3Account = Depends(get_account_context),
    service: BrowserService = Depends(get_browser_service),
    _: BrowserActor = Depends(get_current_account_admin),
) -> BrowserStsCredentials:
    try:
        return service.get_sts_credentials(account)
    except RuntimeError as exc:
        raise_bad_gateway_from_runtime(exc)


@router.get("/buckets/{bucket_name}/versions", response_model=ListObjectVersionsResponse)
def list_versions(
    bucket_name: str,
    prefix: str = "",
    key: Optional[str] = None,
    key_marker: Optional[str] = None,
    version_id_marker: Optional[str] = None,
    max_keys: int = Query(default=1000, ge=1, le=1000),
    account: S3Account = Depends(get_account_context),
    service: BrowserService = Depends(get_browser_service),
    _: BrowserActor = Depends(get_current_account_admin),
) -> ListObjectVersionsResponse:
    try:
        return service.list_object_versions(
            bucket_name,
            account,
            prefix=prefix,
            key=key,
            key_marker=key_marker,
            version_id_marker=version_id_marker,
            max_keys=max_keys,
        )
    except RuntimeError as exc:
        raise_bad_gateway_from_runtime(exc)


@router.get("/buckets/{bucket_name}/object-meta", response_model=ObjectMetadata)
def head_object(
    bucket_name: str,
    key: str,
    version_id: Optional[str] = None,
    account: S3Account = Depends(get_account_context),
    service: BrowserService = Depends(get_browser_service),
    sse_customer: Optional[SseCustomerContext] = Depends(get_optional_sse_customer_context),
    _: BrowserActor = Depends(get_current_account_admin),
) -> ObjectMetadata:
    if not key:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing key")
    if sse_customer:
        _common_require_sse_feature(account)
    try:
        return service.head_object(bucket_name, account, key, version_id=version_id, sse_customer=sse_customer)
    except RuntimeError as exc:
        raise_bad_gateway_from_runtime(exc)


@router.put("/buckets/{bucket_name}/object-meta", response_model=ObjectMetadata)
def update_object_metadata(
    bucket_name: str,
    payload: ObjectMetadataUpdate,
    account: S3Account = Depends(get_account_context),
    service: BrowserService = Depends(get_browser_service),
    actor: BrowserActor = Depends(get_current_account_admin),
    audit_service: AuditService = Depends(get_audit_logger),
) -> ObjectMetadata:
    try:
        result = service.update_object_metadata(bucket_name, account, payload)
        _common_record_browser_action(audit_service, actor=actor, scope="browser",
            action="update_object_metadata",
            entity_type="object",
            entity_id=f"{bucket_name}/{payload.key}",
            account=account,
            metadata={"version_id": payload.version_id},
        )
        return result
    except RuntimeError as exc:
        raise_bad_gateway_from_runtime(exc)


@router.get("/buckets/{bucket_name}/object-tags", response_model=ObjectTags)
def get_object_tags(
    bucket_name: str,
    key: str,
    version_id: Optional[str] = None,
    account: S3Account = Depends(get_account_context),
    service: BrowserService = Depends(get_browser_service),
    _: BrowserActor = Depends(get_current_account_admin),
) -> ObjectTags:
    if not key:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing key")
    try:
        return service.get_object_tags(bucket_name, account, key, version_id=version_id)
    except RuntimeError as exc:
        raise_bad_gateway_from_runtime(exc)


@router.put("/buckets/{bucket_name}/object-tags", response_model=ObjectTags)
def put_object_tags(
    bucket_name: str,
    payload: ObjectTags,
    account: S3Account = Depends(get_account_context),
    service: BrowserService = Depends(get_browser_service),
    actor: BrowserActor = Depends(get_current_account_admin),
    audit_service: AuditService = Depends(get_audit_logger),
) -> ObjectTags:
    if not payload.key:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing key")
    try:
        result = service.put_object_tags(bucket_name, account, payload.key, payload.tags, version_id=payload.version_id)
        _common_record_browser_action(audit_service, actor=actor, scope="browser",
            action="put_object_tags",
            entity_type="object",
            entity_id=f"{bucket_name}/{payload.key}",
            account=account,
            metadata={"version_id": payload.version_id},
        )
        return result
    except RuntimeError as exc:
        raise_bad_gateway_from_runtime(exc)


@router.get("/buckets/{bucket_name}/object-acl", response_model=ObjectAcl)
def get_object_acl(
    bucket_name: str,
    key: str,
    version_id: Optional[str] = None,
    account: S3Account = Depends(get_account_context),
    service: BrowserService = Depends(get_browser_service),
    _: BrowserActor = Depends(get_current_account_admin),
) -> ObjectAcl:
    if not key:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing key")
    try:
        return service.get_object_acl(bucket_name, account, key, version_id=version_id)
    except RuntimeError as exc:
        raise_bad_gateway_from_runtime(exc)


@router.put("/buckets/{bucket_name}/object-acl", response_model=ObjectAcl)
def put_object_acl(
    bucket_name: str,
    payload: ObjectAcl,
    account: S3Account = Depends(get_account_context),
    service: BrowserService = Depends(get_browser_service),
    actor: BrowserActor = Depends(get_current_account_admin),
    audit_service: AuditService = Depends(get_audit_logger),
) -> ObjectAcl:
    try:
        result = service.put_object_acl(bucket_name, account, payload)
        _common_record_browser_action(audit_service, actor=actor, scope="browser",
            action="put_object_acl",
            entity_type="object",
            entity_id=f"{bucket_name}/{payload.key}",
            account=account,
            metadata={"version_id": payload.version_id},
        )
        return result
    except RuntimeError as exc:
        raise_bad_gateway_from_runtime(exc)


@router.get("/buckets/{bucket_name}/object-legal-hold", response_model=ObjectLegalHold)
def get_object_legal_hold(
    bucket_name: str,
    key: str,
    version_id: Optional[str] = None,
    account: S3Account = Depends(get_account_context),
    service: BrowserService = Depends(get_browser_service),
    _: BrowserActor = Depends(get_current_account_admin),
) -> ObjectLegalHold:
    if not key:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing key")
    try:
        return service.get_object_legal_hold(bucket_name, account, key, version_id=version_id)
    except RuntimeError as exc:
        raise_bad_gateway_from_runtime(exc)


@router.put("/buckets/{bucket_name}/object-legal-hold", response_model=ObjectLegalHold)
def put_object_legal_hold(
    bucket_name: str,
    payload: ObjectLegalHold,
    account: S3Account = Depends(get_account_context),
    service: BrowserService = Depends(get_browser_service),
    actor: BrowserActor = Depends(get_current_account_admin),
    audit_service: AuditService = Depends(get_audit_logger),
) -> ObjectLegalHold:
    try:
        result = service.put_object_legal_hold(bucket_name, account, payload)
        _common_record_browser_action(audit_service, actor=actor, scope="browser",
            action="put_object_legal_hold",
            entity_type="object",
            entity_id=f"{bucket_name}/{payload.key}",
            account=account,
            metadata={"version_id": payload.version_id},
        )
        return result
    except RuntimeError as exc:
        raise_bad_gateway_from_runtime(exc)


@router.get("/buckets/{bucket_name}/object-retention", response_model=ObjectRetention)
def get_object_retention(
    bucket_name: str,
    key: str,
    version_id: Optional[str] = None,
    account: S3Account = Depends(get_account_context),
    service: BrowserService = Depends(get_browser_service),
    _: BrowserActor = Depends(get_current_account_admin),
) -> ObjectRetention:
    if not key:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing key")
    try:
        return service.get_object_retention(bucket_name, account, key, version_id=version_id)
    except RuntimeError as exc:
        raise_bad_gateway_from_runtime(exc)


@router.put("/buckets/{bucket_name}/object-retention", response_model=ObjectRetention)
def put_object_retention(
    bucket_name: str,
    payload: ObjectRetention,
    account: S3Account = Depends(get_account_context),
    service: BrowserService = Depends(get_browser_service),
    actor: BrowserActor = Depends(get_current_account_admin),
    audit_service: AuditService = Depends(get_audit_logger),
) -> ObjectRetention:
    try:
        result = service.put_object_retention(bucket_name, account, payload)
        _common_record_browser_action(audit_service, actor=actor, scope="browser",
            action="put_object_retention",
            entity_type="object",
            entity_id=f"{bucket_name}/{payload.key}",
            account=account,
            metadata={"version_id": payload.version_id},
        )
        return result
    except RuntimeError as exc:
        raise_bad_gateway_from_runtime(exc)


@router.post("/buckets/{bucket_name}/objects/delete")
def delete_objects_legacy_tombstone(bucket_name: str) -> None:
    _raise_legacy_route_removed(canonical=f"/browser/buckets/{bucket_name}/delete")


@router.post("/buckets/{bucket_name}/objects/copy")
def copy_object_legacy_tombstone(bucket_name: str) -> None:
    _raise_legacy_route_removed(canonical=f"/browser/buckets/{bucket_name}/copy")


@router.post("/buckets/{bucket_name}/folder")
def create_folder_legacy_tombstone(bucket_name: str) -> None:
    _raise_legacy_route_removed(canonical=f"/browser/buckets/{bucket_name}/folders")


@router.post("/buckets/{bucket_name}/upload/proxy")
def upload_via_proxy_legacy_tombstone(bucket_name: str) -> None:
    _raise_legacy_route_removed(canonical=f"/browser/buckets/{bucket_name}/proxy-upload")


@router.get("/buckets/{bucket_name}/proxy-download")
def download_object_legacy_tombstone(bucket_name: str) -> None:
    _raise_legacy_route_removed(canonical=f"/browser/buckets/{bucket_name}/download")


@router.post("/buckets/{bucket_name}/multipart/init")
def multipart_init_legacy_tombstone(bucket_name: str) -> None:
    _raise_legacy_route_removed(canonical=f"/browser/buckets/{bucket_name}/multipart/initiate")


@router.get("/buckets/{bucket_name}/multipart/uploads")
def list_multipart_uploads_legacy_tombstone(bucket_name: str) -> None:
    _raise_legacy_route_removed(canonical=f"/browser/buckets/{bucket_name}/multipart")


@router.get("/buckets/{bucket_name}/multipart/parts")
def list_parts_legacy_tombstone(bucket_name: str) -> None:
    _raise_legacy_route_removed(canonical=f"/browser/buckets/{bucket_name}/multipart/{{upload_id}}/parts")


@router.post("/buckets/{bucket_name}/multipart/presign")
def presign_part_legacy_tombstone(bucket_name: str) -> None:
    _raise_legacy_route_removed(canonical=f"/browser/buckets/{bucket_name}/multipart/{{upload_id}}/presign")


@router.post("/buckets/{bucket_name}/multipart/complete")
def multipart_complete_legacy_tombstone(bucket_name: str) -> None:
    _raise_legacy_route_removed(canonical=f"/browser/buckets/{bucket_name}/multipart/{{upload_id}}/complete")


@router.post("/buckets/{bucket_name}/cleanup")
def cleanup_object_versions_legacy_tombstone(bucket_name: str) -> None:
    _raise_legacy_route_removed(canonical=f"/browser/buckets/{bucket_name}/versions/cleanup")


@router.post("/buckets/{bucket_name}/delete", response_model=dict)
def delete_objects(
    bucket_name: str,
    payload: DeleteObjectsPayload,
    account: S3Account = Depends(get_account_context),
    service: BrowserService = Depends(get_browser_service),
    actor: BrowserActor = Depends(get_current_account_admin),
    audit_service: AuditService = Depends(get_audit_logger),
) -> dict:
    if not payload.objects:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing objects")
    try:
        deleted = service.delete_objects(bucket_name, account, payload)
        _common_record_browser_action(audit_service, actor=actor, scope="browser",
            action="delete_objects",
            entity_type="bucket",
            entity_id=bucket_name,
            account=account,
            metadata={"count": len(payload.objects)},
        )
        return {"deleted": deleted}
    except RuntimeError as exc:
        raise_bad_gateway_from_runtime(exc)


@router.post("/buckets/{bucket_name}/copy", response_model=dict)
def copy_object(
    bucket_name: str,
    payload: CopyObjectPayload,
    account: S3Account = Depends(get_account_context),
    service: BrowserService = Depends(get_browser_service),
    actor: BrowserActor = Depends(get_current_account_admin),
    audit_service: AuditService = Depends(get_audit_logger),
) -> dict:
    if not payload.source_key or not payload.destination_key:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing source or destination key")
    try:
        service.copy_object(bucket_name, account, payload)
        _common_record_browser_action(audit_service, actor=actor, scope="browser",
            action="copy_object",
            entity_type="object",
            entity_id=f"{bucket_name}/{payload.source_key}",
            account=account,
            metadata={
                "source": payload.source_key,
                "source_bucket": payload.source_bucket or bucket_name,
                "destination_bucket": bucket_name,
                "destination": payload.destination_key,
                "move": payload.move,
                "version_id": payload.source_version_id,
            },
        )
        return {"message": "ok"}
    except RuntimeError as exc:
        raise_bad_gateway_from_runtime(exc)


@router.post("/buckets/{bucket_name}/folders", response_model=dict)
def create_folder(
    bucket_name: str,
    payload: CreateFolderPayload,
    account: S3Account = Depends(get_account_context),
    service: BrowserService = Depends(get_browser_service),
    actor: BrowserActor = Depends(get_current_account_admin),
    audit_service: AuditService = Depends(get_audit_logger),
) -> dict:
    if not payload.prefix:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing prefix")
    try:
        service.create_folder(bucket_name, account, payload.prefix)
        _common_record_browser_action(audit_service, actor=actor, scope="browser",
            action="create_folder",
            entity_type="bucket",
            entity_id=bucket_name,
            account=account,
            metadata={"prefix": payload.prefix},
        )
        return {"message": "created", "prefix": payload.prefix}
    except RuntimeError as exc:
        raise_bad_gateway_from_runtime(exc)


@router.post("/buckets/{bucket_name}/proxy-upload", response_model=ProxyUploadResponse)
def upload_via_proxy(
    bucket_name: str,
    file: UploadFile = File(...),
    key: str = Form(...),
    content_type: Optional[str] = Form(default=None),
    account: S3Account = Depends(get_account_context),
    service: BrowserService = Depends(get_browser_service),
    sse_customer: Optional[SseCustomerContext] = Depends(get_optional_sse_customer_context),
    actor: BrowserActor = Depends(get_current_account_admin),
    audit_service: AuditService = Depends(get_audit_logger),
) -> ProxyUploadResponse:
    if not key:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing key")
    if sse_customer:
        _common_require_sse_feature(account)
    try:
        service.upload_via_proxy(
            bucket_name,
            account,
            file,
            key=key,
            content_type=content_type,
            sse_customer=sse_customer,
        )
        _common_record_browser_action(audit_service, actor=actor, scope="browser",
            action="upload_via_proxy",
            entity_type="object",
            entity_id=f"{bucket_name}/{key}",
            account=account,
        )
        return ProxyUploadResponse(message="Upload completed", key=key)
    except RuntimeError as exc:
        raise_bad_gateway_from_runtime(exc)


@router.get("/buckets/{bucket_name}/download")
def download_object(
    bucket_name: str,
    key: str,
    version_id: Optional[str] = None,
    account: S3Account = Depends(get_account_context),
    service: BrowserService = Depends(get_browser_service),
    sse_customer: Optional[SseCustomerContext] = Depends(get_optional_sse_customer_context),
    _: BrowserActor = Depends(get_current_account_admin),
) -> StreamingResponse:
    if not key:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing key")
    if sse_customer:
        _common_require_sse_feature(account)
    try:
        stream, content_type, filename = service.download_object(
            bucket_name,
            account,
            key,
            version_id=version_id,
            sse_customer=sse_customer,
        )
        headers = {}
        if filename:
            headers["Content-Disposition"] = f'attachment; filename="{filename}"'
        return StreamingResponse(stream, media_type=content_type or "application/octet-stream", headers=headers)
    except RuntimeError as exc:
        raise_bad_gateway_from_runtime(exc)


@router.post("/buckets/{bucket_name}/presign", response_model=PresignedUrl)
def presign(
    bucket_name: str,
    payload: PresignRequest,
    account: S3Account = Depends(get_account_context),
    service: BrowserService = Depends(get_browser_service),
    sse_customer: Optional[SseCustomerContext] = Depends(get_optional_sse_customer_context),
    _: BrowserActor = Depends(get_current_account_admin),
) -> PresignedUrl:
    if sse_customer:
        _common_require_sse_feature(account)
    try:
        return service.presign(bucket_name, account, payload, sse_customer=sse_customer)
    except RuntimeError as exc:
        raise_bad_gateway_from_runtime(exc)


@router.post("/buckets/{bucket_name}/multipart/initiate", response_model=MultipartUploadInitResponse)
def multipart_init(
    bucket_name: str,
    payload: MultipartUploadInitRequest,
    account: S3Account = Depends(get_account_context),
    service: BrowserService = Depends(get_browser_service),
    sse_customer: Optional[SseCustomerContext] = Depends(get_optional_sse_customer_context),
    actor: BrowserActor = Depends(get_current_account_admin),
    audit_service: AuditService = Depends(get_audit_logger),
) -> MultipartUploadInitResponse:
    if not payload.key:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing key")
    if sse_customer:
        _common_require_sse_feature(account)
    try:
        result = service.initiate_multipart_upload(bucket_name, account, payload, sse_customer=sse_customer)
        _common_record_browser_action(audit_service, actor=actor, scope="browser",
            action="multipart_init",
            entity_type="object",
            entity_id=f"{bucket_name}/{payload.key}",
            account=account,
        )
        return result
    except RuntimeError as exc:
        raise_bad_gateway_from_runtime(exc)


@router.get("/buckets/{bucket_name}/multipart", response_model=ListMultipartUploadsResponse)
def list_multipart_uploads(
    bucket_name: str,
    prefix: Optional[str] = None,
    key_marker: Optional[str] = None,
    upload_id_marker: Optional[str] = None,
    max_uploads: int = Query(default=1000, ge=1, le=1000),
    account: S3Account = Depends(get_account_context),
    service: BrowserService = Depends(get_browser_service),
    _: BrowserActor = Depends(get_current_account_admin),
) -> ListMultipartUploadsResponse:
    try:
        return service.list_multipart_uploads(
            bucket_name,
            account,
            prefix=prefix,
            key_marker=key_marker,
            upload_id_marker=upload_id_marker,
            max_uploads=max_uploads,
        )
    except RuntimeError as exc:
        raise_bad_gateway_from_runtime(exc)


@router.get("/buckets/{bucket_name}/multipart/{upload_id}/parts", response_model=ListPartsResponse)
def list_parts_for_upload(
    bucket_name: str,
    upload_id: str,
    key: str,
    part_number_marker: Optional[int] = None,
    max_parts: int = Query(default=1000, ge=1, le=1000),
    account: S3Account = Depends(get_account_context),
    service: BrowserService = Depends(get_browser_service),
    _: BrowserActor = Depends(get_current_account_admin),
) -> ListPartsResponse:
    try:
        return service.list_parts(
            bucket_name,
            account,
            key=key,
            upload_id=upload_id,
            part_number_marker=part_number_marker,
            max_parts=max_parts,
        )
    except RuntimeError as exc:
        raise_bad_gateway_from_runtime(exc)


@router.post("/buckets/{bucket_name}/multipart/{upload_id}/presign", response_model=PresignPartResponse)
def presign_part_for_upload(
    bucket_name: str,
    upload_id: str,
    payload: PresignPartRequest,
    account: S3Account = Depends(get_account_context),
    service: BrowserService = Depends(get_browser_service),
    sse_customer: Optional[SseCustomerContext] = Depends(get_optional_sse_customer_context),
    _: BrowserActor = Depends(get_current_account_admin),
) -> PresignPartResponse:
    if not payload.key:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing key")
    payload.upload_id = upload_id
    if sse_customer:
        _common_require_sse_feature(account)
    try:
        return service.presign_part(bucket_name, account, payload, sse_customer=sse_customer)
    except RuntimeError as exc:
        raise_bad_gateway_from_runtime(exc)


@router.post("/buckets/{bucket_name}/multipart/{upload_id}/complete", response_model=dict)
def complete_multipart_upload(
    bucket_name: str,
    upload_id: str,
    key: str,
    payload: CompleteMultipartUploadRequest,
    account: S3Account = Depends(get_account_context),
    service: BrowserService = Depends(get_browser_service),
    actor: BrowserActor = Depends(get_current_account_admin),
    audit_service: AuditService = Depends(get_audit_logger),
) -> dict:
    if not key:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing key")
    try:
        service.complete_multipart_upload(bucket_name, account, key, upload_id, payload)
        _common_record_browser_action(audit_service, actor=actor, scope="browser",
            action="multipart_complete",
            entity_type="object",
            entity_id=f"{bucket_name}/{key}",
            account=account,
        )
        return {"message": "completed"}
    except RuntimeError as exc:
        raise_bad_gateway_from_runtime(exc)


@router.delete("/buckets/{bucket_name}/multipart/{upload_id}", response_model=dict)
def abort_multipart_upload(
    bucket_name: str,
    upload_id: str,
    key: str,
    account: S3Account = Depends(get_account_context),
    service: BrowserService = Depends(get_browser_service),
    actor: BrowserActor = Depends(get_current_account_admin),
    audit_service: AuditService = Depends(get_audit_logger),
) -> dict:
    if not key:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing key")
    try:
        service.abort_multipart_upload(bucket_name, account, key, upload_id)
        _common_record_browser_action(audit_service, actor=actor, scope="browser",
            action="multipart_abort",
            entity_type="object",
            entity_id=f"{bucket_name}/{key}",
            account=account,
        )
        return {"message": "aborted"}
    except RuntimeError as exc:
        raise_bad_gateway_from_runtime(exc)


@router.post("/buckets/{bucket_name}/object-restore", response_model=dict)
def restore_object(
    bucket_name: str,
    payload: ObjectRestoreRequest,
    account: S3Account = Depends(get_account_context),
    service: BrowserService = Depends(get_browser_service),
    actor: BrowserActor = Depends(get_current_account_admin),
    audit_service: AuditService = Depends(get_audit_logger),
) -> dict:
    try:
        result = service.restore_object(bucket_name, account, payload)
        _common_record_browser_action(audit_service, actor=actor, scope="browser",
            action="restore_object",
            entity_type="object",
            entity_id=f"{bucket_name}/{payload.key}",
            account=account,
            metadata={"days": payload.days, "tier": payload.tier, "version_id": payload.version_id},
        )
        return result
    except RuntimeError as exc:
        raise_bad_gateway_from_runtime(exc)


@router.post("/buckets/{bucket_name}/versions/cleanup", response_model=CleanupObjectVersionsResponse)
def cleanup_object_versions(
    bucket_name: str,
    payload: CleanupObjectVersionsPayload,
    account: S3Account = Depends(get_account_context),
    service: BrowserService = Depends(get_browser_service),
    actor: BrowserActor = Depends(get_current_account_admin),
    audit_service: AuditService = Depends(get_audit_logger),
) -> CleanupObjectVersionsResponse:
    try:
        result = service.cleanup_object_versions(bucket_name, account, payload)
        _common_record_browser_action(audit_service, actor=actor, scope="browser",
            action="cleanup_object_versions",
            entity_type="bucket",
            entity_id=bucket_name,
            account=account,
        )
        return result
    except RuntimeError as exc:
        raise_bad_gateway_from_runtime(exc)
