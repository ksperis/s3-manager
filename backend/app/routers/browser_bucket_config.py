# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Bucket configuration endpoints for the Browser workspace."""

from typing import Any

from fastapi import APIRouter, Depends, Query, status

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
    BucketProperties,
    BucketPublicAccessBlock,
    BucketReplicationConfiguration,
    BucketTagsUpdate,
    BucketVersioningUpdate,
    BucketWebsiteConfiguration,
)
from app.routers.browser_common import require_replication_feature, require_sse_feature
from app.routers.dependencies import (
    forbid_browser_bucket_quota_management,
    get_account_context,
    get_audit_service,
    get_current_account_admin,
)
from app.services import bucket_config_actions
from app.services.audit_service import AuditService
from app.services.bucket_config_mutation_service import BucketConfigMutationService
from app.services.browser_service import BrowserService, get_browser_service
from app.services.bucket_configuration_service import (
    BucketConfigurationService,
    get_bucket_configuration_service,
)
from app.services.buckets_service import BucketsService, get_buckets_service
from app.services.s3_execution_context import S3ExecutionContext

router = APIRouter()


def _invalidate_browser_listing_cache(
    browser_service: BrowserService,
    account: S3ExecutionContext,
    *,
    bucket_name: str | None = None,
) -> None:
    browser_service.invalidate_bucket_list_cache_for_account(account)
    if bucket_name:
        browser_service.invalidate_object_list_cache_for_account(account, bucket_name)


def get_browser_bucket_config_mutation_service(
    configuration_service: BucketConfigurationService = Depends(get_bucket_configuration_service),
    browser_service: BrowserService = Depends(get_browser_service),
    audit_service: AuditService = Depends(get_audit_service),
) -> BucketConfigMutationService:
    return BucketConfigMutationService(
        configuration_service=configuration_service,
        audit_service=audit_service,
        audit_scope="browser",
        cache_invalidator=lambda account, bucket_name: _invalidate_browser_listing_cache(
            browser_service,
            account,
            bucket_name=bucket_name,
        ),
    )


@router.get("/buckets/config", response_model=list[Bucket])
def list_bucket_configs(
    include: list[str] = Query(default=[], description="Optional extra fields to include (e.g. tags, versioning, cors)"),
    with_stats: bool = Query(True, description="Include usage/quota stats from admin listing"),
    account: S3ExecutionContext = Depends(get_account_context),
    service: BucketsService = Depends(get_buckets_service),
    _: ManagerActor = Depends(get_current_account_admin),
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
    account: S3ExecutionContext = Depends(get_account_context),
    service: BucketsService = Depends(get_buckets_service),
    _: ManagerActor = Depends(get_current_account_admin),
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
    account: S3ExecutionContext = Depends(get_account_context),
    service: BucketsService = Depends(get_buckets_service),
    browser_service: BrowserService = Depends(get_browser_service),
    actor: ManagerActor = Depends(get_current_account_admin),
    audit_service: AuditService = Depends(get_audit_service),
) -> dict[str, Any]:
    response, audit_metadata = bucket_config_actions.create_bucket_config(
        service=service,
        account=account,
        payload=payload,
    )
    _invalidate_browser_listing_cache(browser_service, account, bucket_name=payload.name)
    audit_service.record_action(
        user=actor,
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
    account: S3ExecutionContext = Depends(get_account_context),
    service: BucketsService = Depends(get_buckets_service),
    browser_service: BrowserService = Depends(get_browser_service),
    actor: ManagerActor = Depends(get_current_account_admin),
    audit_service: AuditService = Depends(get_audit_service),
) -> dict[str, str]:
    response, audit_metadata = bucket_config_actions.delete_bucket_config(
        service=service,
        account=account,
        bucket_name=bucket_name,
        force=force,
    )
    _invalidate_browser_listing_cache(browser_service, account, bucket_name=bucket_name)
    audit_service.record_action(
        user=actor,
        scope="browser",
        action="delete_bucket",
        entity_type="bucket",
        entity_id=bucket_name,
        account=account,
        metadata=audit_metadata,
    )
    return response


@router.put("/buckets/config/{bucket_name}/quota")
def deny_bucket_quota_update(
    bucket_name: str,
    _: None = Depends(forbid_browser_bucket_quota_management),
) -> None:
    raise AssertionError(f"Browser bucket quota guard did not reject {bucket_name}")


@router.get("/buckets/config/{bucket_name}/properties", response_model=BucketProperties)
def get_bucket_properties_config(
    bucket_name: str,
    account: S3ExecutionContext = Depends(get_account_context),
    service: BucketConfigurationService = Depends(get_bucket_configuration_service),
    _: ManagerActor = Depends(get_current_account_admin),
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
    account: S3ExecutionContext = Depends(get_account_context),
    actor: ManagerActor = Depends(get_current_account_admin),
    mutation: BucketConfigMutationService = Depends(get_browser_bucket_config_mutation_service),
) -> dict[str, Any]:
    return mutation.update(
        actor=actor,
        account=account,
        bucket_name=bucket_name,
        audit_action="update_bucket_versioning",
        action=bucket_config_actions.update_bucket_versioning_config,
        payload=payload,
    )


@router.get("/buckets/config/{bucket_name}/object-lock", response_model=BucketObjectLock)
def get_bucket_object_lock_config(
    bucket_name: str,
    account: S3ExecutionContext = Depends(get_account_context),
    service: BucketConfigurationService = Depends(get_bucket_configuration_service),
    _: ManagerActor = Depends(get_current_account_admin),
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
    account: S3ExecutionContext = Depends(get_account_context),
    actor: ManagerActor = Depends(get_current_account_admin),
    mutation: BucketConfigMutationService = Depends(get_browser_bucket_config_mutation_service),
) -> BucketObjectLock:
    return mutation.update(
        actor=actor,
        account=account,
        bucket_name=bucket_name,
        audit_action="update_bucket_object_lock",
        action=bucket_config_actions.put_bucket_object_lock_config,
        payload=payload,
    )


@router.get("/buckets/config/{bucket_name}/encryption", response_model=BucketEncryptionConfiguration)
def get_bucket_encryption_config(
    bucket_name: str,
    account: S3ExecutionContext = Depends(get_account_context),
    service: BucketConfigurationService = Depends(get_bucket_configuration_service),
    _: ManagerActor = Depends(get_current_account_admin),
) -> BucketEncryptionConfiguration:
    require_sse_feature(account)
    return bucket_config_actions.get_bucket_encryption_config(
        service=service,
        account=account,
        bucket_name=bucket_name,
    )


@router.put("/buckets/config/{bucket_name}/encryption", response_model=BucketEncryptionConfiguration)
def put_bucket_encryption_config(
    bucket_name: str,
    payload: BucketEncryptionConfiguration,
    account: S3ExecutionContext = Depends(get_account_context),
    actor: ManagerActor = Depends(get_current_account_admin),
    mutation: BucketConfigMutationService = Depends(get_browser_bucket_config_mutation_service),
) -> BucketEncryptionConfiguration:
    require_sse_feature(account)
    return mutation.update(
        actor=actor,
        account=account,
        bucket_name=bucket_name,
        audit_action="update_bucket_encryption",
        action=bucket_config_actions.put_bucket_encryption_config,
        payload=payload,
    )


@router.delete("/buckets/config/{bucket_name}/encryption", status_code=status.HTTP_204_NO_CONTENT)
def delete_bucket_encryption_config(
    bucket_name: str,
    account: S3ExecutionContext = Depends(get_account_context),
    actor: ManagerActor = Depends(get_current_account_admin),
    mutation: BucketConfigMutationService = Depends(get_browser_bucket_config_mutation_service),
) -> None:
    require_sse_feature(account)
    mutation.delete(
        actor=actor,
        account=account,
        bucket_name=bucket_name,
        audit_action="delete_bucket_encryption",
        action=bucket_config_actions.delete_bucket_encryption_config,
    )


@router.get("/buckets/config/{bucket_name}/policy", response_model=BucketPolicyOut)
def get_bucket_policy_config(
    bucket_name: str,
    account: S3ExecutionContext = Depends(get_account_context),
    service: BucketConfigurationService = Depends(get_bucket_configuration_service),
    _: ManagerActor = Depends(get_current_account_admin),
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
    account: S3ExecutionContext = Depends(get_account_context),
    actor: ManagerActor = Depends(get_current_account_admin),
    mutation: BucketConfigMutationService = Depends(get_browser_bucket_config_mutation_service),
) -> BucketPolicyOut:
    return mutation.update(
        actor=actor,
        account=account,
        bucket_name=bucket_name,
        audit_action="put_bucket_policy",
        action=bucket_config_actions.put_bucket_policy_config,
        payload=payload,
    )


@router.delete("/buckets/config/{bucket_name}/policy", status_code=status.HTTP_204_NO_CONTENT)
def delete_bucket_policy_config(
    bucket_name: str,
    account: S3ExecutionContext = Depends(get_account_context),
    actor: ManagerActor = Depends(get_current_account_admin),
    mutation: BucketConfigMutationService = Depends(get_browser_bucket_config_mutation_service),
) -> None:
    mutation.delete(
        actor=actor,
        account=account,
        bucket_name=bucket_name,
        audit_action="delete_bucket_policy",
        action=bucket_config_actions.delete_bucket_policy_config,
    )


@router.get("/buckets/config/{bucket_name}/acl", response_model=BucketAcl)
def get_bucket_acl_config(
    bucket_name: str,
    account: S3ExecutionContext = Depends(get_account_context),
    service: BucketConfigurationService = Depends(get_bucket_configuration_service),
    _: ManagerActor = Depends(get_current_account_admin),
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
    account: S3ExecutionContext = Depends(get_account_context),
    actor: ManagerActor = Depends(get_current_account_admin),
    mutation: BucketConfigMutationService = Depends(get_browser_bucket_config_mutation_service),
) -> BucketAcl:
    return mutation.update(
        actor=actor,
        account=account,
        bucket_name=bucket_name,
        audit_action="update_bucket_acl",
        action=bucket_config_actions.put_bucket_acl_config,
        payload=payload,
    )


@router.get("/buckets/config/{bucket_name}/public-access-block", response_model=BucketPublicAccessBlock)
def get_bucket_public_access_block_config(
    bucket_name: str,
    account: S3ExecutionContext = Depends(get_account_context),
    service: BucketConfigurationService = Depends(get_bucket_configuration_service),
    _: ManagerActor = Depends(get_current_account_admin),
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
    account: S3ExecutionContext = Depends(get_account_context),
    actor: ManagerActor = Depends(get_current_account_admin),
    mutation: BucketConfigMutationService = Depends(get_browser_bucket_config_mutation_service),
) -> BucketPublicAccessBlock:
    return mutation.update(
        actor=actor,
        account=account,
        bucket_name=bucket_name,
        audit_action="update_public_access_block",
        action=bucket_config_actions.put_bucket_public_access_block_config,
        payload=payload,
    )


@router.get("/buckets/config/{bucket_name}/lifecycle", response_model=BucketLifecycleConfig)
def get_bucket_lifecycle_config(
    bucket_name: str,
    account: S3ExecutionContext = Depends(get_account_context),
    service: BucketConfigurationService = Depends(get_bucket_configuration_service),
    _: ManagerActor = Depends(get_current_account_admin),
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
    account: S3ExecutionContext = Depends(get_account_context),
    actor: ManagerActor = Depends(get_current_account_admin),
    mutation: BucketConfigMutationService = Depends(get_browser_bucket_config_mutation_service),
) -> BucketLifecycleConfig:
    return mutation.update(
        actor=actor,
        account=account,
        bucket_name=bucket_name,
        audit_action="update_bucket_lifecycle",
        action=bucket_config_actions.put_bucket_lifecycle_config,
        payload=payload,
    )


@router.delete("/buckets/config/{bucket_name}/lifecycle", status_code=status.HTTP_204_NO_CONTENT)
def delete_bucket_lifecycle_config(
    bucket_name: str,
    account: S3ExecutionContext = Depends(get_account_context),
    actor: ManagerActor = Depends(get_current_account_admin),
    mutation: BucketConfigMutationService = Depends(get_browser_bucket_config_mutation_service),
) -> None:
    mutation.delete(
        actor=actor,
        account=account,
        bucket_name=bucket_name,
        audit_action="delete_bucket_lifecycle",
        action=bucket_config_actions.delete_bucket_lifecycle_config,
    )


@router.get("/buckets/config/{bucket_name}/cors")
def get_bucket_cors_config(
    bucket_name: str,
    account: S3ExecutionContext = Depends(get_account_context),
    service: BucketConfigurationService = Depends(get_bucket_configuration_service),
    _: ManagerActor = Depends(get_current_account_admin),
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
    account: S3ExecutionContext = Depends(get_account_context),
    actor: ManagerActor = Depends(get_current_account_admin),
    mutation: BucketConfigMutationService = Depends(get_browser_bucket_config_mutation_service),
) -> dict[str, Any]:
    return mutation.update(
        actor=actor,
        account=account,
        bucket_name=bucket_name,
        audit_action="update_bucket_cors",
        action=bucket_config_actions.put_bucket_cors_config,
        payload=payload,
    )


@router.delete("/buckets/config/{bucket_name}/cors", status_code=status.HTTP_204_NO_CONTENT)
def delete_bucket_cors_config(
    bucket_name: str,
    account: S3ExecutionContext = Depends(get_account_context),
    actor: ManagerActor = Depends(get_current_account_admin),
    mutation: BucketConfigMutationService = Depends(get_browser_bucket_config_mutation_service),
) -> None:
    mutation.delete(
        actor=actor,
        account=account,
        bucket_name=bucket_name,
        audit_action="delete_bucket_cors",
        action=bucket_config_actions.delete_bucket_cors_config,
    )


@router.get("/buckets/config/{bucket_name}/notifications", response_model=BucketNotificationConfiguration)
def get_bucket_notifications_config(
    bucket_name: str,
    account: S3ExecutionContext = Depends(get_account_context),
    service: BucketConfigurationService = Depends(get_bucket_configuration_service),
    _: ManagerActor = Depends(get_current_account_admin),
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
    account: S3ExecutionContext = Depends(get_account_context),
    actor: ManagerActor = Depends(get_current_account_admin),
    mutation: BucketConfigMutationService = Depends(get_browser_bucket_config_mutation_service),
) -> BucketNotificationConfiguration:
    return mutation.update(
        actor=actor,
        account=account,
        bucket_name=bucket_name,
        audit_action="update_bucket_notifications",
        action=bucket_config_actions.put_bucket_notifications_config,
        payload=payload,
    )


@router.delete("/buckets/config/{bucket_name}/notifications", status_code=status.HTTP_204_NO_CONTENT)
def delete_bucket_notifications_config(
    bucket_name: str,
    account: S3ExecutionContext = Depends(get_account_context),
    actor: ManagerActor = Depends(get_current_account_admin),
    mutation: BucketConfigMutationService = Depends(get_browser_bucket_config_mutation_service),
) -> None:
    mutation.delete(
        actor=actor,
        account=account,
        bucket_name=bucket_name,
        audit_action="delete_bucket_notifications",
        action=bucket_config_actions.delete_bucket_notifications_config,
    )


@router.get("/buckets/config/{bucket_name}/replication", response_model=BucketReplicationConfiguration)
def get_bucket_replication_config(
    bucket_name: str,
    account: S3ExecutionContext = Depends(get_account_context),
    service: BucketConfigurationService = Depends(get_bucket_configuration_service),
    _: ManagerActor = Depends(get_current_account_admin),
) -> BucketReplicationConfiguration:
    require_replication_feature(account)
    return bucket_config_actions.get_bucket_replication_config(
        service=service,
        account=account,
        bucket_name=bucket_name,
    )


@router.put("/buckets/config/{bucket_name}/replication", response_model=BucketReplicationConfiguration)
def put_bucket_replication_config(
    bucket_name: str,
    payload: BucketReplicationConfiguration,
    account: S3ExecutionContext = Depends(get_account_context),
    actor: ManagerActor = Depends(get_current_account_admin),
    mutation: BucketConfigMutationService = Depends(get_browser_bucket_config_mutation_service),
) -> BucketReplicationConfiguration:
    require_replication_feature(account)
    return mutation.update(
        actor=actor,
        account=account,
        bucket_name=bucket_name,
        audit_action="update_bucket_replication",
        action=bucket_config_actions.put_bucket_replication_config,
        payload=payload,
    )


@router.delete("/buckets/config/{bucket_name}/replication", status_code=status.HTTP_204_NO_CONTENT)
def delete_bucket_replication_config(
    bucket_name: str,
    account: S3ExecutionContext = Depends(get_account_context),
    actor: ManagerActor = Depends(get_current_account_admin),
    mutation: BucketConfigMutationService = Depends(get_browser_bucket_config_mutation_service),
) -> None:
    require_replication_feature(account)
    mutation.delete(
        actor=actor,
        account=account,
        bucket_name=bucket_name,
        audit_action="delete_bucket_replication",
        action=bucket_config_actions.delete_bucket_replication_config,
    )


@router.get("/buckets/config/{bucket_name}/logging", response_model=BucketLoggingConfiguration)
def get_bucket_logging_config(
    bucket_name: str,
    account: S3ExecutionContext = Depends(get_account_context),
    service: BucketConfigurationService = Depends(get_bucket_configuration_service),
    _: ManagerActor = Depends(get_current_account_admin),
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
    account: S3ExecutionContext = Depends(get_account_context),
    actor: ManagerActor = Depends(get_current_account_admin),
    mutation: BucketConfigMutationService = Depends(get_browser_bucket_config_mutation_service),
) -> BucketLoggingConfiguration:
    return mutation.update(
        actor=actor,
        account=account,
        bucket_name=bucket_name,
        audit_action="update_bucket_logging",
        action=bucket_config_actions.put_bucket_logging_config,
        payload=payload,
    )


@router.delete("/buckets/config/{bucket_name}/logging", status_code=status.HTTP_204_NO_CONTENT)
def delete_bucket_logging_config(
    bucket_name: str,
    account: S3ExecutionContext = Depends(get_account_context),
    actor: ManagerActor = Depends(get_current_account_admin),
    mutation: BucketConfigMutationService = Depends(get_browser_bucket_config_mutation_service),
) -> None:
    mutation.delete(
        actor=actor,
        account=account,
        bucket_name=bucket_name,
        audit_action="delete_bucket_logging",
        action=bucket_config_actions.delete_bucket_logging_config,
    )


@router.get("/buckets/config/{bucket_name}/website", response_model=BucketWebsiteConfiguration)
def get_bucket_website_config(
    bucket_name: str,
    account: S3ExecutionContext = Depends(get_account_context),
    service: BucketConfigurationService = Depends(get_bucket_configuration_service),
    _: ManagerActor = Depends(get_current_account_admin),
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
    account: S3ExecutionContext = Depends(get_account_context),
    actor: ManagerActor = Depends(get_current_account_admin),
    mutation: BucketConfigMutationService = Depends(get_browser_bucket_config_mutation_service),
) -> BucketWebsiteConfiguration:
    return mutation.update(
        actor=actor,
        account=account,
        bucket_name=bucket_name,
        audit_action="update_bucket_website",
        action=bucket_config_actions.put_bucket_website_config,
        payload=payload,
    )


@router.delete("/buckets/config/{bucket_name}/website", status_code=status.HTTP_204_NO_CONTENT)
def delete_bucket_website_config(
    bucket_name: str,
    account: S3ExecutionContext = Depends(get_account_context),
    actor: ManagerActor = Depends(get_current_account_admin),
    mutation: BucketConfigMutationService = Depends(get_browser_bucket_config_mutation_service),
) -> None:
    mutation.delete(
        actor=actor,
        account=account,
        bucket_name=bucket_name,
        audit_action="delete_bucket_website",
        action=bucket_config_actions.delete_bucket_website_config,
    )


@router.get("/buckets/config/{bucket_name}/tags")
def get_bucket_tags_config(
    bucket_name: str,
    account: S3ExecutionContext = Depends(get_account_context),
    service: BucketConfigurationService = Depends(get_bucket_configuration_service),
    _: ManagerActor = Depends(get_current_account_admin),
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
    account: S3ExecutionContext = Depends(get_account_context),
    actor: ManagerActor = Depends(get_current_account_admin),
    mutation: BucketConfigMutationService = Depends(get_browser_bucket_config_mutation_service),
) -> dict[str, Any]:
    return mutation.update(
        actor=actor,
        account=account,
        bucket_name=bucket_name,
        audit_action="update_bucket_tags",
        action=bucket_config_actions.put_bucket_tags_config,
        payload=payload,
    )


@router.delete("/buckets/config/{bucket_name}/tags", status_code=status.HTTP_204_NO_CONTENT)
def delete_bucket_tags_config(
    bucket_name: str,
    account: S3ExecutionContext = Depends(get_account_context),
    actor: ManagerActor = Depends(get_current_account_admin),
    mutation: BucketConfigMutationService = Depends(get_browser_bucket_config_mutation_service),
) -> None:
    mutation.delete(
        actor=actor,
        account=account,
        bucket_name=bucket_name,
        audit_action="delete_bucket_tags",
        action=bucket_config_actions.delete_bucket_tags_config,
    )
