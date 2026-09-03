# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.db import User
from app.models.admin_navigation import AdminPendingRequestCounts
from app.routers.dependencies import get_current_super_admin
from app.services.admin_navigation_service import AdminNavigationService


router = APIRouter(prefix="/admin/navigation", tags=["admin-navigation"])


@router.get("/pending-requests", response_model=AdminPendingRequestCounts)
def get_pending_request_counts(
    db: Session = Depends(get_db),
    actor: User = Depends(get_current_super_admin),
) -> AdminPendingRequestCounts:
    return AdminNavigationService.pending_request_counts(db, actor)
