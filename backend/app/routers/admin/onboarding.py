# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.db import S3Account, S3Connection, User
from app.models.onboarding import OnboardingStatus
from app.routers.dependencies import get_audit_service, get_current_super_admin
from app.services.audit_service import AuditService
from app.services.app_settings_service import load_app_settings, save_app_settings
from app.services.storage_endpoints_service import get_storage_endpoints_service

router = APIRouter(prefix="/admin/onboarding", tags=["admin-onboarding"])


def _build_status(db: Session) -> OnboardingStatus:
    settings = load_app_settings()
    endpoint_configured = bool(get_storage_endpoints_service(db).list_endpoints())
    storage_access_configured = bool(
        db.query(S3Account.id).first()
        or db.query(S3Connection.id)
        .filter(S3Connection.is_active.is_(True))
        .first()
    )
    return OnboardingStatus(
        dismissed=bool(settings.onboarding.dismissed),
        complete=endpoint_configured and storage_access_configured,
        endpoint_configured=endpoint_configured,
        storage_access_configured=storage_access_configured,
    )


@router.get("", response_model=OnboardingStatus)
def get_onboarding_status(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_super_admin),
) -> OnboardingStatus:
    return _build_status(db)


@router.post("/dismiss", response_model=OnboardingStatus)
def dismiss_onboarding(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_super_admin),
    audit_service: AuditService = Depends(get_audit_service),
) -> OnboardingStatus:
    status = _build_status(db)
    settings = load_app_settings()
    settings.onboarding.dismissed = True
    save_app_settings(settings)
    audit_service.record_action(
        user=current_user,
        scope="admin",
        action="onboarding.dismiss",
        entity_type="onboarding",
        entity_id="global",
        metadata={
            "endpoint_configured": status.endpoint_configured,
            "storage_access_configured": status.storage_access_configured,
            "complete": status.complete,
        },
    )
    return _build_status(db)
