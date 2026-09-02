# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Portal workspace context and project-settings endpoints."""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.db import PortalAccountRole, User
from app.models.access_context import AccountAccess
from app.models.app_settings import PortalSettingsOverride
from app.models.portal_context import PortalAccount, PortalState
from app.models.portal_settings import PortalProjectSettings
from app.routers.dependencies import (
    get_audit_service,
    get_current_account_user,
    get_portal_account_access,
)
from app.routers.portal_common import get_portal_service_dependency
from app.services.audit_service import AuditService
from app.services.effective_access_service import EffectiveAccessService
from app.services.portal_service import PortalService
from app.utils.http_errors import raise_bad_gateway_from_runtime
from app.utils.storage_endpoint_features import (
    features_to_capabilities,
    normalize_features_config,
)

router = APIRouter()


@router.get("/accounts", response_model=list[PortalAccount])
def list_portal_accounts(
    user: User = Depends(get_current_account_user),
    db: Session = Depends(get_db),
) -> list[PortalAccount]:
    access_service = EffectiveAccessService(db)
    resolved = access_service.resolve_user(user)
    portal_roles = {
        link.account_id: link.portal_role
        for link in resolved.account_links
        if link.portal_role is not None
    }
    accounts = sorted(
        access_service.list_portal_accounts(user, resolved=resolved),
        key=lambda account: (account.name or "").lower(),
    )
    return [
        PortalAccount(
            id=account.id,
            name=account.name,
            rgw_account_id=account.rgw_account_id,
            portal_role=portal_roles[account.id],
            storage_endpoint_name=account.storage_endpoint.name,
            storage_endpoint_url=account.storage_endpoint.endpoint_url,
            storage_endpoint_is_default=bool(account.storage_endpoint.is_default),
            storage_endpoint_capabilities=features_to_capabilities(
                normalize_features_config(
                    account.storage_endpoint.provider,
                    account.storage_endpoint.features_config,
                )
            ),
        )
        for account in accounts
    ]


@router.get("/state", response_model=PortalState)
def portal_state(
    access: AccountAccess = Depends(get_portal_account_access),
    service: PortalService = Depends(get_portal_service_dependency),
) -> PortalState:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    eligible, reasons = service.check_eligibility(actor, access)
    if not eligible:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="; ".join(reasons) or "Portal not available")
    try:
        return service.get_state(access)
    except RuntimeError as exc:
        raise_bad_gateway_from_runtime(exc)


@router.get("/settings", response_model=PortalProjectSettings, response_model_exclude_unset=True)
def get_portal_project_settings(
    access: AccountAccess = Depends(get_portal_account_access),
    service: PortalService = Depends(get_portal_service_dependency),
) -> PortalProjectSettings:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    can_update = bool(
        access.portal_role == PortalAccountRole.PORTAL_MANAGER.value
        and access.account.portal_settings_delegated
    )
    return service.get_portal_project_settings(access.account, can_update=can_update)


@router.put("/settings", response_model=PortalProjectSettings, response_model_exclude_unset=True)
def update_portal_project_settings(
    payload: PortalSettingsOverride,
    access: AccountAccess = Depends(get_portal_account_access),
    audit_service: AuditService = Depends(get_audit_service),
    service: PortalService = Depends(get_portal_service_dependency),
) -> PortalProjectSettings:
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    if access.portal_role != PortalAccountRole.PORTAL_MANAGER.value:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal manager rights required")
    if not access.account.portal_settings_delegated:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal settings delegation is disabled")
    try:
        updated = service.update_admin_portal_settings_override(access.account, payload)
    except RuntimeError as exc:
        raise_bad_gateway_from_runtime(exc)
    audit_service.record_action(
        user=actor,
        scope="portal",
        action="update_project_portal_settings",
        entity_type="account",
        entity_id=str(access.account.id),
        account=access.account,
        metadata={"project_override": payload.model_dump(exclude_unset=True, exclude_none=False)},
    )
    return service.get_portal_project_settings(
        access.account,
        can_update=updated.delegated_to_portal_managers,
    )
