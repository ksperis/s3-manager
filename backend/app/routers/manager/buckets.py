# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import logging
from functools import partial

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.db import User
from app.models.access_context import ManagerActor
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
    BucketVersioningUpdate,
    BucketVersioningStatus,
    BucketTagsUpdate,
    BucketWebsiteConfiguration,
)
from app.models.manager_bucket_compare import (
    ManagerBucketCompareActionRequest,
    ManagerBucketCompareActionResult,
    ManagerBucketCompareRequest,
    ManagerBucketCompareResult,
)
from app.models.bucket_purge import (
    BucketDeleteWithPurgeRequest,
    BucketPurgeResult,
    bucket_delete_with_purge_confirmation_phrase,
)
from app.routers.bucket_purge_stream import (
    BucketPurgeAuditLifecycle,
    record_bucket_purge_audit,
    stream_bucket_purge,
)
from app.services.audit_service import AuditService
from app.services.buckets_service import BucketsService, get_buckets_service
from app.services.s3_execution_context import S3ExecutionContext
from app.services import bucket_config_actions
from app.services.bucket_purge_service import (
    BucketPurgeOptions,
    BucketPurgeResolvedTarget,
    BucketPurgeService,
)
from app.services.bucket_listing_cache import (
    get_cached_bucket_listing_for_account,
    invalidate_bucket_listing_cache_for_account,
)
from app.services.bucket_listing_shared import parse_includes
from app.routers.browser_common import require_replication_feature, require_sse_feature
from app.services.manager_bucket_compare_service import (
    InvalidManagerBucketComparisonError,
    compare_manager_buckets,
    remediate_manager_bucket_comparison,
)
from app.utils.http_errors import raise_bad_gateway_from_runtime, raise_bad_request_from_value_error
from app.routers.manager.access import require_bucket_management_context
from app.routers.dependencies import (
    get_account_context,
    get_audit_service,
    get_current_account_admin,
    get_current_user,
    require_bucket_compare_enabled,
    require_bucket_purge_enabled,
    require_manager_bucket_quota,
)

router = APIRouter(prefix="/manager/buckets", tags=["manager-buckets"])
logger = logging.getLogger(__name__)


def _invalidate_bucket_listing_for_account(account: S3ExecutionContext) -> None:
    invalidate_bucket_listing_cache_for_account(account)

@router.get("", response_model=list[Bucket])
def list_buckets(
    include: list[str] = Query(default=[], description="Optional extra fields to include (e.g. tags, versioning, cors)"),
    with_stats: bool = Query(True, description="Include usage/quota stats from admin listing"),
    account: S3ExecutionContext = Depends(get_account_context),
    service: BucketsService = Depends(get_buckets_service),
    _: ManagerActor = Depends(get_current_account_admin),
) -> list[Bucket]:
    try:
        include_set = parse_includes(include)
        return get_cached_bucket_listing_for_account(
            account=account,
            include=include_set,
            with_stats=with_stats,
            builder=lambda: service.list_buckets(account, include=include_set, with_stats=with_stats),
        )
    except RuntimeError as exc:
        raise_bad_gateway_from_runtime(exc)


@router.get("/{bucket_name}/stats", response_model=Bucket)
def get_bucket_stats(
    bucket_name: str,
    with_stats: bool = Query(True, description="Include usage/quota stats when available"),
    account: S3ExecutionContext = Depends(get_account_context),
    service: BucketsService = Depends(get_buckets_service),
    _: ManagerActor = Depends(get_current_account_admin),
) -> Bucket:
    try:
        return service.get_bucket_stats(bucket_name, account, with_stats=with_stats)
    except RuntimeError as exc:
        raise_bad_gateway_from_runtime(exc)


@router.put("/{bucket_name}/quota", status_code=status.HTTP_200_OK)
def update_quota(
    bucket_name: str,
    payload: BucketQuotaUpdate,
    account: S3ExecutionContext = Depends(require_manager_bucket_quota),
    service: BucketsService = Depends(get_buckets_service),
    current_user: User = Depends(get_current_user),
    audit_service: AuditService = Depends(get_audit_service),
) -> dict[str, str]:
    response, audit_metadata = bucket_config_actions.update_bucket_quota_config(
        service=service,
        account=account,
        bucket_name=bucket_name,
        payload=payload,
    )
    _invalidate_bucket_listing_for_account(account)
    audit_service.record_action(
        user=current_user,
        scope="manager",
        action="update_bucket_quota",
        entity_type="bucket",
        entity_id=bucket_name,
        account=account,
        metadata=audit_metadata,
    )
    return response


@router.post("/compare", response_model=ManagerBucketCompareResult)
def compare_bucket_pair(
    payload: ManagerBucketCompareRequest,
    request: Request,
    db: Session = Depends(get_db),
    _tool_user: User = Depends(require_bucket_compare_enabled),
    source_account: S3ExecutionContext = Depends(get_account_context),
    actor: ManagerActor = Depends(get_current_account_admin),
    service: BucketsService = Depends(get_buckets_service),
) -> ManagerBucketCompareResult:
    target_account = get_account_context(
        request=request,
        account_ref=payload.target_context_id,
        actor=actor,
        db=db,
    )

    try:
        return compare_manager_buckets(
            service=service,
            payload=payload,
            source_account=source_account,
            target_account=target_account,
        )
    except InvalidManagerBucketComparisonError as exc:
        raise_bad_request_from_value_error(exc)
    except RuntimeError as exc:
        raise_bad_gateway_from_runtime(exc)


@router.post("/compare/action", response_model=ManagerBucketCompareActionResult)
def run_compare_bucket_action(
    payload: ManagerBucketCompareActionRequest,
    request: Request,
    db: Session = Depends(get_db),
    _tool_user: User = Depends(require_bucket_compare_enabled),
    source_account: S3ExecutionContext = Depends(get_account_context),
    actor: ManagerActor = Depends(get_current_account_admin),
    service: BucketsService = Depends(get_buckets_service),
    audit_service: AuditService = Depends(get_audit_service),
) -> ManagerBucketCompareActionResult:
    target_account = get_account_context(
        request=request,
        account_ref=payload.target_context_id,
        actor=actor,
        db=db,
    )

    try:
        outcome = remediate_manager_bucket_comparison(
            service=service,
            payload=payload,
            source_account=source_account,
            target_account=target_account,
        )
    except InvalidManagerBucketComparisonError as exc:
        raise_bad_request_from_value_error(exc)
    except RuntimeError as exc:
        raise_bad_gateway_from_runtime(exc)

    _invalidate_bucket_listing_for_account(source_account)
    _invalidate_bucket_listing_for_account(target_account)
    audit_service.record_action(
        user=actor,
        scope="manager",
        action="bucket_compare_remediation",
        entity_type="bucket",
        entity_id=payload.target_bucket,
        account=source_account,
        metadata=outcome.audit_metadata,
    )
    return outcome.result


@router.get("/{bucket_name}/properties", response_model=BucketProperties)
def bucket_properties(
    bucket_name: str,
    account: S3ExecutionContext = Depends(get_account_context),
    service: BucketsService = Depends(get_buckets_service),
    _: ManagerActor = Depends(get_current_account_admin),
) -> BucketProperties:
    return bucket_config_actions.get_bucket_properties_config(
        service=service,
        account=account,
        bucket_name=bucket_name,
    )


@router.get("/{bucket_name}/versioning", response_model=BucketVersioningStatus)
def get_versioning(
    bucket_name: str,
    account: S3ExecutionContext = Depends(get_account_context),
    service: BucketsService = Depends(get_buckets_service),
    _: ManagerActor = Depends(get_current_account_admin),
) -> BucketVersioningStatus:
    return bucket_config_actions.get_bucket_versioning_config(
        service=service,
        account=account,
        bucket_name=bucket_name,
    )


@router.put("/{bucket_name}/versioning", status_code=status.HTTP_200_OK)
def update_versioning(
    bucket_name: str,
    payload: BucketVersioningUpdate,
    account: S3ExecutionContext = Depends(get_account_context),
    service: BucketsService = Depends(get_buckets_service),
    current_user: ManagerActor = Depends(get_current_account_admin),
    audit_service: AuditService = Depends(get_audit_service),
):
    response, audit_metadata = bucket_config_actions.update_bucket_versioning_config(
        service=service,
        account=account,
        bucket_name=bucket_name,
        payload=payload,
    )
    _invalidate_bucket_listing_for_account(account)
    audit_service.record_action(
        user=current_user,
        scope="manager",
        action="update_bucket_versioning",
        entity_type="bucket",
        entity_id=bucket_name,
        account=account,
        metadata=audit_metadata,
    )
    return response

@router.get("/{bucket_name}/object-lock", response_model=BucketObjectLock)
def get_object_lock(
    bucket_name: str,
    account: S3ExecutionContext = Depends(get_account_context),
    service: BucketsService = Depends(get_buckets_service),
    _: ManagerActor = Depends(get_current_account_admin),
) -> BucketObjectLock:
    return bucket_config_actions.get_bucket_object_lock_config(
        service=service,
        account=account,
        bucket_name=bucket_name,
    )


@router.put("/{bucket_name}/object-lock", response_model=BucketObjectLock)
def put_object_lock(
    bucket_name: str,
    payload: BucketObjectLockUpdate,
    account: S3ExecutionContext = Depends(get_account_context),
    service: BucketsService = Depends(get_buckets_service),
    current_user: ManagerActor = Depends(get_current_account_admin),
    audit_service: AuditService = Depends(get_audit_service),
) -> BucketObjectLock:
    result, audit_metadata = bucket_config_actions.put_bucket_object_lock_config(
        service=service,
        account=account,
        bucket_name=bucket_name,
        payload=payload,
    )
    _invalidate_bucket_listing_for_account(account)
    audit_service.record_action(
        user=current_user,
        scope="manager",
        action="update_bucket_object_lock",
        entity_type="bucket",
        entity_id=bucket_name,
        account=account,
        metadata=audit_metadata,
    )
    return result


@router.get("/{bucket_name}/encryption", response_model=BucketEncryptionConfiguration)
def get_bucket_encryption(
    bucket_name: str,
    account: S3ExecutionContext = Depends(get_account_context),
    service: BucketsService = Depends(get_buckets_service),
    _: ManagerActor = Depends(get_current_account_admin),
) -> BucketEncryptionConfiguration:
    require_sse_feature(account)
    return bucket_config_actions.get_bucket_encryption_config(
        service=service,
        account=account,
        bucket_name=bucket_name,
    )


@router.put("/{bucket_name}/encryption", response_model=BucketEncryptionConfiguration)
def put_bucket_encryption(
    bucket_name: str,
    payload: BucketEncryptionConfiguration,
    account: S3ExecutionContext = Depends(get_account_context),
    service: BucketsService = Depends(get_buckets_service),
    current_user: ManagerActor = Depends(get_current_account_admin),
    audit_service: AuditService = Depends(get_audit_service),
) -> BucketEncryptionConfiguration:
    require_sse_feature(account)
    result, audit_metadata = bucket_config_actions.put_bucket_encryption_config(
        service=service,
        account=account,
        bucket_name=bucket_name,
        payload=payload,
    )
    _invalidate_bucket_listing_for_account(account)
    audit_service.record_action(
        user=current_user,
        scope="manager",
        action="update_bucket_encryption",
        entity_type="bucket",
        entity_id=bucket_name,
        account=account,
        metadata=audit_metadata,
    )
    return result


@router.delete("/{bucket_name}/encryption", status_code=status.HTTP_204_NO_CONTENT)
def delete_bucket_encryption(
    bucket_name: str,
    account: S3ExecutionContext = Depends(get_account_context),
    service: BucketsService = Depends(get_buckets_service),
    current_user: ManagerActor = Depends(get_current_account_admin),
    audit_service: AuditService = Depends(get_audit_service),
) -> None:
    require_sse_feature(account)
    bucket_config_actions.delete_bucket_encryption_config(
        service=service,
        account=account,
        bucket_name=bucket_name,
    )
    _invalidate_bucket_listing_for_account(account)
    audit_service.record_action(
        user=current_user,
        scope="manager",
        action="delete_bucket_encryption",
        entity_type="bucket",
        entity_id=bucket_name,
        account=account,
    )


@router.get("/{bucket_name}/policy", response_model=BucketPolicyOut)
def get_policy(
    bucket_name: str,
    account: S3ExecutionContext = Depends(get_account_context),
    service: BucketsService = Depends(get_buckets_service),
    _: ManagerActor = Depends(get_current_account_admin),
) -> BucketPolicyOut:
    return bucket_config_actions.get_bucket_policy_config(
        service=service,
        account=account,
        bucket_name=bucket_name,
    )


@router.get("/{bucket_name}/acl", response_model=BucketAcl)
def get_acl(
    bucket_name: str,
    account: S3ExecutionContext = Depends(get_account_context),
    service: BucketsService = Depends(get_buckets_service),
    _: ManagerActor = Depends(get_current_account_admin),
) -> BucketAcl:
    return bucket_config_actions.get_bucket_acl_config(
        service=service,
        account=account,
        bucket_name=bucket_name,
    )


@router.put("/{bucket_name}/acl", response_model=BucketAcl)
def put_acl(
    bucket_name: str,
    payload: BucketAclUpdate,
    account: S3ExecutionContext = Depends(get_account_context),
    service: BucketsService = Depends(get_buckets_service),
    current_user: ManagerActor = Depends(get_current_account_admin),
    audit_service: AuditService = Depends(get_audit_service),
) -> BucketAcl:
    result, audit_metadata = bucket_config_actions.put_bucket_acl_config(
        service=service,
        account=account,
        bucket_name=bucket_name,
        payload=payload,
    )
    _invalidate_bucket_listing_for_account(account)
    audit_service.record_action(
        user=current_user,
        scope="manager",
        action="update_bucket_acl",
        entity_type="bucket",
        entity_id=bucket_name,
        account=account,
        metadata=audit_metadata,
    )
    return result


@router.get("/{bucket_name}/public-access-block", response_model=BucketPublicAccessBlock)
def get_public_access_block(
    bucket_name: str,
    account: S3ExecutionContext = Depends(get_account_context),
    service: BucketsService = Depends(get_buckets_service),
    _: ManagerActor = Depends(get_current_account_admin),
) -> BucketPublicAccessBlock:
    return bucket_config_actions.get_bucket_public_access_block_config(
        service=service,
        account=account,
        bucket_name=bucket_name,
    )


@router.put("/{bucket_name}/public-access-block", response_model=BucketPublicAccessBlock)
def put_public_access_block(
    bucket_name: str,
    payload: BucketPublicAccessBlock,
    account: S3ExecutionContext = Depends(get_account_context),
    service: BucketsService = Depends(get_buckets_service),
    current_user: ManagerActor = Depends(get_current_account_admin),
    audit_service: AuditService = Depends(get_audit_service),
) -> BucketPublicAccessBlock:
    result, audit_metadata = bucket_config_actions.put_bucket_public_access_block_config(
        service=service,
        account=account,
        bucket_name=bucket_name,
        payload=payload,
    )
    _invalidate_bucket_listing_for_account(account)
    audit_service.record_action(
        user=current_user,
        scope="manager",
        action="update_public_access_block",
        entity_type="bucket",
        entity_id=bucket_name,
        account=account,
        metadata=audit_metadata,
    )
    return result


@router.put("/{bucket_name}/policy", response_model=BucketPolicyOut)
def put_policy(
    bucket_name: str,
    payload: BucketPolicyIn,
    account: S3ExecutionContext = Depends(get_account_context),
    service: BucketsService = Depends(get_buckets_service),
    current_user: ManagerActor = Depends(get_current_account_admin),
    audit_service: AuditService = Depends(get_audit_service),
) -> BucketPolicyOut:
    result, audit_metadata = bucket_config_actions.put_bucket_policy_config(
        service=service,
        account=account,
        bucket_name=bucket_name,
        payload=payload,
    )
    _invalidate_bucket_listing_for_account(account)
    audit_service.record_action(
        user=current_user,
        scope="manager",
        action="put_bucket_policy",
        entity_type="bucket",
        entity_id=bucket_name,
        account=account,
        metadata=audit_metadata,
    )
    return result


@router.delete("/{bucket_name}/policy", status_code=status.HTTP_204_NO_CONTENT)
def delete_policy(
    bucket_name: str,
    account: S3ExecutionContext = Depends(get_account_context),
    service: BucketsService = Depends(get_buckets_service),
    current_user: ManagerActor = Depends(get_current_account_admin),
    audit_service: AuditService = Depends(get_audit_service),
) -> None:
    bucket_config_actions.delete_bucket_policy_config(
        service=service,
        account=account,
        bucket_name=bucket_name,
    )
    _invalidate_bucket_listing_for_account(account)
    audit_service.record_action(
        user=current_user,
        scope="manager",
        action="delete_bucket_policy",
        entity_type="bucket",
        entity_id=bucket_name,
        account=account,
    )


@router.get("/{bucket_name}/lifecycle", response_model=BucketLifecycleConfig)
def get_lifecycle(
    bucket_name: str,
    account: S3ExecutionContext = Depends(get_account_context),
    service: BucketsService = Depends(get_buckets_service),
    _: ManagerActor = Depends(get_current_account_admin),
) -> BucketLifecycleConfig:
    return bucket_config_actions.get_bucket_lifecycle_config(
        service=service,
        account=account,
        bucket_name=bucket_name,
    )


@router.put("/{bucket_name}/lifecycle", response_model=BucketLifecycleConfig)
def put_lifecycle(
    bucket_name: str,
    payload: BucketLifecycleConfig,
    account: S3ExecutionContext = Depends(get_account_context),
    service: BucketsService = Depends(get_buckets_service),
    current_user: ManagerActor = Depends(get_current_account_admin),
    audit_service: AuditService = Depends(get_audit_service),
) -> BucketLifecycleConfig:
    result, audit_metadata = bucket_config_actions.put_bucket_lifecycle_config(
        service=service,
        account=account,
        bucket_name=bucket_name,
        payload=payload,
    )
    _invalidate_bucket_listing_for_account(account)
    audit_service.record_action(
        user=current_user,
        scope="manager",
        action="update_bucket_lifecycle",
        entity_type="bucket",
        entity_id=bucket_name,
        account=account,
        metadata=audit_metadata,
    )
    return result


@router.delete("/{bucket_name}/lifecycle", status_code=status.HTTP_204_NO_CONTENT)
def delete_lifecycle(
    bucket_name: str,
    account: S3ExecutionContext = Depends(get_account_context),
    service: BucketsService = Depends(get_buckets_service),
    current_user: ManagerActor = Depends(get_current_account_admin),
    audit_service: AuditService = Depends(get_audit_service),
) -> None:
    bucket_config_actions.delete_bucket_lifecycle_config(
        service=service,
        account=account,
        bucket_name=bucket_name,
    )
    _invalidate_bucket_listing_for_account(account)
    audit_service.record_action(
        user=current_user,
        scope="manager",
        action="delete_bucket_lifecycle",
        entity_type="bucket",
        entity_id=bucket_name,
        account=account,
    )


@router.get("/{bucket_name}/cors")
def get_cors(
    bucket_name: str,
    account: S3ExecutionContext = Depends(get_account_context),
    service: BucketsService = Depends(get_buckets_service),
    _: ManagerActor = Depends(get_current_account_admin),
):
    return bucket_config_actions.get_bucket_cors_config(
        service=service,
        account=account,
        bucket_name=bucket_name,
    )


@router.put("/{bucket_name}/cors")
def put_cors(
    bucket_name: str,
    payload: BucketCorsUpdate,
    account: S3ExecutionContext = Depends(get_account_context),
    service: BucketsService = Depends(get_buckets_service),
    current_user: ManagerActor = Depends(get_current_account_admin),
    audit_service: AuditService = Depends(get_audit_service),
):
    response, audit_metadata = bucket_config_actions.put_bucket_cors_config(
        service=service,
        account=account,
        bucket_name=bucket_name,
        payload=payload,
    )
    _invalidate_bucket_listing_for_account(account)
    audit_service.record_action(
        user=current_user,
        scope="manager",
        action="update_bucket_cors",
        entity_type="bucket",
        entity_id=bucket_name,
        account=account,
        metadata=audit_metadata,
    )
    return response


@router.delete("/{bucket_name}/cors", status_code=status.HTTP_204_NO_CONTENT)
def delete_cors(
    bucket_name: str,
    account: S3ExecutionContext = Depends(get_account_context),
    service: BucketsService = Depends(get_buckets_service),
    current_user: ManagerActor = Depends(get_current_account_admin),
    audit_service: AuditService = Depends(get_audit_service),
):
    bucket_config_actions.delete_bucket_cors_config(
        service=service,
        account=account,
        bucket_name=bucket_name,
    )
    _invalidate_bucket_listing_for_account(account)
    audit_service.record_action(
        user=current_user,
        scope="manager",
        action="delete_bucket_cors",
        entity_type="bucket",
        entity_id=bucket_name,
        account=account,
    )


@router.get("/{bucket_name}/notifications", response_model=BucketNotificationConfiguration)
def get_notifications(
    bucket_name: str,
    account: S3ExecutionContext = Depends(get_account_context),
    service: BucketsService = Depends(get_buckets_service),
    _: ManagerActor = Depends(get_current_account_admin),
) -> BucketNotificationConfiguration:
    return bucket_config_actions.get_bucket_notifications_config(
        service=service,
        account=account,
        bucket_name=bucket_name,
    )


@router.put("/{bucket_name}/notifications", response_model=BucketNotificationConfiguration)
def put_notifications(
    bucket_name: str,
    payload: BucketNotificationConfiguration,
    account: S3ExecutionContext = Depends(get_account_context),
    service: BucketsService = Depends(get_buckets_service),
    current_user: ManagerActor = Depends(get_current_account_admin),
    audit_service: AuditService = Depends(get_audit_service),
) -> BucketNotificationConfiguration:
    result, audit_metadata = bucket_config_actions.put_bucket_notifications_config(
        service=service,
        account=account,
        bucket_name=bucket_name,
        payload=payload,
    )
    _invalidate_bucket_listing_for_account(account)
    audit_service.record_action(
        user=current_user,
        scope="manager",
        action="update_bucket_notifications",
        entity_type="bucket",
        entity_id=bucket_name,
        account=account,
        metadata=audit_metadata,
    )
    return result


@router.delete("/{bucket_name}/notifications", status_code=status.HTTP_204_NO_CONTENT)
def delete_notifications(
    bucket_name: str,
    account: S3ExecutionContext = Depends(get_account_context),
    service: BucketsService = Depends(get_buckets_service),
    current_user: ManagerActor = Depends(get_current_account_admin),
    audit_service: AuditService = Depends(get_audit_service),
) -> None:
    bucket_config_actions.delete_bucket_notifications_config(
        service=service,
        account=account,
        bucket_name=bucket_name,
    )
    _invalidate_bucket_listing_for_account(account)
    audit_service.record_action(
        user=current_user,
        scope="manager",
        action="delete_bucket_notifications",
        entity_type="bucket",
        entity_id=bucket_name,
        account=account,
    )


@router.get("/{bucket_name}/replication", response_model=BucketReplicationConfiguration)
def get_replication(
    bucket_name: str,
    account: S3ExecutionContext = Depends(get_account_context),
    service: BucketsService = Depends(get_buckets_service),
    _: ManagerActor = Depends(get_current_account_admin),
) -> BucketReplicationConfiguration:
    require_replication_feature(account)
    return bucket_config_actions.get_bucket_replication_config(
        service=service,
        account=account,
        bucket_name=bucket_name,
    )


@router.put("/{bucket_name}/replication", response_model=BucketReplicationConfiguration)
def put_replication(
    bucket_name: str,
    payload: BucketReplicationConfiguration,
    account: S3ExecutionContext = Depends(get_account_context),
    service: BucketsService = Depends(get_buckets_service),
    current_user: ManagerActor = Depends(get_current_account_admin),
    audit_service: AuditService = Depends(get_audit_service),
) -> BucketReplicationConfiguration:
    require_replication_feature(account)
    result, audit_metadata = bucket_config_actions.put_bucket_replication_config(
        service=service,
        account=account,
        bucket_name=bucket_name,
        payload=payload,
    )
    _invalidate_bucket_listing_for_account(account)
    audit_service.record_action(
        user=current_user,
        scope="manager",
        action="update_bucket_replication",
        entity_type="bucket",
        entity_id=bucket_name,
        account=account,
        metadata=audit_metadata,
    )
    return result


@router.delete("/{bucket_name}/replication", status_code=status.HTTP_204_NO_CONTENT)
def delete_replication(
    bucket_name: str,
    account: S3ExecutionContext = Depends(get_account_context),
    service: BucketsService = Depends(get_buckets_service),
    current_user: ManagerActor = Depends(get_current_account_admin),
    audit_service: AuditService = Depends(get_audit_service),
) -> None:
    require_replication_feature(account)
    bucket_config_actions.delete_bucket_replication_config(
        service=service,
        account=account,
        bucket_name=bucket_name,
    )
    _invalidate_bucket_listing_for_account(account)
    audit_service.record_action(
        user=current_user,
        scope="manager",
        action="delete_bucket_replication",
        entity_type="bucket",
        entity_id=bucket_name,
        account=account,
    )


@router.get("/{bucket_name}/logging", response_model=BucketLoggingConfiguration)
def get_logging(
    bucket_name: str,
    account: S3ExecutionContext = Depends(get_account_context),
    service: BucketsService = Depends(get_buckets_service),
    _: ManagerActor = Depends(get_current_account_admin),
) -> BucketLoggingConfiguration:
    return bucket_config_actions.get_bucket_logging_config(
        service=service,
        account=account,
        bucket_name=bucket_name,
    )


@router.put("/{bucket_name}/logging", response_model=BucketLoggingConfiguration)
def put_logging(
    bucket_name: str,
    payload: BucketLoggingConfiguration,
    account: S3ExecutionContext = Depends(get_account_context),
    service: BucketsService = Depends(get_buckets_service),
    current_user: ManagerActor = Depends(get_current_account_admin),
    audit_service: AuditService = Depends(get_audit_service),
) -> BucketLoggingConfiguration:
    result, audit_metadata = bucket_config_actions.put_bucket_logging_config(
        service=service,
        account=account,
        bucket_name=bucket_name,
        payload=payload,
    )
    _invalidate_bucket_listing_for_account(account)
    audit_service.record_action(
        user=current_user,
        scope="manager",
        action="update_bucket_logging",
        entity_type="bucket",
        entity_id=bucket_name,
        account=account,
        metadata=audit_metadata,
    )
    return result


@router.delete("/{bucket_name}/logging", status_code=status.HTTP_204_NO_CONTENT)
def delete_logging(
    bucket_name: str,
    account: S3ExecutionContext = Depends(get_account_context),
    service: BucketsService = Depends(get_buckets_service),
    current_user: ManagerActor = Depends(get_current_account_admin),
    audit_service: AuditService = Depends(get_audit_service),
) -> None:
    bucket_config_actions.delete_bucket_logging_config(
        service=service,
        account=account,
        bucket_name=bucket_name,
    )
    _invalidate_bucket_listing_for_account(account)
    audit_service.record_action(
        user=current_user,
        scope="manager",
        action="delete_bucket_logging",
        entity_type="bucket",
        entity_id=bucket_name,
        account=account,
    )


@router.get("/{bucket_name}/website", response_model=BucketWebsiteConfiguration)
def get_website(
    bucket_name: str,
    account: S3ExecutionContext = Depends(get_account_context),
    service: BucketsService = Depends(get_buckets_service),
    _: ManagerActor = Depends(get_current_account_admin),
) -> BucketWebsiteConfiguration:
    return bucket_config_actions.get_bucket_website_config(
        service=service,
        account=account,
        bucket_name=bucket_name,
    )


@router.put("/{bucket_name}/website", response_model=BucketWebsiteConfiguration)
def put_website(
    bucket_name: str,
    payload: BucketWebsiteConfiguration,
    account: S3ExecutionContext = Depends(get_account_context),
    service: BucketsService = Depends(get_buckets_service),
    current_user: ManagerActor = Depends(get_current_account_admin),
    audit_service: AuditService = Depends(get_audit_service),
) -> BucketWebsiteConfiguration:
    result, audit_metadata = bucket_config_actions.put_bucket_website_config(
        service=service,
        account=account,
        bucket_name=bucket_name,
        payload=payload,
    )
    _invalidate_bucket_listing_for_account(account)
    audit_service.record_action(
        user=current_user,
        scope="manager",
        action="update_bucket_website",
        entity_type="bucket",
        entity_id=bucket_name,
        account=account,
        metadata=audit_metadata,
    )
    return result


@router.delete("/{bucket_name}/website", status_code=status.HTTP_204_NO_CONTENT)
def delete_website(
    bucket_name: str,
    account: S3ExecutionContext = Depends(get_account_context),
    service: BucketsService = Depends(get_buckets_service),
    current_user: ManagerActor = Depends(get_current_account_admin),
    audit_service: AuditService = Depends(get_audit_service),
) -> None:
    bucket_config_actions.delete_bucket_website_config(
        service=service,
        account=account,
        bucket_name=bucket_name,
    )
    _invalidate_bucket_listing_for_account(account)
    audit_service.record_action(
        user=current_user,
        scope="manager",
        action="delete_bucket_website",
        entity_type="bucket",
        entity_id=bucket_name,
        account=account,
    )


@router.get("/{bucket_name}/tags")
def get_tags(
    bucket_name: str,
    account: S3ExecutionContext = Depends(get_account_context),
    service: BucketsService = Depends(get_buckets_service),
    _: ManagerActor = Depends(get_current_account_admin),
):
    return bucket_config_actions.get_bucket_tags_config(
        service=service,
        account=account,
        bucket_name=bucket_name,
    )


@router.put("/{bucket_name}/tags")
def put_tags(
    bucket_name: str,
    payload: BucketTagsUpdate,
    account: S3ExecutionContext = Depends(get_account_context),
    service: BucketsService = Depends(get_buckets_service),
    current_user: ManagerActor = Depends(get_current_account_admin),
    audit_service: AuditService = Depends(get_audit_service),
):
    response, audit_metadata = bucket_config_actions.put_bucket_tags_config(
        service=service,
        account=account,
        bucket_name=bucket_name,
        payload=payload,
    )
    _invalidate_bucket_listing_for_account(account)
    audit_service.record_action(
        user=current_user,
        scope="manager",
        action="update_bucket_tags",
        entity_type="bucket",
        entity_id=bucket_name,
        account=account,
        metadata=audit_metadata,
    )
    return response


@router.delete("/{bucket_name}/tags", status_code=status.HTTP_204_NO_CONTENT)
def delete_tags(
    bucket_name: str,
    account: S3ExecutionContext = Depends(get_account_context),
    service: BucketsService = Depends(get_buckets_service),
    current_user: ManagerActor = Depends(get_current_account_admin),
    audit_service: AuditService = Depends(get_audit_service),
):
    bucket_config_actions.delete_bucket_tags_config(
        service=service,
        account=account,
        bucket_name=bucket_name,
    )
    _invalidate_bucket_listing_for_account(account)
    audit_service.record_action(
        user=current_user,
        scope="manager",
        action="delete_bucket_tags",
        entity_type="bucket",
        entity_id=bucket_name,
        account=account,
    )


@router.post("", status_code=status.HTTP_201_CREATED)
def create_bucket(
    payload: BucketCreate,
    account: S3ExecutionContext = Depends(get_account_context),
    service: BucketsService = Depends(get_buckets_service),
    current_user: ManagerActor = Depends(get_current_account_admin),
    audit_service: AuditService = Depends(get_audit_service),
):
    response, audit_metadata = bucket_config_actions.create_bucket_config(
        service=service,
        account=account,
        payload=payload,
    )
    _invalidate_bucket_listing_for_account(account)
    audit_service.record_action(
        user=current_user,
        scope="manager",
        action="create_bucket",
        entity_type="bucket",
        entity_id=payload.name,
        account=account,
        metadata=audit_metadata,
    )
    return response


@router.delete("/{bucket_name}")
def delete_bucket(
    bucket_name: str,
    account: S3ExecutionContext = Depends(get_account_context),
    service: BucketsService = Depends(get_buckets_service),
    current_user: ManagerActor = Depends(get_current_account_admin),
    audit_service: AuditService = Depends(get_audit_service),
):
    response, _audit_metadata = bucket_config_actions.delete_bucket_config(
        service=service,
        account=account,
        bucket_name=bucket_name,
        not_empty_detail=f"Bucket '{bucket_name}' is not empty. Empty it before deleting.",
    )
    _invalidate_bucket_listing_for_account(account)
    audit_service.record_action(
        user=current_user,
        scope="manager",
        action="delete_bucket",
        entity_type="bucket",
        entity_id=bucket_name,
        account=account,
    )
    return response


@router.post("/{bucket_name}/delete/stream")
def stream_delete_bucket_with_purge(
    bucket_name: str,
    payload: BucketDeleteWithPurgeRequest,
    request: Request,
    tool_user: User = Depends(require_bucket_purge_enabled),
    account: S3ExecutionContext = Depends(get_account_context),
    _: ManagerActor = Depends(get_current_account_admin),
) -> StreamingResponse:
    expected = bucket_delete_with_purge_confirmation_phrase(bucket_name)
    if (payload.confirmation or "").strip() != expected:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Confirmation must be exactly '{expected}'.")
    require_bucket_management_context(account)
    options = BucketPurgeOptions(parallelism=payload.parallelism, include_versions=True)
    context_id = request.query_params.get("account_id") or account.context_id
    context_name = getattr(account, "name", None)
    target = BucketPurgeResolvedTarget(
        account=account,
        bucket_name=bucket_name,
        context_id=context_id,
        context_name=context_name,
    )
    service = BucketPurgeService()
    base_metadata = {
        "bucket_name": bucket_name,
        "context_id": context_id,
        "parallelism": options.parallelism,
        "include_versions": True,
        "confirmation": "matched",
    }

    def after_result(result: BucketPurgeResult) -> None:
        if result.bucket_deleted:
            _invalidate_bucket_listing_for_account(account)

    def result_succeeded(result: BucketPurgeResult) -> bool:
        return result.status == "completed" and result.bucket_deleted

    def result_metadata(result: BucketPurgeResult) -> dict[str, object]:
        return {
            "result_status": result.status,
            "listed_objects": result.listed_objects,
            "listed_versions": result.listed_versions,
            "deleted_objects": result.deleted_objects,
            "deleted_versions": result.deleted_versions,
            "failed_count": result.failed_count,
            "bucket_deleted": result.bucket_deleted,
        }

    audit = BucketPurgeAuditLifecycle(
        record=partial(
            record_bucket_purge_audit,
            user_id=int(tool_user.id),
            user_email=str(tool_user.email),
            user_role=str(tool_user.role),
            scope="manager",
            entity_type="bucket",
            entity_id=bucket_name,
            account=account,
        ),
        base_metadata=base_metadata,
        start_action="start_bucket_delete_with_purge",
        result_action="finish_bucket_delete_with_purge",
        cancel_action="cancel_bucket_delete_with_purge",
        error_action="fail_bucket_delete_with_purge",
        cancel_message="Bucket deletion canceled",
        result_failure_action="fail_bucket_delete_with_purge",
        result_succeeded=result_succeeded,
        result_metadata=result_metadata,
        after_result=after_result,
    )

    return stream_bucket_purge(
        request,
        run_purge=lambda progress_callback, cancel_check: service.run_delete_bucket_with_purge(
            target,
            options,
            progress_callback=progress_callback,
            cancel_check=cancel_check,
        ),
        logger=logger,
        failure_message="Manager bucket deletion failed.",
        on_start=audit.on_start,
        on_result=audit.on_result,
        on_cancel=audit.on_cancel,
        on_error=audit.on_error,
    )
