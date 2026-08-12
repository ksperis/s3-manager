# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from collections.abc import Callable
from typing import Any, Optional

from fastapi import HTTPException, status
from fastapi.responses import JSONResponse

from app.core.sensitive_data import sanitize_error_detail
from app.models.ceph_admin import CephAdminAdminOpsResult
from app.routers.ceph_admin.account_listing_cache import invalidate_accounts_listing_cache
from app.routers.ceph_admin.audit import record_ceph_admin_action
from app.routers.ceph_admin.bucket_listing_cache import invalidate_bucket_listing_cache
from app.routers.ceph_admin.dependencies import CephAdminContext
from app.routers.ceph_admin.user_listing_cache import invalidate_users_listing_cache
from app.services.bucket_owner_enrichment import invalidate_bucket_owner_metadata_cache
from app.services.rgw_admin import RGWAdminError, RGWAdminOperationResponse


def qualified_user(uid: str, tenant: Optional[str]) -> str:
    return f"{tenant}${uid}" if tenant else uid


def qualified_bucket(bucket: str, tenant: Optional[str]) -> str:
    return f"{tenant}/{bucket}" if tenant else bucket


def require_confirmation(
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


def invalidate_all_admin_ops_caches(endpoint_id: int) -> None:
    invalidate_accounts_listing_cache(endpoint_id)
    invalidate_users_listing_cache(endpoint_id)
    invalidate_bucket_listing_cache(endpoint_id)
    invalidate_bucket_owner_metadata_cache(endpoint_id)


def invalidate_bucket_admin_ops_caches(endpoint_id: int) -> None:
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


def admin_ops_network_failure(
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


def execute_admin_operation(
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
        return admin_ops_network_failure(
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
