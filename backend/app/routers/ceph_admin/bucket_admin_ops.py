# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.ceph_admin import (
    CephAdminAdminOpsResult,
    CephAdminBucketDeleteRequest,
    CephAdminBucketLinkRequest,
    CephAdminBucketUnlinkRequest,
)
from app.routers.ceph_admin.admin_ops_common import (
    admin_ops_network_failure as _network_failure,
    execute_admin_operation as _execute,
    invalidate_all_admin_ops_caches,
    qualified_bucket,
    require_confirmation,
)
from app.routers.ceph_admin.audit import record_ceph_admin_action
from app.routers.ceph_admin.dependencies import CephAdminContext, get_ceph_admin_context
from app.services.rgw_admin import RGWAdminError
from app.services.bucket_ui_tags_service import BucketUiTagsService, PhysicalBucketTarget
from app.utils.normalize import normalize_optional_string

router = APIRouter()


def _bucket_value(payload: Any, *keys: str) -> Optional[str]:
    if not isinstance(payload, dict):
        return None
    candidates = [payload]
    for nested_key in ("bucket", "data", "stats"):
        nested = payload.get(nested_key)
        if isinstance(nested, dict):
            candidates.append(nested)
    for candidate in candidates:
        for key in keys:
            value = normalize_optional_string(candidate.get(key))
            if value:
                return value
    return None


def _load_bucket_info(
    ctx: CephAdminContext,
    *,
    bucket: str,
    tenant: Optional[str],
    operation: str,
    action: str,
) -> dict[str, Any] | JSONResponse:
    target = qualified_bucket(bucket, tenant)
    try:
        bucket_info = ctx.rgw_admin.get_bucket_info(
            bucket,
            tenant=tenant,
            stats=False,
            allow_not_found=True,
        )
    except RGWAdminError as exc:
        return _network_failure(
            ctx,
            operation=operation,
            action=action,
            entity_type="rgw_bucket",
            entity_id=target,
            exc=exc,
        )
    if not isinstance(bucket_info, dict) or not bucket_info:
        record_ceph_admin_action(
            ctx,
            action=action,
            entity_type="rgw_bucket",
            entity_id=target,
            status="failed",
            message="RGW bucket was not found.",
            metadata={"validation": "bucket_not_found"},
        )
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="RGW bucket not found.")
    return bucket_info


@router.delete("/buckets/{bucket}", response_model=CephAdminAdminOpsResult)
def delete_bucket(
    bucket: str,
    payload: CephAdminBucketDeleteRequest,
    tenant: Optional[str] = Query(default=None),
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
    db: Session = Depends(get_db),
) -> JSONResponse:
    operation = "delete_bucket"
    action = "ceph_admin.bucket.delete"
    target = qualified_bucket(bucket, tenant)
    expected = (
        f"PURGE AND DELETE BUCKET {target}"
        if payload.purge_objects
        else f"DELETE BUCKET {target}"
    )
    require_confirmation(
        ctx,
        actual=payload.confirmation,
        expected=expected,
        action=action,
        entity_type="rgw_bucket",
        entity_id=target,
    )
    options = {
        "purge_objects": payload.purge_objects,
        "bypass_gc": payload.bypass_gc,
    }
    response = _execute(
        ctx,
        operation=operation,
        action=action,
        entity_type="rgw_bucket",
        entity_id=target,
        call=lambda: ctx.rgw_admin.delete_bucket_operation(
            bucket,
            tenant=tenant,
            purge_objects=payload.purge_objects,
            bypass_gc=payload.bypass_gc,
        ),
        metadata={"options": options},
        invalidate=invalidate_all_admin_ops_caches,
    )
    if response.status_code == status.HTTP_200_OK:
        tag_service = BucketUiTagsService(db)
        tag_service.remove_all_namespaces_for_bucket(
            PhysicalBucketTarget.create(ctx.endpoint.id, tenant, bucket)
        )
        tag_service.commit()
    return response


@router.post("/buckets/{bucket}/unlink", response_model=CephAdminAdminOpsResult)
def unlink_bucket(
    bucket: str,
    payload: CephAdminBucketUnlinkRequest,
    tenant: Optional[str] = Query(default=None),
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> JSONResponse:
    operation = "unlink_bucket"
    action = "ceph_admin.bucket.unlink"
    target = qualified_bucket(bucket, tenant)
    require_confirmation(
        ctx,
        actual=payload.confirmation,
        expected=f"UNLINK BUCKET {target}",
        action=action,
        entity_type="rgw_bucket",
        entity_id=target,
    )
    bucket_info = _load_bucket_info(
        ctx,
        bucket=bucket,
        tenant=tenant,
        operation=operation,
        action=action,
    )
    if isinstance(bucket_info, JSONResponse):
        return bucket_info
    current_owner = _bucket_value(bucket_info, "owner")
    if not current_owner:
        record_ceph_admin_action(
            ctx,
            action=action,
            entity_type="rgw_bucket",
            entity_id=target,
            status="failed",
            message="RGW did not return a current bucket owner.",
            metadata={"validation": "owner_missing"},
        )
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="The current RGW bucket owner could not be resolved.",
        )
    return _execute(
        ctx,
        operation=operation,
        action=action,
        entity_type="rgw_bucket",
        entity_id=target,
        call=lambda: ctx.rgw_admin.unlink_bucket_operation(
            bucket,
            tenant=tenant,
            uid=current_owner,
        ),
        metadata={"old_owner": current_owner, "new_owner": None, "options": {}},
        invalidate=invalidate_all_admin_ops_caches,
    )


def _validate_link_target(
    ctx: CephAdminContext,
    *,
    payload: CephAdminBucketLinkRequest,
    operation: str,
    action: str,
    bucket_target: str,
) -> str | JSONResponse:
    raw_target = payload.target_id.strip()
    try:
        if payload.target_type == "account":
            target = ctx.rgw_admin.get_account(
                raw_target,
                allow_not_found=True,
                allow_not_implemented=True,
            )
            exists = isinstance(target, dict) and bool(target)
        else:
            target_tenant = None
            target_uid = raw_target
            if "$" in raw_target:
                target_tenant, target_uid = raw_target.split("$", 1)
            target = ctx.rgw_admin.get_user(
                target_uid,
                tenant=target_tenant,
                allow_not_found=True,
            )
            exists = isinstance(target, dict) and bool(target)
    except RGWAdminError as exc:
        return _network_failure(
            ctx,
            operation=operation,
            action=action,
            entity_type="rgw_bucket",
            entity_id=bucket_target,
            exc=exc,
            metadata={"new_owner": raw_target, "target_type": payload.target_type},
        )
    if not exists:
        record_ceph_admin_action(
            ctx,
            action=action,
            entity_type="rgw_bucket",
            entity_id=bucket_target,
            status="failed",
            message="The selected RGW link target was not found.",
            metadata={
                "validation": "target_not_found",
                "new_owner": raw_target,
                "target_type": payload.target_type,
            },
        )
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="The selected RGW User or Account was not found.",
        )
    return raw_target


@router.put("/buckets/{bucket}/link", response_model=CephAdminAdminOpsResult)
def link_bucket(
    bucket: str,
    payload: CephAdminBucketLinkRequest,
    tenant: Optional[str] = Query(default=None),
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> JSONResponse:
    operation = "link_bucket"
    action = "ceph_admin.bucket.link"
    target = qualified_bucket(bucket, tenant)
    selected_target = payload.target_id.strip()
    require_confirmation(
        ctx,
        actual=payload.confirmation,
        expected=f"LINK BUCKET {target} TO {selected_target}",
        action=action,
        entity_type="rgw_bucket",
        entity_id=target,
    )
    bucket_info = _load_bucket_info(
        ctx,
        bucket=bucket,
        tenant=tenant,
        operation=operation,
        action=action,
    )
    if isinstance(bucket_info, JSONResponse):
        return bucket_info
    validated_target = _validate_link_target(
        ctx,
        payload=payload,
        operation=operation,
        action=action,
        bucket_target=target,
    )
    if isinstance(validated_target, JSONResponse):
        return validated_target
    bucket_id = _bucket_value(bucket_info, "id", "bucket_id", "bucket-id")
    current_owner = _bucket_value(bucket_info, "owner")
    metadata = {
        "old_owner": current_owner,
        "new_owner": validated_target,
        "target_type": payload.target_type,
        "bucket_id": bucket_id,
        "options": {},
    }
    return _execute(
        ctx,
        operation=operation,
        action=action,
        entity_type="rgw_bucket",
        entity_id=target,
        call=lambda: ctx.rgw_admin.link_bucket_operation(
            bucket,
            tenant=tenant,
            uid=validated_target,
            bucket_id=bucket_id,
        ),
        metadata=metadata,
        invalidate=invalidate_all_admin_ops_caches,
    )
