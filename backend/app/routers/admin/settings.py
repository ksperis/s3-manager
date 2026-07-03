# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.db import User
from app.models.app_settings import AppSettings, GeneralFeatureLocks, QuotaNotificationSettings
from app.models.ldap import LDAPProviderAdminItem, LDAPProviderAdminPayload
from app.models.oidc import OIDCProviderAdminItem, OIDCProviderAdminPayload
from app.routers.dependencies import get_audit_logger, get_current_ui_superadmin
from app.routers.http_errors import raise_http_exception_from_exception
from app.services.audit_service import AuditService
from app.services.app_settings_service import (
    get_general_feature_locks,
    load_app_settings,
    load_default_app_settings,
    save_app_settings,
)
from app.services.ldap_provider_settings_service import (
    LDAPProviderAlreadyExistsError,
    LDAPProviderManagedByEnvironmentError,
    LDAPProviderNotFoundError as AdminLDAPProviderNotFoundError,
    create_ldap_provider,
    delete_ldap_provider,
    list_effective_ldap_providers,
    update_ldap_provider,
)
from app.services.oidc_provider_settings_service import (
    OIDCProviderAlreadyExistsError,
    OIDCProviderManagedByEnvironmentError,
    OIDCProviderNotFoundError as AdminOIDCProviderNotFoundError,
    create_oidc_provider,
    delete_oidc_provider,
    list_effective_oidc_providers,
    update_oidc_provider,
)
from app.services.quota_monitoring_service import QuotaMonitoringService

router = APIRouter(prefix="/admin/settings", tags=["admin-settings"])


@router.get("", response_model=AppSettings)
def get_settings(_: None = Depends(get_current_ui_superadmin)) -> AppSettings:
    return load_app_settings()


@router.get("/defaults", response_model=AppSettings)
def get_default_settings(_: None = Depends(get_current_ui_superadmin)) -> AppSettings:
    return load_default_app_settings()


@router.get("/general-feature-locks", response_model=GeneralFeatureLocks)
def get_general_feature_locks_route(_: None = Depends(get_current_ui_superadmin)) -> GeneralFeatureLocks:
    return get_general_feature_locks()


@router.put("", response_model=AppSettings)
def update_settings(
    payload: AppSettings,
    current_user: User = Depends(get_current_ui_superadmin),
    audit: AuditService = Depends(get_audit_logger),
) -> AppSettings:
    saved = save_app_settings(payload)
    audit.record_action(
        user=current_user,
        scope="admin",
        action="settings.update",
        entity_type="app_settings",
        entity_id="global",
        metadata={"sections": sorted(saved.model_dump().keys())},
    )
    return saved


@router.get("/oidc/providers", response_model=list[OIDCProviderAdminItem])
def list_oidc_provider_settings(
    _: User = Depends(get_current_ui_superadmin),
    db: Session = Depends(get_db),
) -> list[OIDCProviderAdminItem]:
    return list_effective_oidc_providers(db)


@router.post("/oidc/providers", response_model=OIDCProviderAdminItem, status_code=status.HTTP_201_CREATED)
def create_oidc_provider_settings(
    payload: OIDCProviderAdminPayload,
    current_user: User = Depends(get_current_ui_superadmin),
    db: Session = Depends(get_db),
    audit: AuditService = Depends(get_audit_logger),
) -> OIDCProviderAdminItem:
    try:
        item = create_oidc_provider(db, payload)
    except OIDCProviderManagedByEnvironmentError as exc:
        raise_http_exception_from_exception(status.HTTP_409_CONFLICT, exc)
    except OIDCProviderAlreadyExistsError as exc:
        raise_http_exception_from_exception(status.HTTP_409_CONFLICT, exc)
    except ValueError as exc:
        raise_http_exception_from_exception(status.HTTP_400_BAD_REQUEST, exc)

    audit.record_action(
        user=current_user,
        scope="admin",
        action="oidc_provider.create",
        entity_type="oidc_provider",
        entity_id=item.provider_id,
        metadata=_oidc_audit_metadata(payload, secret_action="set" if payload.client_secret else "none"),
    )
    return item


@router.put("/oidc/providers/{provider_id}", response_model=OIDCProviderAdminItem)
def update_oidc_provider_settings(
    provider_id: str,
    payload: OIDCProviderAdminPayload,
    current_user: User = Depends(get_current_ui_superadmin),
    db: Session = Depends(get_db),
    audit: AuditService = Depends(get_audit_logger),
) -> OIDCProviderAdminItem:
    try:
        item = update_oidc_provider(db, provider_id, payload)
    except OIDCProviderManagedByEnvironmentError as exc:
        raise_http_exception_from_exception(status.HTTP_409_CONFLICT, exc)
    except AdminOIDCProviderNotFoundError as exc:
        raise_http_exception_from_exception(status.HTTP_404_NOT_FOUND, exc)
    except ValueError as exc:
        raise_http_exception_from_exception(status.HTTP_400_BAD_REQUEST, exc)

    audit.record_action(
        user=current_user,
        scope="admin",
        action="oidc_provider.update",
        entity_type="oidc_provider",
        entity_id=item.provider_id,
        metadata=_oidc_audit_metadata(payload, secret_action=_secret_update_action(payload)),
    )
    return item


@router.delete("/oidc/providers/{provider_id}")
def delete_oidc_provider_settings(
    provider_id: str,
    current_user: User = Depends(get_current_ui_superadmin),
    db: Session = Depends(get_db),
    audit: AuditService = Depends(get_audit_logger),
) -> dict[str, str]:
    try:
        delete_oidc_provider(db, provider_id)
    except OIDCProviderManagedByEnvironmentError as exc:
        raise_http_exception_from_exception(status.HTTP_409_CONFLICT, exc)
    except AdminOIDCProviderNotFoundError as exc:
        raise_http_exception_from_exception(status.HTTP_404_NOT_FOUND, exc)
    except ValueError as exc:
        raise_http_exception_from_exception(status.HTTP_400_BAD_REQUEST, exc)

    audit.record_action(
        user=current_user,
        scope="admin",
        action="oidc_provider.delete",
        entity_type="oidc_provider",
        entity_id=provider_id.lower(),
        metadata={"provider_id": provider_id.lower()},
    )
    return {"status": "deleted"}


@router.get("/ldap/providers", response_model=list[LDAPProviderAdminItem])
def list_ldap_provider_settings(
    _: User = Depends(get_current_ui_superadmin),
    db: Session = Depends(get_db),
) -> list[LDAPProviderAdminItem]:
    return list_effective_ldap_providers(db)


@router.post("/ldap/providers", response_model=LDAPProviderAdminItem, status_code=status.HTTP_201_CREATED)
def create_ldap_provider_settings(
    payload: LDAPProviderAdminPayload,
    current_user: User = Depends(get_current_ui_superadmin),
    db: Session = Depends(get_db),
    audit: AuditService = Depends(get_audit_logger),
) -> LDAPProviderAdminItem:
    try:
        item = create_ldap_provider(db, payload)
    except LDAPProviderManagedByEnvironmentError as exc:
        raise_http_exception_from_exception(status.HTTP_409_CONFLICT, exc)
    except LDAPProviderAlreadyExistsError as exc:
        raise_http_exception_from_exception(status.HTTP_409_CONFLICT, exc)
    except ValueError as exc:
        raise_http_exception_from_exception(status.HTTP_400_BAD_REQUEST, exc)

    audit.record_action(
        user=current_user,
        scope="admin",
        action="ldap_provider.create",
        entity_type="ldap_provider",
        entity_id=item.provider_id,
        metadata=_ldap_audit_metadata(payload, secret_action="set" if payload.bind_password else "none"),
    )
    return item


@router.put("/ldap/providers/{provider_id}", response_model=LDAPProviderAdminItem)
def update_ldap_provider_settings(
    provider_id: str,
    payload: LDAPProviderAdminPayload,
    current_user: User = Depends(get_current_ui_superadmin),
    db: Session = Depends(get_db),
    audit: AuditService = Depends(get_audit_logger),
) -> LDAPProviderAdminItem:
    try:
        item = update_ldap_provider(db, provider_id, payload)
    except LDAPProviderManagedByEnvironmentError as exc:
        raise_http_exception_from_exception(status.HTTP_409_CONFLICT, exc)
    except AdminLDAPProviderNotFoundError as exc:
        raise_http_exception_from_exception(status.HTTP_404_NOT_FOUND, exc)
    except ValueError as exc:
        raise_http_exception_from_exception(status.HTTP_400_BAD_REQUEST, exc)

    audit.record_action(
        user=current_user,
        scope="admin",
        action="ldap_provider.update",
        entity_type="ldap_provider",
        entity_id=item.provider_id,
        metadata=_ldap_audit_metadata(payload, secret_action=_bind_password_update_action(payload)),
    )
    return item


@router.delete("/ldap/providers/{provider_id}")
def delete_ldap_provider_settings(
    provider_id: str,
    current_user: User = Depends(get_current_ui_superadmin),
    db: Session = Depends(get_db),
    audit: AuditService = Depends(get_audit_logger),
) -> dict[str, str]:
    try:
        delete_ldap_provider(db, provider_id)
    except LDAPProviderManagedByEnvironmentError as exc:
        raise_http_exception_from_exception(status.HTTP_409_CONFLICT, exc)
    except AdminLDAPProviderNotFoundError as exc:
        raise_http_exception_from_exception(status.HTTP_404_NOT_FOUND, exc)
    except ValueError as exc:
        raise_http_exception_from_exception(status.HTTP_400_BAD_REQUEST, exc)

    audit.record_action(
        user=current_user,
        scope="admin",
        action="ldap_provider.delete",
        entity_type="ldap_provider",
        entity_id=provider_id.lower(),
        metadata={"provider_id": provider_id.lower()},
    )
    return {"status": "deleted"}


@router.post("/quota-notifications/test-email")
def send_quota_notifications_test_email(
    payload: QuotaNotificationSettings,
    current_user: User = Depends(get_current_ui_superadmin),
    db: Session = Depends(get_db),
) -> dict:
    service = QuotaMonitoringService(db)
    try:
        return service.send_test_email(
            notification_settings=payload,
            recipient_email=current_user.email,
        )
    except ValueError as exc:
        raise_http_exception_from_exception(status.HTTP_400_BAD_REQUEST, exc)


def _secret_update_action(payload: OIDCProviderAdminPayload) -> str:
    if payload.clear_client_secret:
        return "cleared"
    if payload.client_secret:
        return "replaced"
    return "preserved"


def _oidc_audit_metadata(payload: OIDCProviderAdminPayload, *, secret_action: str) -> dict:
    return {
        "provider_id": payload.provider_id,
        "fields": [
            "display_name",
            "discovery_url",
            "client_id",
            "redirect_uri",
            "scopes",
            "prompt",
            "enabled",
            "icon_url",
            "use_pkce",
            "use_nonce",
        ],
        "enabled": payload.enabled,
        "client_secret_action": secret_action,
    }


def _bind_password_update_action(payload: LDAPProviderAdminPayload) -> str:
    if payload.clear_bind_password:
        return "cleared"
    if payload.bind_password:
        return "replaced"
    return "preserved"


def _ldap_audit_metadata(payload: LDAPProviderAdminPayload, *, secret_action: str) -> dict:
    return {
        "provider_id": payload.provider_id,
        "fields": [
            "display_name",
            "url",
            "bind_dn",
            "user_base_dn",
            "user_filter",
            "email_attribute",
            "name_attribute",
            "subject_attribute",
            "start_tls",
            "tls_verify",
            "tls_ca_file",
            "timeout_seconds",
            "enabled",
            "allow_insecure",
            "allow_email_linking",
        ],
        "enabled": payload.enabled,
        "bind_password_action": secret_action,
    }
