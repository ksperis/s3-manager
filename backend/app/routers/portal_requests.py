# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.db import User
from app.models.portal_requests import PortalAdminRequestCreate, PortalAdminRequestOut, PortalAdminRequestStatus
from app.routers.dependencies import AccountAccess, get_portal_account_access
from app.routers.http_errors import sanitize_error_detail
from app.services.portal_requests_service import (
    PortalRequestNotFound,
    PortalRequestsService,
    get_portal_requests_service,
)

router = APIRouter(prefix="/portal/requests", tags=["portal-requests"])


def _portal_actor(access: AccountAccess) -> User:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal requests require a UI user")
    return actor


@router.get("", response_model=list[PortalAdminRequestOut])
def list_portal_requests(
    status_filter: Optional[PortalAdminRequestStatus] = Query(None, alias="status"),
    access: AccountAccess = Depends(get_portal_account_access),
    service: PortalRequestsService = Depends(lambda db=Depends(get_db): get_portal_requests_service(db)),
) -> list[PortalAdminRequestOut]:
    return service.list_for_portal_user(_portal_actor(access), access, status=status_filter)


@router.post("", response_model=PortalAdminRequestOut, status_code=status.HTTP_201_CREATED)
def create_portal_request(
    payload: PortalAdminRequestCreate,
    access: AccountAccess = Depends(get_portal_account_access),
    service: PortalRequestsService = Depends(lambda db=Depends(get_db): get_portal_requests_service(db)),
) -> PortalAdminRequestOut:
    try:
        return service.create_request(_portal_actor(access), access, payload)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=sanitize_error_detail(str(exc))) from exc


@router.get("/{request_id}", response_model=PortalAdminRequestOut)
def get_portal_request(
    request_id: int,
    access: AccountAccess = Depends(get_portal_account_access),
    service: PortalRequestsService = Depends(lambda db=Depends(get_db): get_portal_requests_service(db)),
) -> PortalAdminRequestOut:
    try:
        return service.get_for_portal_user(_portal_actor(access), access, request_id)
    except PortalRequestNotFound as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=sanitize_error_detail(str(exc))) from exc
