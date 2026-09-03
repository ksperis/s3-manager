# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Bucket access configuration endpoints for Ceph Admin."""

from fastapi import APIRouter, Depends, Response, status

from app.models.bucket import (
    BucketAcl,
    BucketAclUpdate,
    BucketPolicyIn,
    BucketPolicyOut,
    BucketPublicAccessBlock,
)
from app.routers.ceph_admin.bucket_config_common import (
    _run_bucket_config_delete,
    _run_bucket_config_update,
)
from app.routers.ceph_admin.dependencies import (
    CephAdminContext,
    get_ceph_admin_context,
)
from app.services import bucket_config_actions
from app.services.bucket_configuration_service import BucketConfigurationService
from app.services.s3_execution_context import build_ceph_admin_s3_context

router = APIRouter()


@router.get("/{bucket_name}/policy", response_model=BucketPolicyOut)
def get_policy(
    bucket_name: str,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> BucketPolicyOut:
    service = BucketConfigurationService()
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


@router.get("/{bucket_name}/acl", response_model=BucketAcl)
def get_acl(
    bucket_name: str,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> BucketAcl:
    service = BucketConfigurationService()
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
    service = BucketConfigurationService()
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

