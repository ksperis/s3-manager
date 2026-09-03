# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Shared execution helpers for Ceph Admin bucket configuration."""

from typing import Any, Callable, Literal

from fastapi import HTTPException, Response, status

from app.routers.ceph_admin.audit import record_ceph_admin_action
from app.routers.ceph_admin.dependencies import CephAdminContext
from app.services import bucket_config_actions
from app.services.bucket_configuration_service import BucketConfigurationService
from app.services.ceph_admin_bucket_listing_cache import invalidate_bucket_listing_cache
from app.services.s3_execution_context import S3ExecutionContext, build_ceph_admin_s3_context
from app.utils.storage_endpoint_features import resolve_feature_flags


def _require_sse_feature(ctx: CephAdminContext) -> None:
    if not resolve_feature_flags(ctx.endpoint).sse_enabled:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Server-side encryption is disabled for this endpoint",
        )


def _require_replication_feature(ctx: CephAdminContext) -> None:
    if not resolve_feature_flags(ctx.endpoint).replication_enabled:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Bucket replication is disabled for this endpoint",
        )


def _record_bucket_config_mutation(
    ctx: CephAdminContext,
    bucket_name: str,
    *,
    config_area: str,
    operation: Literal["update", "delete"],
    metadata: dict[str, Any] | None = None,
) -> None:
    invalidate_bucket_listing_cache(ctx.endpoint.id)
    record_ceph_admin_action(
        ctx,
        action=f"bucket_config.{config_area}.{operation}",
        entity_type="bucket",
        entity_id=bucket_name,
        metadata=bucket_config_actions.bucket_config_audit_metadata(
            config_area=config_area,
            operation=operation,
            metadata=metadata,
        ),
    )


def _ceph_admin_bucket_config_account(ctx: CephAdminContext) -> tuple[BucketConfigurationService, S3ExecutionContext]:
    return BucketConfigurationService(), build_ceph_admin_s3_context(ctx)


def _run_bucket_config_update(
    ctx: CephAdminContext,
    bucket_name: str,
    *,
    config_area: str,
    action: Callable[..., tuple[Any, dict[str, Any]]],
    **kwargs: Any,
) -> Any:
    service, account = _ceph_admin_bucket_config_account(ctx)
    return bucket_config_actions.apply_bucket_config_update(
        service=service,
        account=account,
        bucket_name=bucket_name,
        action=action,
        audit_recorder=lambda metadata: _record_bucket_config_mutation(
            ctx,
            bucket_name,
            config_area=config_area,
            operation="update",
            metadata=metadata,
        ),
        **kwargs,
    )


def _run_bucket_config_delete(
    ctx: CephAdminContext,
    bucket_name: str,
    *,
    config_area: str,
    action: Callable[..., None],
) -> Response:
    service, account = _ceph_admin_bucket_config_account(ctx)
    return bucket_config_actions.apply_bucket_config_delete(
        service=service,
        account=account,
        bucket_name=bucket_name,
        action=action,
        audit_recorder=lambda metadata: _record_bucket_config_mutation(
            ctx,
            bucket_name,
            config_area=config_area,
            operation="delete",
            metadata=metadata,
        ),
    )

