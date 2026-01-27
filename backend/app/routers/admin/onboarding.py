# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.onboarding import OnboardingStatus
from app.routers.dependencies import get_current_super_admin
from app.services.app_settings_service import load_app_settings, save_app_settings
from app.services.storage_endpoints_service import get_storage_endpoints_service
from app.utils.onboarding import seed_login_active

router = APIRouter(prefix="/admin/onboarding", tags=["admin-onboarding"])


def _build_status(db: Session) -> OnboardingStatus:
    settings = load_app_settings()
    seed_user_configured = not seed_login_active(db)
    endpoint_configured = bool(get_storage_endpoints_service(db).list_endpoints())
    can_dismiss = seed_user_configured and endpoint_configured
    return OnboardingStatus(
        dismissed=bool(settings.onboarding.dismissed),
        can_dismiss=can_dismiss,
        seed_user_configured=seed_user_configured,
        endpoint_configured=endpoint_configured,
    )


@router.get("", response_model=OnboardingStatus)
def get_onboarding_status(
    db: Session = Depends(get_db),
    _: None = Depends(get_current_super_admin),
) -> OnboardingStatus:
    return _build_status(db)


@router.post("/dismiss", response_model=OnboardingStatus)
def dismiss_onboarding(
    db: Session = Depends(get_db),
    _: None = Depends(get_current_super_admin),
) -> OnboardingStatus:
    status = _build_status(db)
    if not status.can_dismiss:
        raise HTTPException(
            status_code=400,
            detail="Complete the base setup steps before dismissing onboarding.",
        )
    settings = load_app_settings()
    settings.onboarding.dismissed = True
    save_app_settings(settings)
    return _build_status(db)

