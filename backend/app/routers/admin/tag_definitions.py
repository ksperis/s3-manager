# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.db import User, is_superadmin_ui_role
from app.models.tagging import TagDefinitionListResponse
from app.routers.dependencies import get_current_super_admin
from app.services.tags_service import TagsService
from app.utils.tagging import TAG_DOMAIN_ADMIN_MANAGED, TAG_DOMAIN_ENDPOINT

router = APIRouter(prefix="/admin/tag-definitions", tags=["admin-tag-definitions"])


@router.get("", response_model=TagDefinitionListResponse)
def list_admin_tag_definitions(
    domain: str = Query(..., pattern="^(admin_managed|endpoint)$"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_super_admin),
) -> TagDefinitionListResponse:
    if domain == TAG_DOMAIN_ENDPOINT and not is_superadmin_ui_role(current_user.role):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")
    service = TagsService(db)
    return TagDefinitionListResponse(
        items=service.list_definitions(
            domain_kind=TAG_DOMAIN_ENDPOINT if domain == TAG_DOMAIN_ENDPOINT else TAG_DOMAIN_ADMIN_MANAGED,
            owner_user_id=None,
        )
    )
