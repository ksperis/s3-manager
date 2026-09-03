# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Core bucket configuration endpoints for the Browser workspace."""

from typing import Any

from fastapi import APIRouter, Depends, Query, status

from app.models.access_context import ManagerActor
from app.models.bucket import (
    Bucket,
    BucketEncryptionConfiguration,
    BucketObjectLock,
    BucketObjectLockUpdate,
    BucketProperties,
    BucketVersioningUpdate,
)
from app.routers.browser_common import require_sse_feature
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
