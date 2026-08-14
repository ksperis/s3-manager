# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from fastapi import APIRouter, Depends, status

from app.models.access_context import ManagerActor
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
    BucketReplicationConfiguration,
    BucketTagsUpdate,
    BucketVersioningStatus,
    BucketVersioningUpdate,
    BucketWebsiteConfiguration,
)
from app.routers.browser_common import require_replication_feature, require_sse_feature
from app.routers.dependencies import get_account_context, get_audit_service, get_current_account_admin
from app.services import bucket_config_actions
from app.services.audit_service import AuditService
from app.services.bucket_listing_cache import invalidate_bucket_listing_cache_for_account
from app.services.buckets_service import BucketsService, get_buckets_service
from app.services.s3_execution_context import S3ExecutionContext

router = APIRouter(tags=["manager-buckets"])


def _record_manager_bucket_config_mutation(
    *,
    audit_service: AuditService,
    current_user: ManagerActor,
    account: S3ExecutionContext,
    bucket_name: str,
    action: str,
    metadata: dict[str, object] | None = None,
) -> None:
    invalidate_bucket_listing_cache_for_account(account)
    audit_service.record_action(
        user=current_user,
        scope="manager",
        action=action,
        entity_type="bucket",
        entity_id=bucket_name,
        account=account,
        metadata=metadata,
    )


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
    _record_manager_bucket_config_mutation(
        audit_service=audit_service,
        current_user=current_user,
        account=account,
        bucket_name=bucket_name,
        action="update_bucket_versioning",
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
    _record_manager_bucket_config_mutation(
        audit_service=audit_service,
        current_user=current_user,
        account=account,
        bucket_name=bucket_name,
        action="update_bucket_object_lock",
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
    _record_manager_bucket_config_mutation(
        audit_service=audit_service,
        current_user=current_user,
        account=account,
        bucket_name=bucket_name,
        action="update_bucket_encryption",
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
    _record_manager_bucket_config_mutation(
        audit_service=audit_service,
        current_user=current_user,
        account=account,
        bucket_name=bucket_name,
        action="delete_bucket_encryption",
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
    _record_manager_bucket_config_mutation(
        audit_service=audit_service,
        current_user=current_user,
        account=account,
        bucket_name=bucket_name,
        action="update_bucket_acl",
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
    _record_manager_bucket_config_mutation(
        audit_service=audit_service,
        current_user=current_user,
        account=account,
        bucket_name=bucket_name,
        action="update_public_access_block",
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
    _record_manager_bucket_config_mutation(
        audit_service=audit_service,
        current_user=current_user,
        account=account,
        bucket_name=bucket_name,
        action="put_bucket_policy",
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
    _record_manager_bucket_config_mutation(
        audit_service=audit_service,
        current_user=current_user,
        account=account,
        bucket_name=bucket_name,
        action="delete_bucket_policy",
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
    _record_manager_bucket_config_mutation(
        audit_service=audit_service,
        current_user=current_user,
        account=account,
        bucket_name=bucket_name,
        action="update_bucket_lifecycle",
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
    _record_manager_bucket_config_mutation(
        audit_service=audit_service,
        current_user=current_user,
        account=account,
        bucket_name=bucket_name,
        action="delete_bucket_lifecycle",
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
    _record_manager_bucket_config_mutation(
        audit_service=audit_service,
        current_user=current_user,
        account=account,
        bucket_name=bucket_name,
        action="update_bucket_cors",
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
    _record_manager_bucket_config_mutation(
        audit_service=audit_service,
        current_user=current_user,
        account=account,
        bucket_name=bucket_name,
        action="delete_bucket_cors",
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
    _record_manager_bucket_config_mutation(
        audit_service=audit_service,
        current_user=current_user,
        account=account,
        bucket_name=bucket_name,
        action="update_bucket_notifications",
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
    _record_manager_bucket_config_mutation(
        audit_service=audit_service,
        current_user=current_user,
        account=account,
        bucket_name=bucket_name,
        action="delete_bucket_notifications",
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
    _record_manager_bucket_config_mutation(
        audit_service=audit_service,
        current_user=current_user,
        account=account,
        bucket_name=bucket_name,
        action="update_bucket_replication",
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
    _record_manager_bucket_config_mutation(
        audit_service=audit_service,
        current_user=current_user,
        account=account,
        bucket_name=bucket_name,
        action="delete_bucket_replication",
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
    _record_manager_bucket_config_mutation(
        audit_service=audit_service,
        current_user=current_user,
        account=account,
        bucket_name=bucket_name,
        action="update_bucket_logging",
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
    _record_manager_bucket_config_mutation(
        audit_service=audit_service,
        current_user=current_user,
        account=account,
        bucket_name=bucket_name,
        action="delete_bucket_logging",
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
    _record_manager_bucket_config_mutation(
        audit_service=audit_service,
        current_user=current_user,
        account=account,
        bucket_name=bucket_name,
        action="update_bucket_website",
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
    _record_manager_bucket_config_mutation(
        audit_service=audit_service,
        current_user=current_user,
        account=account,
        bucket_name=bucket_name,
        action="delete_bucket_website",
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
    _record_manager_bucket_config_mutation(
        audit_service=audit_service,
        current_user=current_user,
        account=account,
        bucket_name=bucket_name,
        action="update_bucket_tags",
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
    _record_manager_bucket_config_mutation(
        audit_service=audit_service,
        current_user=current_user,
        account=account,
        bucket_name=bucket_name,
        action="delete_bucket_tags",
    )
