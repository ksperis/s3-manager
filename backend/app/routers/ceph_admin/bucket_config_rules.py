# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Bucket rule configuration endpoints for Ceph Admin."""

from fastapi import APIRouter, Depends, Response, status

from app.models.bucket import (
    BucketCorsUpdate,
    BucketLifecycleConfig,
    BucketLoggingConfiguration,
    BucketNotificationConfiguration,
    BucketReplicationConfiguration,
    BucketTagsUpdate,
    BucketWebsiteConfiguration,
)
from app.routers.ceph_admin.bucket_config_common import (
    _require_replication_feature,
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


@router.get("/{bucket_name}/lifecycle", response_model=BucketLifecycleConfig)
def get_lifecycle(
    bucket_name: str,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> BucketLifecycleConfig:
    service = BucketConfigurationService()
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
    service = BucketConfigurationService()
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


@router.get("/{bucket_name}/notifications", response_model=BucketNotificationConfiguration)
def get_notifications(
    bucket_name: str,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> BucketNotificationConfiguration:
    service = BucketConfigurationService()
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
    service = BucketConfigurationService()
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
    service = BucketConfigurationService()
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
    service = BucketConfigurationService()
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
    service = BucketConfigurationService()
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

