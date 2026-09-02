# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Portal access-key endpoints."""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Response, status

from app.core.sensitive_data import sanitize_error_detail
from app.db import User
from app.models.access_context import AccountAccess
from app.models.portal_access_keys import (
    PortalAccessKey,
    PortalAccessKeyCreate,
    PortalAccessKeysState,
    PortalAccessKeyStatusChange,
)
from app.routers.dependencies import get_audit_service, get_portal_account_access
from app.routers.portal_common import get_portal_service_dependency
from app.services.audit_service import AuditService
from app.services.portal.exceptions import (
    PortalAccessKeyLimitExceeded,
    PortalAccessKeyManagementDisabled,
    PortalAccessKeyProtected,
)
from app.services.portal_service import PortalService
from app.utils.http_errors import raise_bad_gateway_from_runtime

router = APIRouter()


def _raise_portal_access_key_runtime(exc: RuntimeError) -> None:
    detail = sanitize_error_detail(str(exc))
    lowered = detail.lower()
    if isinstance(exc, PortalAccessKeyManagementDisabled):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=detail) from exc
    if isinstance(exc, PortalAccessKeyLimitExceeded):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=detail) from exc
    if isinstance(exc, PortalAccessKeyProtected):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=detail) from exc
    if "is required" in lowered:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=detail) from exc
    if "not found" in lowered or "introuvable" in lowered:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=detail) from exc
    if (
        "not allowed" in lowered
        or "not provisioned" in lowered
        or "owner content role required" in lowered
        or "archived" in lowered
    ):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=detail) from exc
    raise_bad_gateway_from_runtime(exc)


@router.get("/access-keys", response_model=PortalAccessKeysState)
def portal_access_keys(
    access: AccountAccess = Depends(get_portal_account_access),
    service: PortalService = Depends(get_portal_service_dependency),
) -> PortalAccessKeysState:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    try:
        return service.get_access_keys_state(actor, access)
    except RuntimeError as exc:
        _raise_portal_access_key_runtime(exc)


@router.post("/access-keys", response_model=PortalAccessKey, status_code=status.HTTP_201_CREATED)
def create_portal_access_key(
    payload: Optional[PortalAccessKeyCreate] = None,
    access: AccountAccess = Depends(get_portal_account_access),
    audit_service: AuditService = Depends(get_audit_service),
    service: PortalService = Depends(get_portal_service_dependency),
) -> PortalAccessKey:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    try:
        key = service.create_access_key(actor, access, payload)
        audit_metadata = {"access_key_id": key.access_key_id}
        if key.target_type == "external":
            audit_metadata.update(
                {
                    "target_type": key.target_type,
                    "storage_space_id": key.bucket_name,
                    "permission": key.permission,
                    "external_email": key.external_email,
                }
            )
        audit_service.record_action(
            user=actor,
            scope="portal",
            action="create_portal_access_key",
            entity_type="portal_access_key",
            entity_id=key.access_key_id,
            account=access.account,
            metadata=audit_metadata,
        )
        return key
    except RuntimeError as exc:
        _raise_portal_access_key_runtime(exc)


@router.put("/access-keys/{access_key_id}/status", response_model=PortalAccessKey)
def update_portal_access_key_status(
    access_key_id: str,
    payload: PortalAccessKeyStatusChange,
    access: AccountAccess = Depends(get_portal_account_access),
    audit_service: AuditService = Depends(get_audit_service),
    service: PortalService = Depends(get_portal_service_dependency),
) -> PortalAccessKey:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    try:
        key = service.update_access_key_status(actor, access, access_key_id, payload.active)
        audit_metadata = {"access_key_id": access_key_id, "active": payload.active}
        if key.target_type == "external":
            audit_metadata.update(
                {
                    "target_type": key.target_type,
                    "storage_space_id": key.bucket_name,
                    "permission": key.permission,
                    "external_email": key.external_email,
                }
            )
        audit_service.record_action(
            user=actor,
            scope="portal",
            action="update_portal_access_key_status",
            entity_type="portal_access_key",
            entity_id=access_key_id,
            account=access.account,
            metadata=audit_metadata,
        )
        return key
    except RuntimeError as exc:
        _raise_portal_access_key_runtime(exc)


@router.delete("/access-keys/{access_key_id}", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def delete_portal_access_key(
    access_key_id: str,
    access: AccountAccess = Depends(get_portal_account_access),
    audit_service: AuditService = Depends(get_audit_service),
    service: PortalService = Depends(get_portal_service_dependency),
) -> Response:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    try:
        key = service.delete_access_key(actor, access, access_key_id)
        audit_metadata = {"access_key_id": access_key_id}
        if key is not None and key.target_type == "external":
            audit_metadata.update(
                {
                    "target_type": key.target_type,
                    "storage_space_id": key.bucket_name,
                    "permission": key.permission,
                    "external_email": key.external_email,
                }
            )
        audit_service.record_action(
            user=actor,
            scope="portal",
            action="delete_portal_access_key",
            entity_type="portal_access_key",
            entity_id=access_key_id,
            account=access.account,
            metadata=audit_metadata,
        )
    except RuntimeError as exc:
        _raise_portal_access_key_runtime(exc)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
