# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Read-only bucket details used by the Browser inspector."""

from fastapi import APIRouter, Depends, Query

from app.models.access_context import ManagerActor
from app.models.bucket import (
    Bucket,
    BucketLoggingConfiguration,
    BucketPolicyOut,
    BucketProperties,
    BucketWebsiteConfiguration,
)
from app.routers.dependencies import get_account_context, get_current_account_admin
from app.services import bucket_config_actions
from app.services.bucket_configuration_service import (
    BucketConfigurationService,
    get_bucket_configuration_service,
)
from app.services.buckets_service import BucketsService, get_buckets_service
from app.services.s3_execution_context import S3ExecutionContext

router = APIRouter()


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
