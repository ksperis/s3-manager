# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Core bucket configuration endpoints for the Manager workspace."""

from fastapi import APIRouter, Depends, status

from app.models.access_context import ManagerActor
from app.models.bucket import (
    BucketEncryptionConfiguration,
    BucketObjectLock,
    BucketObjectLockUpdate,
    BucketProperties,
    BucketVersioningStatus,
    BucketVersioningUpdate,
)
from app.routers.browser_common import require_sse_feature
from app.routers.dependencies import get_account_context, get_audit_service, get_current_account_admin
from app.services import bucket_config_actions
from app.services.audit_service import AuditService
from app.services.bucket_config_mutation_service import BucketConfigMutationService
from app.services.bucket_configuration_service import (
    BucketConfigurationService,
    get_bucket_configuration_service,
)
from app.services.bucket_listing_cache import invalidate_bucket_listing_cache_for_account
from app.services.s3_execution_context import S3ExecutionContext

router = APIRouter(tags=["manager-buckets"])


def _invalidate_manager_bucket_config_cache(
    account: S3ExecutionContext,
    _bucket_name: str,
) -> None:
    invalidate_bucket_listing_cache_for_account(account)


def get_manager_bucket_config_mutation_service(
    configuration_service: BucketConfigurationService = Depends(get_bucket_configuration_service),
    audit_service: AuditService = Depends(get_audit_service),
) -> BucketConfigMutationService:
    return BucketConfigMutationService(
        configuration_service=configuration_service,
        audit_service=audit_service,
        audit_scope="manager",
        cache_invalidator=_invalidate_manager_bucket_config_cache,
    )


@router.get("/{bucket_name}/properties", response_model=BucketProperties)
def bucket_properties(
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


@router.get("/{bucket_name}/versioning", response_model=BucketVersioningStatus)
def get_versioning(
    bucket_name: str,
    account: S3ExecutionContext = Depends(get_account_context),
    service: BucketConfigurationService = Depends(get_bucket_configuration_service),
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
    current_user: ManagerActor = Depends(get_current_account_admin),
    mutation: BucketConfigMutationService = Depends(get_manager_bucket_config_mutation_service),
):
    return mutation.update(
        actor=current_user,
        account=account,
        bucket_name=bucket_name,
        audit_action="update_bucket_versioning",
        action=bucket_config_actions.update_bucket_versioning_config,
        payload=payload,
    )


@router.get("/{bucket_name}/object-lock", response_model=BucketObjectLock)
def get_object_lock(
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


@router.put("/{bucket_name}/object-lock", response_model=BucketObjectLock)
def put_object_lock(
    bucket_name: str,
    payload: BucketObjectLockUpdate,
    account: S3ExecutionContext = Depends(get_account_context),
    current_user: ManagerActor = Depends(get_current_account_admin),
    mutation: BucketConfigMutationService = Depends(get_manager_bucket_config_mutation_service),
) -> BucketObjectLock:
    return mutation.update(
        actor=current_user,
        account=account,
        bucket_name=bucket_name,
        audit_action="update_bucket_object_lock",
        action=bucket_config_actions.put_bucket_object_lock_config,
        payload=payload,
    )


@router.get("/{bucket_name}/encryption", response_model=BucketEncryptionConfiguration)
def get_bucket_encryption(
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


@router.put("/{bucket_name}/encryption", response_model=BucketEncryptionConfiguration)
def put_bucket_encryption(
    bucket_name: str,
    payload: BucketEncryptionConfiguration,
    account: S3ExecutionContext = Depends(get_account_context),
    current_user: ManagerActor = Depends(get_current_account_admin),
    mutation: BucketConfigMutationService = Depends(get_manager_bucket_config_mutation_service),
) -> BucketEncryptionConfiguration:
    require_sse_feature(account)
    return mutation.update(
        actor=current_user,
        account=account,
        bucket_name=bucket_name,
        audit_action="update_bucket_encryption",
        action=bucket_config_actions.put_bucket_encryption_config,
        payload=payload,
    )


@router.delete("/{bucket_name}/encryption", status_code=status.HTTP_204_NO_CONTENT)
def delete_bucket_encryption(
    bucket_name: str,
    account: S3ExecutionContext = Depends(get_account_context),
    current_user: ManagerActor = Depends(get_current_account_admin),
    mutation: BucketConfigMutationService = Depends(get_manager_bucket_config_mutation_service),
) -> None:
    require_sse_feature(account)
    mutation.delete(
        actor=current_user,
        account=account,
        bucket_name=bucket_name,
        audit_action="delete_bucket_encryption",
        action=bucket_config_actions.delete_bucket_encryption_config,
    )
# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Core bucket configuration endpoints for the Manager workspace."""
