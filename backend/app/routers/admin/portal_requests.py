# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.db import User
from app.models.portal_requests import (
    PortalAdminRequestDecision,
    PortalAdminRequestMessageCreate,
    PortalAdminRequestOut,
    PortalAdminRequestStatus,
    PortalAdminRequestType,
)
from app.routers.dependencies import get_current_super_admin
from app.utils.http_errors import sanitize_error_detail
from app.services.portal_requests_service import (
    PortalRequestConflict,
    PortalRequestExecutionError,
    PortalRequestNotFound,
    PortalRequestsService,
    get_portal_requests_service,
)

router = APIRouter(prefix="/admin/portal-requests", tags=["admin-portal-requests"])


def _raise_portal_request_error(exc: Exception) -> None:
    detail = sanitize_error_detail(str(exc))
    if isinstance(exc, PortalRequestNotFound):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=detail) from exc
    if isinstance(exc, PortalRequestConflict):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=detail) from exc
    if isinstance(exc, PortalRequestExecutionError):
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=detail) from exc
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=detail) from exc


@router.get("", response_model=list[PortalAdminRequestOut])
def list_admin_portal_requests(
    status_filter: Optional[PortalAdminRequestStatus] = Query(None, alias="status"),
    request_type: Optional[PortalAdminRequestType] = Query(None),
    account_id: Optional[int] = Query(None),
    search: Optional[str] = Query(None),
    limit: int = Query(200, ge=1, le=500),
    _: User = Depends(get_current_super_admin),
    service: PortalRequestsService = Depends(lambda db=Depends(get_db): get_portal_requests_service(db)),
) -> list[PortalAdminRequestOut]:
    return service.list_for_admin(
        status=status_filter,
        request_type=request_type,
        account_id=account_id,
        search=search,
        limit=limit,
    )


@router.get("/{request_id}", response_model=PortalAdminRequestOut)
def get_admin_portal_request(
    request_id: int,
    _: User = Depends(get_current_super_admin),
    service: PortalRequestsService = Depends(lambda db=Depends(get_db): get_portal_requests_service(db)),
) -> PortalAdminRequestOut:
    try:
        return service.get_for_admin(request_id)
    except PortalRequestNotFound as exc:
        _raise_portal_request_error(exc)


@router.post("/{request_id}/approve", response_model=PortalAdminRequestOut)
def approve_admin_portal_request(
    request_id: int,
    payload: PortalAdminRequestDecision,
    current_user: User = Depends(get_current_super_admin),
    service: PortalRequestsService = Depends(lambda db=Depends(get_db): get_portal_requests_service(db)),
) -> PortalAdminRequestOut:
    try:
        return service.approve_request(request_id, current_user, message=payload.message)
    except (PortalRequestNotFound, PortalRequestConflict, PortalRequestExecutionError, ValueError) as exc:
        _raise_portal_request_error(exc)


@router.post("/{request_id}/reject", response_model=PortalAdminRequestOut)
def reject_admin_portal_request(
    request_id: int,
    payload: PortalAdminRequestDecision,
    current_user: User = Depends(get_current_super_admin),
    service: PortalRequestsService = Depends(lambda db=Depends(get_db): get_portal_requests_service(db)),
) -> PortalAdminRequestOut:
    try:
        return service.reject_request(request_id, current_user, message=payload.message)
    except (PortalRequestNotFound, PortalRequestConflict, ValueError) as exc:
        _raise_portal_request_error(exc)


@router.post("/{request_id}/messages", response_model=PortalAdminRequestOut)
def add_admin_portal_request_message(
    request_id: int,
    payload: PortalAdminRequestMessageCreate,
    current_user: User = Depends(get_current_super_admin),
    service: PortalRequestsService = Depends(lambda db=Depends(get_db): get_portal_requests_service(db)),
) -> PortalAdminRequestOut:
    try:
        return service.add_admin_message(request_id, current_user, payload.message)
    except (PortalRequestNotFound, ValueError) as exc:
        _raise_portal_request_error(exc)
