# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Bucket rule configuration endpoints for the Browser workspace."""

from typing import Any

from fastapi import APIRouter, Depends, status

from app.models.access_context import ManagerActor
from app.models.bucket import (
    BucketCorsUpdate,
    BucketLifecycleConfig,
    BucketLoggingConfiguration,
    BucketNotificationConfiguration,
    BucketReplicationConfiguration,
    BucketTagsUpdate,
    BucketWebsiteConfiguration,
)
from app.routers.browser_bucket_config_core import get_browser_bucket_config_mutation_service
from app.routers.browser_common import require_replication_feature
from app.routers.dependencies import (
    get_account_context,
    get_current_account_admin,
)
from app.services import bucket_config_actions
from app.services.bucket_config_mutation_service import BucketConfigMutationService
from app.services.bucket_configuration_service import (
    BucketConfigurationService,
    get_bucket_configuration_service,
)
from app.services.s3_execution_context import S3ExecutionContext

router = APIRouter()

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
