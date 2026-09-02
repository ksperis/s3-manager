# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import JSONResponse

from app.models.ceph_admin import (
    CephAdminAdminOpsConfirmation,
    CephAdminAdminOpsResult,
    CephAdminUserDeleteRequest,
)
from app.routers.ceph_admin.admin_ops_common import (
    admin_ops_network_failure as _network_failure,
    execute_admin_operation as _execute,
    invalidate_all_admin_ops_caches,
    qualified_user,
    require_confirmation,
)
from app.routers.ceph_admin.audit import record_ceph_admin_action
from app.routers.ceph_admin.dependencies import CephAdminContext, get_ceph_admin_context
from app.services.rgw_admin import RGWAdminError
from app.utils.rgw_payloads import extract_rgw_user_identity

router = APIRouter()


@router.delete("/accounts/{account_id}", response_model=CephAdminAdminOpsResult)
def delete_account(
    account_id: str,
    payload: CephAdminAdminOpsConfirmation,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> JSONResponse:
    operation = "delete_account"
    action = "ceph_admin.account.delete"
    require_confirmation(
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
        invalidate=invalidate_all_admin_ops_caches,
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
    target = qualified_user(uid, tenant)
    expected = f"PURGE USER {target}" if payload.purge_data else f"DELETE USER {target}"
    require_confirmation(
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
    if active_uid and qualified_user(active_uid, active_tenant) == target:
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
        invalidate=invalidate_all_admin_ops_caches,
    )
