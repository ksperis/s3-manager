# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Portal activity and collaborator read endpoints."""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.db import User
from app.models.access_context import AccountAccess
from app.models.portal_monitoring import PortalActivityItem
from app.models.portal_sharing import (
    PortalCollaboratorAccessReview,
    PortalCollaboratorsResponse,
)
from app.routers.dependencies import get_portal_account_access
from app.routers.portal_common import (
    get_portal_service_dependency,
    raise_portal_storage_runtime,
)
from app.services.portal_service import PortalService

router = APIRouter()


@router.get("/activity", response_model=list[PortalActivityItem])
def portal_activity(
    space_id: Optional[str] = Query(None),
    limit: int = Query(100, ge=1, le=200),
    access: AccountAccess = Depends(get_portal_account_access),
    service: PortalService = Depends(get_portal_service_dependency),
) -> list[PortalActivityItem]:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    try:
        return service.list_portal_activity(actor, access, space_id=space_id, limit=limit)
    except RuntimeError as exc:
        raise_portal_storage_runtime(exc)
@router.get("/collaborators", response_model=PortalCollaboratorsResponse)
def portal_collaborators(
    access: AccountAccess = Depends(get_portal_account_access),
    service: PortalService = Depends(get_portal_service_dependency),
) -> PortalCollaboratorsResponse:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    try:
        return service.list_portal_collaborators(actor, access)
    except RuntimeError as exc:
        raise_portal_storage_runtime(exc)


@router.get("/collaborators/{user_id}/access", response_model=PortalCollaboratorAccessReview)
def portal_collaborator_access_review(
    user_id: int,
    access: AccountAccess = Depends(get_portal_account_access),
    service: PortalService = Depends(get_portal_service_dependency),
) -> PortalCollaboratorAccessReview:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    try:
        return service.get_portal_collaborator_access_review(actor, access, user_id)
    except RuntimeError as exc:
        raise_portal_storage_runtime(exc)
