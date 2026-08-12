# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from collections.abc import Callable
import logging
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import JSONResponse, StreamingResponse

from app.core.sensitive_data import sanitize_error_detail
from app.models.ceph_admin import (
    CephAdminAccountDeleteRequest,
    CephAdminAdminOpsResult,
    CephAdminBucketDeleteRequest,
    CephAdminBucketIndexCheckBatchRequest,
    CephAdminBucketIndexCheckRequest,
    CephAdminBucketLinkRequest,
    CephAdminBucketUnlinkRequest,
    CephAdminUserDeleteRequest,
)
from app.routers.bucket_index_check_stream import stream_bucket_index_checks
from app.routers.ceph_admin.accounts import invalidate_accounts_listing_cache
from app.routers.ceph_admin.audit import record_ceph_admin_action
from app.routers.ceph_admin.bucket_listing_cache import invalidate_bucket_listing_cache
from app.routers.ceph_admin.dependencies import CephAdminContext, get_ceph_admin_context
from app.routers.ceph_admin.user_listing_cache import invalidate_users_listing_cache
from app.services.bucket_owner_enrichment import invalidate_bucket_owner_metadata_cache
from app.services.bucket_index_check_service import BucketIndexCheckService, execute_bucket_index_check_operation
from app.services.rgw_admin import RGWAdminError, RGWAdminOperationResponse
from app.utils.normalize import normalize_optional_string
from app.utils.rgw_payloads import extract_rgw_user_identity

router = APIRouter(
    prefix="/ceph-admin/endpoints/{endpoint_id}",
    tags=["ceph-admin-admin-ops"],
)
logger = logging.getLogger(__name__)


def _qualified_user(uid: str, tenant: Optional[str]) -> str:
    return f"{tenant}${uid}" if tenant else uid


def _qualified_bucket(bucket: str, tenant: Optional[str]) -> str:
    return f"{tenant}/{bucket}" if tenant else bucket


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


def _require_confirmation(
    ctx: CephAdminContext,
    *,
    actual: Optional[str],
    expected: str,
    action: str,
    entity_type: str,
    entity_id: str,
) -> None:
    if (actual or "").strip() == expected:
        return
    record_ceph_admin_action(
        ctx,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        status="failed",
        message="Admin Ops confirmation did not match the expected phrase.",
        metadata={"validation": "confirmation_mismatch"},
    )
    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="The confirmation phrase does not match the requested operation.",
    )


def _invalidate_all_admin_ops_caches(endpoint_id: int) -> None:
    invalidate_accounts_listing_cache(endpoint_id)
    invalidate_users_listing_cache(endpoint_id)
    invalidate_bucket_listing_cache(endpoint_id)
    invalidate_bucket_owner_metadata_cache(endpoint_id)


def _invalidate_bucket_admin_ops_caches(endpoint_id: int) -> None:
    invalidate_bucket_listing_cache(endpoint_id)
    invalidate_bucket_owner_metadata_cache(endpoint_id)


def _response_status(result: CephAdminAdminOpsResult) -> int:
    if result.success:
        return status.HTTP_200_OK
    rgw_status = result.rgw_status_code
    if isinstance(rgw_status, int) and 400 <= rgw_status <= 599:
        return rgw_status
    return status.HTTP_502_BAD_GATEWAY


def _json_response(result: CephAdminAdminOpsResult) -> JSONResponse:
    return JSONResponse(
        status_code=_response_status(result),
        content=result.model_dump(mode="json"),
    )


def _network_failure(
    ctx: CephAdminContext,
    *,
    operation: str,
    action: str,
    entity_type: str,
    entity_id: str,
    exc: RGWAdminError,
    metadata: Optional[dict[str, Any]] = None,
) -> JSONResponse:
    message = str(sanitize_error_detail(str(exc)))
    result = CephAdminAdminOpsResult(
        operation=operation,
        success=False,
        rgw_status_code=None,
        rgw_error_code=None,
        message=message,
        result=None,
    )
    record_ceph_admin_action(
        ctx,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        status="failed",
        message=message,
        metadata={**(metadata or {}), "rgw_status_code": None, "rgw_error_code": None},
    )
    return _json_response(result)


def _execute(
    ctx: CephAdminContext,
    *,
    operation: str,
    action: str,
    entity_type: str,
    entity_id: str,
    call: Callable[[], RGWAdminOperationResponse],
    metadata: Optional[dict[str, Any]] = None,
    invalidate: Optional[Callable[[int], None]] = None,
) -> JSONResponse:
    try:
        upstream = call()
    except RGWAdminError as exc:
        return _network_failure(
            ctx,
            operation=operation,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            exc=exc,
            metadata=metadata,
        )
    result = CephAdminAdminOpsResult(
        operation=operation,
        success=upstream.success,
        rgw_status_code=upstream.status_code,
        rgw_error_code=upstream.error_code,
        message=upstream.message or (
            "RGW Admin Ops operation completed."
            if upstream.success
            else "RGW Admin Ops operation failed."
        ),
        result=upstream.result,
    )
    if upstream.success and invalidate is not None:
        invalidate(int(ctx.endpoint.id))
    audit_metadata = {
        **(metadata or {}),
        "rgw_status_code": upstream.status_code,
        "rgw_error_code": upstream.error_code,
    }
    record_ceph_admin_action(
        ctx,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        status="success" if upstream.success else "failed",
        message=result.message,
        metadata=audit_metadata,
    )
    return _json_response(result)


@router.delete("/accounts/{account_id}", response_model=CephAdminAdminOpsResult)
def delete_account(
    account_id: str,
    payload: CephAdminAccountDeleteRequest,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> JSONResponse:
    operation = "delete_account"
    action = "ceph_admin.account.delete"
    _require_confirmation(
        ctx,
        actual=payload.confirmation,
        expected=f"DELETE ACCOUNT {account_id}",
        action=action,
        entity_type="rgw_account",
        entity_id=account_id,
    )
    return _execute(
        ctx,
        operation=operation,
        action=action,
        entity_type="rgw_account",
        entity_id=account_id,
        call=lambda: ctx.rgw_admin.delete_account_operation(account_id),
        invalidate=_invalidate_all_admin_ops_caches,
    )


@router.delete("/users/{uid}", response_model=CephAdminAdminOpsResult)
def delete_user(
    uid: str,
    payload: CephAdminUserDeleteRequest,
    tenant: Optional[str] = Query(default=None),
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> JSONResponse:
    operation = "delete_user"
    action = "ceph_admin.user.delete"
    target = _qualified_user(uid, tenant)
    expected = f"PURGE USER {target}" if payload.purge_data else f"DELETE USER {target}"
    _require_confirmation(
        ctx,
        actual=payload.confirmation,
        expected=expected,
        action=action,
        entity_type="rgw_user",
        entity_id=target,
    )
    metadata = {"options": {"purge_data": payload.purge_data}}
    try:
        active_identity = ctx.rgw_admin.get_user_by_access_key(ctx.access_key, allow_not_found=True)
    except RGWAdminError as exc:
        return _network_failure(
            ctx,
            operation=operation,
            action=action,
            entity_type="rgw_user",
            entity_id=target,
            exc=exc,
            metadata=metadata,
        )
    active_uid, active_tenant = extract_rgw_user_identity(active_identity)
    if active_uid and _qualified_user(active_uid, active_tenant) == target:
        record_ceph_admin_action(
            ctx,
            action=action,
            entity_type="rgw_user",
            entity_id=target,
            status="failed",
            message="The active Ceph Admin service identity cannot delete itself.",
            metadata={**metadata, "validation": "active_service_identity"},
        )
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="The active Ceph Admin RGW user cannot be deleted.",
        )
    return _execute(
        ctx,
        operation=operation,
        action=action,
        entity_type="rgw_user",
        entity_id=target,
        call=lambda: ctx.rgw_admin.delete_user_operation(
            uid,
            tenant=tenant,
            purge_data=payload.purge_data,
        ),
        metadata=metadata,
        invalidate=_invalidate_all_admin_ops_caches,
    )


def _load_bucket_info(
    ctx: CephAdminContext,
    *,
    bucket: str,
    tenant: Optional[str],
    operation: str,
    action: str,
) -> dict[str, Any] | JSONResponse:
    target = _qualified_bucket(bucket, tenant)
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
) -> JSONResponse:
    operation = "delete_bucket"
    action = "ceph_admin.bucket.delete"
    target = _qualified_bucket(bucket, tenant)
    expected = (
        f"PURGE AND DELETE BUCKET {target}"
        if payload.purge_objects
        else f"DELETE BUCKET {target}"
    )
    _require_confirmation(
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
    return _execute(
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
        invalidate=_invalidate_all_admin_ops_caches,
    )


@router.post("/buckets/{bucket}/unlink", response_model=CephAdminAdminOpsResult)
def unlink_bucket(
    bucket: str,
    payload: CephAdminBucketUnlinkRequest,
    tenant: Optional[str] = Query(default=None),
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> JSONResponse:
    operation = "unlink_bucket"
    action = "ceph_admin.bucket.unlink"
    target = _qualified_bucket(bucket, tenant)
    _require_confirmation(
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
        invalidate=_invalidate_all_admin_ops_caches,
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
    target = _qualified_bucket(bucket, tenant)
    selected_target = payload.target_id.strip()
    _require_confirmation(
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
        invalidate=_invalidate_all_admin_ops_caches,
    )


@router.post("/buckets/{bucket}/index-check", response_model=CephAdminAdminOpsResult)
def check_bucket_index(
    bucket: str,
    payload: CephAdminBucketIndexCheckRequest,
    tenant: Optional[str] = Query(default=None),
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> JSONResponse:
    operation = "check_bucket_index"
    action = "ceph_admin.bucket.index_check"
    target = _qualified_bucket(bucket, tenant)
    if payload.fix:
        _require_confirmation(
            ctx,
            actual=payload.confirmation,
            expected=f"FIX BUCKET INDEX {target}",
            action=action,
            entity_type="rgw_bucket",
            entity_id=target,
        )
    options = {"fix": payload.fix, "check_objects": payload.check_objects}
    return _execute(
        ctx,
        operation=operation,
        action=action,
        entity_type="rgw_bucket",
        entity_id=target,
        call=lambda: execute_bucket_index_check_operation(
            ctx.rgw_admin,
            bucket=bucket,
            tenant=tenant,
            fix=payload.fix,
            check_objects=payload.check_objects,
        ),
        metadata={"options": options},
        invalidate=_invalidate_bucket_admin_ops_caches,
    )


@router.post("/bucket-index-check/stream")
def stream_bucket_index_check_batch(
    payload: CephAdminBucketIndexCheckBatchRequest,
    request: Request,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> StreamingResponse:
    service = BucketIndexCheckService()

    def run_check(progress_callback, cancel_check):
        result = service.run(
            ctx.rgw_admin,
            payload.targets,
            endpoint_id=int(ctx.endpoint.id),
            endpoint_name=ctx.endpoint.name,
            parallelism=payload.parallelism,
            progress_callback=progress_callback,
            cancel_check=cancel_check,
        )
        _invalidate_bucket_admin_ops_caches(int(ctx.endpoint.id))
        return result

    return stream_bucket_index_checks(request, run_check=run_check, logger=logger)
