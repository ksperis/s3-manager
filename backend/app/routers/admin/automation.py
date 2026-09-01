# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from fastapi import APIRouter, Depends, status
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.db import User
from app.models.admin_automation import (
    AdminAutomationApplyRequest,
    AdminAutomationApplyResponse,
)
from app.routers.dependencies import get_audit_service, get_current_super_admin
from app.services.admin_automation_service import AdminAutomationService, get_admin_automation_service
from app.services.audit_service import AuditService

router = APIRouter(prefix="/admin/automation", tags=["admin-automation"])


def get_service(db: Session = Depends(get_db)) -> AdminAutomationService:
    return get_admin_automation_service(db)


@router.post("/apply", response_model=AdminAutomationApplyResponse)
def apply_admin_automation(
    payload: AdminAutomationApplyRequest,
    current_user: User = Depends(get_current_super_admin),
    audit_service: AuditService = Depends(get_audit_service),
    service: AdminAutomationService = Depends(get_service),
) -> AdminAutomationApplyResponse:
    response = service.apply(payload, current_user=current_user, audit_service=audit_service)
    if not response.success and not payload.continue_on_error:
        return JSONResponse(
            status_code=status.HTTP_400_BAD_REQUEST,
            content=response.model_dump(),
        )
    return response
