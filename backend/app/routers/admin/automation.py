# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from fastapi import APIRouter, Depends, status
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session
from app.models.admin_automation import (
    AdminAutomationApplyRequest,
    AdminAutomationApplyResponse,
    AccountLinkApplyRequest,
    S3AccountApplyRequest,
    S3ConnectionApplyRequest,
    S3UserApplyRequest,
    StorageEndpointApplyRequest,
    UiUserApplyRequest,
)
from app.core.database import get_db
from app.routers.dependencies import get_audit_logger, get_current_super_admin
from app.services.admin_automation_service import AdminAutomationService, get_admin_automation_service
from app.services.audit_service import AuditService

router = APIRouter(prefix="/admin/automation", tags=["admin-automation"])


def get_service(db: Session = Depends(get_db)) -> AdminAutomationService:
    return get_admin_automation_service(db)


@router.post("/apply", response_model=AdminAutomationApplyResponse)
def apply_admin_automation(
    payload: AdminAutomationApplyRequest,
    current_user=Depends(get_current_super_admin),
    audit_service: AuditService = Depends(get_audit_logger),
    service: AdminAutomationService = Depends(get_service),
) -> AdminAutomationApplyResponse:
    return _apply_request(payload, current_user, audit_service, service)


def _apply_request(
    payload: AdminAutomationApplyRequest,
    current_user,
    audit_service: AuditService,
    service: AdminAutomationService,
) -> AdminAutomationApplyResponse:
    response = service.apply(payload, current_user=current_user, audit_service=audit_service)
    if not response.success and not payload.continue_on_error:
        return JSONResponse(
            status_code=status.HTTP_400_BAD_REQUEST,
            content=response.model_dump(),
        )
    return response


@router.post("/storage-endpoints/apply", response_model=AdminAutomationApplyResponse)
def apply_storage_endpoint(
    payload: StorageEndpointApplyRequest,
    current_user=Depends(get_current_super_admin),
    audit_service: AuditService = Depends(get_audit_logger),
    service: AdminAutomationService = Depends(get_service),
) -> AdminAutomationApplyResponse:
    request = AdminAutomationApplyRequest(
        dry_run=payload.dry_run,
        continue_on_error=payload.continue_on_error,
        storage_endpoints=[payload.item],
    )
    return _apply_request(request, current_user, audit_service, service)


@router.post("/ui-users/apply", response_model=AdminAutomationApplyResponse)
def apply_ui_user(
    payload: UiUserApplyRequest,
    current_user=Depends(get_current_super_admin),
    audit_service: AuditService = Depends(get_audit_logger),
    service: AdminAutomationService = Depends(get_service),
) -> AdminAutomationApplyResponse:
    request = AdminAutomationApplyRequest(
        dry_run=payload.dry_run,
        continue_on_error=payload.continue_on_error,
        ui_users=[payload.item],
    )
    return _apply_request(request, current_user, audit_service, service)


@router.post("/s3-accounts/apply", response_model=AdminAutomationApplyResponse)
def apply_s3_account(
    payload: S3AccountApplyRequest,
    current_user=Depends(get_current_super_admin),
    audit_service: AuditService = Depends(get_audit_logger),
    service: AdminAutomationService = Depends(get_service),
) -> AdminAutomationApplyResponse:
    request = AdminAutomationApplyRequest(
        dry_run=payload.dry_run,
        continue_on_error=payload.continue_on_error,
        s3_accounts=[payload.item],
    )
    return _apply_request(request, current_user, audit_service, service)


@router.post("/s3-users/apply", response_model=AdminAutomationApplyResponse)
def apply_s3_user(
    payload: S3UserApplyRequest,
    current_user=Depends(get_current_super_admin),
    audit_service: AuditService = Depends(get_audit_logger),
    service: AdminAutomationService = Depends(get_service),
) -> AdminAutomationApplyResponse:
    request = AdminAutomationApplyRequest(
        dry_run=payload.dry_run,
        continue_on_error=payload.continue_on_error,
        s3_users=[payload.item],
    )
    return _apply_request(request, current_user, audit_service, service)


@router.post("/account-links/apply", response_model=AdminAutomationApplyResponse)
def apply_account_link(
    payload: AccountLinkApplyRequest,
    current_user=Depends(get_current_super_admin),
    audit_service: AuditService = Depends(get_audit_logger),
    service: AdminAutomationService = Depends(get_service),
) -> AdminAutomationApplyResponse:
    request = AdminAutomationApplyRequest(
        dry_run=payload.dry_run,
        continue_on_error=payload.continue_on_error,
        account_links=[payload.item],
    )
    return _apply_request(request, current_user, audit_service, service)


@router.post("/s3-connections/apply", response_model=AdminAutomationApplyResponse)
def apply_s3_connection(
    payload: S3ConnectionApplyRequest,
    current_user=Depends(get_current_super_admin),
    audit_service: AuditService = Depends(get_audit_logger),
    service: AdminAutomationService = Depends(get_service),
) -> AdminAutomationApplyResponse:
    request = AdminAutomationApplyRequest(
        dry_run=payload.dry_run,
        continue_on_error=payload.continue_on_error,
        s3_connections=[payload.item],
    )
    return _apply_request(request, current_user, audit_service, service)
