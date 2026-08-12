# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Ceph Admin bucket configuration endpoints."""

from typing import Any, Callable, Literal

from fastapi import APIRouter, Depends, HTTPException, Response, status

from app.models.bucket import (
    BucketAcl,
    BucketAclUpdate,
    BucketCorsUpdate,
    BucketEncryptionConfiguration,
    BucketLifecycleConfig,
    BucketLoggingConfiguration,
    BucketNotificationConfiguration,
    BucketObjectLock,
    BucketObjectLockUpdate,
    BucketPolicyIn,
    BucketPolicyOut,
    BucketProperties,
    BucketPublicAccessBlock,
    BucketQuotaUpdate,
    BucketReplicationConfiguration,
    BucketTagsUpdate,
    BucketVersioningStatus,
    BucketVersioningUpdate,
    BucketWebsiteConfiguration,
)
from app.routers.ceph_admin.audit import record_ceph_admin_action
from app.routers.ceph_admin.bucket_listing_cache import invalidate_bucket_listing_cache
from app.routers.ceph_admin.dependencies import (
    CephAdminContext,
    build_ceph_admin_s3_context,
    get_ceph_admin_context,
)
from app.services import bucket_config_actions
from app.services.buckets_service import BucketsService
from app.services.rgw_admin import RGWAdminError
from app.services.s3_execution_context import S3ExecutionContext
from app.services.bucket_listing_enrichment import _resolve_bucket_owner_identity
from app.utils.http_errors import raise_bad_gateway_from_runtime, raise_bad_request_from_value_error
from app.utils.storage_endpoint_features import resolve_feature_flags

router = APIRouter()


def _require_sse_feature(ctx: CephAdminContext) -> None:
    if not resolve_feature_flags(ctx.endpoint).sse_enabled:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Server-side encryption is disabled for this endpoint",
        )


def _require_replication_feature(ctx: CephAdminContext) -> None:
    if not resolve_feature_flags(ctx.endpoint).replication_enabled:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Bucket replication is disabled for this endpoint",
        )


def _record_bucket_config_mutation(
    ctx: CephAdminContext,
    bucket_name: str,
    *,
    config_area: str,
    operation: Literal["update", "delete"],
    metadata: dict[str, Any] | None = None,
) -> None:
    invalidate_bucket_listing_cache(ctx.endpoint.id)
    record_ceph_admin_action(
        ctx,
        action=f"bucket_config.{config_area}.{operation}",
        entity_type="bucket",
        entity_id=bucket_name,
        metadata=bucket_config_actions.bucket_config_audit_metadata(
            config_area=config_area,
            operation=operation,
            metadata=metadata,
        ),
    )


def _ceph_admin_bucket_config_account(ctx: CephAdminContext) -> tuple[BucketsService, S3ExecutionContext]:
    return BucketsService(), build_ceph_admin_s3_context(ctx)


def _run_bucket_config_update(
    ctx: CephAdminContext,
    bucket_name: str,
    *,
    config_area: str,
    action: Callable[..., tuple[Any, dict[str, Any]]],
    **kwargs: Any,
) -> Any:
    service, account = _ceph_admin_bucket_config_account(ctx)
    return bucket_config_actions.apply_bucket_config_update(
        service=service,
        account=account,
        bucket_name=bucket_name,
        action=action,
        audit_recorder=lambda metadata: _record_bucket_config_mutation(
            ctx,
            bucket_name,
            config_area=config_area,
            operation="update",
            metadata=metadata,
        ),
        **kwargs,
    )


def _run_bucket_config_delete(
    ctx: CephAdminContext,
    bucket_name: str,
    *,
    config_area: str,
    action: Callable[..., None],
) -> Response:
    service, account = _ceph_admin_bucket_config_account(ctx)
    return bucket_config_actions.apply_bucket_config_delete(
        service=service,
        account=account,
        bucket_name=bucket_name,
        action=action,
        audit_recorder=lambda metadata: _record_bucket_config_mutation(
            ctx,
            bucket_name,
            config_area=config_area,
            operation="delete",
            metadata=metadata,
        ),
    )


@router.get("/{bucket_name}/properties", response_model=BucketProperties)
def bucket_properties(
    bucket_name: str,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> BucketProperties:
    service = BucketsService()
    account = build_ceph_admin_s3_context(ctx)
    return bucket_config_actions.get_bucket_properties_config(
        service=service,
        account=account,
        bucket_name=bucket_name,
    )


@router.get("/{bucket_name}/versioning", response_model=BucketVersioningStatus)
def get_versioning(
    bucket_name: str,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> BucketVersioningStatus:
    service = BucketsService()
    account = build_ceph_admin_s3_context(ctx)
    return bucket_config_actions.get_bucket_versioning_config(
        service=service,
        account=account,
        bucket_name=bucket_name,
    )


@router.put("/{bucket_name}/versioning", status_code=status.HTTP_200_OK)
def update_versioning(
    bucket_name: str,
    payload: BucketVersioningUpdate,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
):
    return _run_bucket_config_update(
        ctx,
        bucket_name,
        config_area="versioning",
        action=bucket_config_actions.update_bucket_versioning_config,
        payload=payload,
    )


@router.put("/{bucket_name}/quota", status_code=status.HTTP_200_OK)
def update_quota(
    bucket_name: str,
    payload: BucketQuotaUpdate,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
):
    service = BucketsService()
    account = build_ceph_admin_s3_context(ctx)
    try:
        bucket_info = ctx.rgw_admin.get_bucket_info(bucket_name, stats=False, allow_not_found=True)
    except RGWAdminError as exc:
        raise_bad_gateway_from_runtime(exc)
    if not bucket_info or (isinstance(bucket_info, dict) and bucket_info.get("not_found")):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Bucket not found")

    owner_account_id, owner_uid = _resolve_bucket_owner_identity(bucket_info)
    if not owner_account_id and not owner_uid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unable to resolve bucket owner for quota update",
        )
    account.rgw_account_id = owner_account_id
    account.rgw_user_uid = owner_uid

    try:
        service.set_bucket_quota(bucket_name, account, payload, rgw_admin=ctx.rgw_admin)
        invalidate_bucket_listing_cache(ctx.endpoint.id)
        record_ceph_admin_action(
            ctx,
            action="bucket_quota.update",
            entity_type="bucket",
            entity_id=bucket_name,
            metadata=bucket_config_actions.bucket_config_audit_metadata(
                config_area="quota",
                operation="update",
                metadata={
                    "owner_account_id": owner_account_id,
                    "owner_uid": owner_uid,
                    "quota": payload.model_dump(exclude_none=True),
                },
            ),
        )
        return {"message": "Bucket quota updated"}
    except ValueError as exc:
        raise_bad_request_from_value_error(exc)
    except RuntimeError as exc:
        raise_bad_gateway_from_runtime(exc)


@router.get("/{bucket_name}/lifecycle", response_model=BucketLifecycleConfig)
def get_lifecycle(
    bucket_name: str,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> BucketLifecycleConfig:
    service = BucketsService()
    account = build_ceph_admin_s3_context(ctx)
    return bucket_config_actions.get_bucket_lifecycle_config(
        service=service,
        account=account,
        bucket_name=bucket_name,
    )


@router.put("/{bucket_name}/lifecycle", response_model=BucketLifecycleConfig)
def put_lifecycle(
    bucket_name: str,
    payload: BucketLifecycleConfig,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> BucketLifecycleConfig:
    return _run_bucket_config_update(
        ctx,
        bucket_name,
        config_area="lifecycle",
        action=bucket_config_actions.put_bucket_lifecycle_config,
        payload=payload,
    )


@router.delete("/{bucket_name}/lifecycle", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def delete_lifecycle(
    bucket_name: str,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> Response:
    return _run_bucket_config_delete(
        ctx,
        bucket_name,
        config_area="lifecycle",
        action=bucket_config_actions.delete_bucket_lifecycle_config,
    )


@router.get("/{bucket_name}/cors")
def get_cors(
    bucket_name: str,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
):
    service = BucketsService()
    account = build_ceph_admin_s3_context(ctx)
    return bucket_config_actions.get_bucket_cors_config(
        service=service,
        account=account,
        bucket_name=bucket_name,
    )


@router.put("/{bucket_name}/cors")
def put_cors(
    bucket_name: str,
    payload: BucketCorsUpdate,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
):
    return _run_bucket_config_update(
        ctx,
        bucket_name,
        config_area="cors",
        action=bucket_config_actions.put_bucket_cors_config,
        payload=payload,
    )


@router.delete("/{bucket_name}/cors", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def delete_cors(
    bucket_name: str,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> Response:
    return _run_bucket_config_delete(
        ctx,
        bucket_name,
        config_area="cors",
        action=bucket_config_actions.delete_bucket_cors_config,
    )


@router.get("/{bucket_name}/policy", response_model=BucketPolicyOut)
def get_policy(
    bucket_name: str,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> BucketPolicyOut:
    service = BucketsService()
    account = build_ceph_admin_s3_context(ctx)
    return bucket_config_actions.get_bucket_policy_config(
        service=service,
        account=account,
        bucket_name=bucket_name,
    )


@router.put("/{bucket_name}/policy", response_model=BucketPolicyOut)
def put_policy(
    bucket_name: str,
    payload: BucketPolicyIn,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> BucketPolicyOut:
    return _run_bucket_config_update(
        ctx,
        bucket_name,
        config_area="policy",
        action=bucket_config_actions.put_bucket_policy_config,
        payload=payload,
    )


@router.delete("/{bucket_name}/policy", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def delete_policy(
    bucket_name: str,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> Response:
    return _run_bucket_config_delete(
        ctx,
        bucket_name,
        config_area="policy",
        action=bucket_config_actions.delete_bucket_policy_config,
    )


@router.get("/{bucket_name}/notifications", response_model=BucketNotificationConfiguration)
def get_notifications(
    bucket_name: str,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> BucketNotificationConfiguration:
    service = BucketsService()
    account = build_ceph_admin_s3_context(ctx)
    return bucket_config_actions.get_bucket_notifications_config(
        service=service,
        account=account,
        bucket_name=bucket_name,
    )


@router.put("/{bucket_name}/notifications", response_model=BucketNotificationConfiguration)
def put_notifications(
    bucket_name: str,
    payload: BucketNotificationConfiguration,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> BucketNotificationConfiguration:
    return _run_bucket_config_update(
        ctx,
        bucket_name,
        config_area="notifications",
        action=bucket_config_actions.put_bucket_notifications_config,
        payload=payload,
    )


@router.delete("/{bucket_name}/notifications", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def delete_notifications(
    bucket_name: str,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> Response:
    return _run_bucket_config_delete(
        ctx,
        bucket_name,
        config_area="notifications",
        action=bucket_config_actions.delete_bucket_notifications_config,
    )


@router.get("/{bucket_name}/replication", response_model=BucketReplicationConfiguration)
def get_replication(
    bucket_name: str,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> BucketReplicationConfiguration:
    _require_replication_feature(ctx)
    service = BucketsService()
    account = build_ceph_admin_s3_context(ctx)
    return bucket_config_actions.get_bucket_replication_config(
        service=service,
        account=account,
        bucket_name=bucket_name,
    )


@router.put("/{bucket_name}/replication", response_model=BucketReplicationConfiguration)
def put_replication(
    bucket_name: str,
    payload: BucketReplicationConfiguration,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> BucketReplicationConfiguration:
    _require_replication_feature(ctx)
    return _run_bucket_config_update(
        ctx,
        bucket_name,
        config_area="replication",
        action=bucket_config_actions.put_bucket_replication_config,
        payload=payload,
    )


@router.delete("/{bucket_name}/replication", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def delete_replication(
    bucket_name: str,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> Response:
    _require_replication_feature(ctx)
    return _run_bucket_config_delete(
        ctx,
        bucket_name,
        config_area="replication",
        action=bucket_config_actions.delete_bucket_replication_config,
    )


@router.get("/{bucket_name}/logging", response_model=BucketLoggingConfiguration)
def get_logging(
    bucket_name: str,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> BucketLoggingConfiguration:
    service = BucketsService()
    account = build_ceph_admin_s3_context(ctx)
    return bucket_config_actions.get_bucket_logging_config(
        service=service,
        account=account,
        bucket_name=bucket_name,
    )


@router.put("/{bucket_name}/logging", response_model=BucketLoggingConfiguration)
def put_logging(
    bucket_name: str,
    payload: BucketLoggingConfiguration,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> BucketLoggingConfiguration:
    return _run_bucket_config_update(
        ctx,
        bucket_name,
        config_area="logging",
        action=bucket_config_actions.put_bucket_logging_config,
        payload=payload,
    )


@router.delete("/{bucket_name}/logging", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def delete_logging(
    bucket_name: str,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> Response:
    return _run_bucket_config_delete(
        ctx,
        bucket_name,
        config_area="logging",
        action=bucket_config_actions.delete_bucket_logging_config,
    )


@router.get("/{bucket_name}/website", response_model=BucketWebsiteConfiguration)
def get_website(
    bucket_name: str,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> BucketWebsiteConfiguration:
    service = BucketsService()
    account = build_ceph_admin_s3_context(ctx)
    return bucket_config_actions.get_bucket_website_config(
        service=service,
        account=account,
        bucket_name=bucket_name,
    )


@router.put("/{bucket_name}/website", response_model=BucketWebsiteConfiguration)
def put_website(
    bucket_name: str,
    payload: BucketWebsiteConfiguration,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> BucketWebsiteConfiguration:
    return _run_bucket_config_update(
        ctx,
        bucket_name,
        config_area="website",
        action=bucket_config_actions.put_bucket_website_config,
        payload=payload,
    )


@router.delete("/{bucket_name}/website", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def delete_website(
    bucket_name: str,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> Response:
    return _run_bucket_config_delete(
        ctx,
        bucket_name,
        config_area="website",
        action=bucket_config_actions.delete_bucket_website_config,
    )


@router.get("/{bucket_name}/tags")
def get_tags(
    bucket_name: str,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
):
    service = BucketsService()
    account = build_ceph_admin_s3_context(ctx)
    return bucket_config_actions.get_bucket_tags_config(
        service=service,
        account=account,
        bucket_name=bucket_name,
    )


@router.put("/{bucket_name}/tags")
def put_tags(
    bucket_name: str,
    payload: BucketTagsUpdate,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
):
    return _run_bucket_config_update(
        ctx,
        bucket_name,
        config_area="tags",
        action=bucket_config_actions.put_bucket_tags_config,
        payload=payload,
    )


@router.delete("/{bucket_name}/tags", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def delete_tags(
    bucket_name: str,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> Response:
    return _run_bucket_config_delete(
        ctx,
        bucket_name,
        config_area="tags",
        action=bucket_config_actions.delete_bucket_tags_config,
    )


@router.get("/{bucket_name}/acl", response_model=BucketAcl)
def get_acl(
    bucket_name: str,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> BucketAcl:
    service = BucketsService()
    account = build_ceph_admin_s3_context(ctx)
    return bucket_config_actions.get_bucket_acl_config(
        service=service,
        account=account,
        bucket_name=bucket_name,
    )


@router.put("/{bucket_name}/acl", response_model=BucketAcl)
def put_acl(
    bucket_name: str,
    payload: BucketAclUpdate,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> BucketAcl:
    return _run_bucket_config_update(
        ctx,
        bucket_name,
        config_area="acl",
        action=bucket_config_actions.put_bucket_acl_config,
        payload=payload,
    )


@router.get("/{bucket_name}/public-access-block", response_model=BucketPublicAccessBlock)
def get_public_access_block(
    bucket_name: str,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> BucketPublicAccessBlock:
    service = BucketsService()
    account = build_ceph_admin_s3_context(ctx)
    return bucket_config_actions.get_bucket_public_access_block_config(
        service=service,
        account=account,
        bucket_name=bucket_name,
    )


@router.put("/{bucket_name}/public-access-block", response_model=BucketPublicAccessBlock)
def put_public_access_block(
    bucket_name: str,
    payload: BucketPublicAccessBlock,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> BucketPublicAccessBlock:
    return _run_bucket_config_update(
        ctx,
        bucket_name,
        config_area="public_access_block",
        action=bucket_config_actions.put_bucket_public_access_block_config,
        payload=payload,
    )


@router.get("/{bucket_name}/object-lock", response_model=BucketObjectLock)
def get_object_lock(
    bucket_name: str,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> BucketObjectLock:
    service = BucketsService()
    account = build_ceph_admin_s3_context(ctx)
    return bucket_config_actions.get_bucket_object_lock_config(
        service=service,
        account=account,
        bucket_name=bucket_name,
    )


@router.put("/{bucket_name}/object-lock", response_model=BucketObjectLock)
def put_object_lock(
    bucket_name: str,
    payload: BucketObjectLockUpdate,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> BucketObjectLock:
    return _run_bucket_config_update(
        ctx,
        bucket_name,
        config_area="object_lock",
        action=bucket_config_actions.put_bucket_object_lock_config,
        payload=payload,
    )


@router.get("/{bucket_name}/encryption", response_model=BucketEncryptionConfiguration)
def get_bucket_encryption(
    bucket_name: str,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> BucketEncryptionConfiguration:
    _require_sse_feature(ctx)
    service = BucketsService()
    account = build_ceph_admin_s3_context(ctx)
    return bucket_config_actions.get_bucket_encryption_config(
        service=service,
        account=account,
        bucket_name=bucket_name,
    )


@router.put("/{bucket_name}/encryption", response_model=BucketEncryptionConfiguration)
def put_bucket_encryption(
    bucket_name: str,
    payload: BucketEncryptionConfiguration,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> BucketEncryptionConfiguration:
    _require_sse_feature(ctx)
    return _run_bucket_config_update(
        ctx,
        bucket_name,
        config_area="encryption",
        action=bucket_config_actions.put_bucket_encryption_config,
        payload=payload,
    )


@router.delete("/{bucket_name}/encryption", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def delete_bucket_encryption(
    bucket_name: str,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> Response:
    _require_sse_feature(ctx)
    return _run_bucket_config_delete(
        ctx,
        bucket_name,
        config_area="encryption",
        action=bucket_config_actions.delete_bucket_encryption_config,
    )
