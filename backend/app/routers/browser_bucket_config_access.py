# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Bucket access configuration endpoints for the Browser workspace."""

from fastapi import APIRouter, Depends, status

from app.models.access_context import ManagerActor
from app.models.bucket import (
    BucketAcl,
    BucketAclUpdate,
    BucketPolicyIn,
    BucketPolicyOut,
    BucketPublicAccessBlock,
)
from app.routers.browser_bucket_config_core import get_browser_bucket_config_mutation_service
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

