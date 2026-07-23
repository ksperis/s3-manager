# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Iterable, Optional

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import LDAPProviderSettings, Settings, get_settings
from app.db import LdapProvider
from app.models.ldap import (
    LDAP_PROVIDER_ID_PATTERN,
    LDAPProviderAdminItem,
    LDAPProviderAdminPayload,
    LDAPProviderFieldLock,
)
from app.utils.time import utcnow


LDAP_PROVIDER_FIELDS = (
    "provider_id",
    "display_name",
    "url",
    "bind_dn",
    "bind_password",
    "user_base_dn",
    "user_filter",
    "email_attribute",
    "name_attribute",
    "subject_attribute",
    "start_tls",
    "tls_verify",
    "tls_ca_file",
    "allow_legacy_tls",
    "timeout_seconds",
    "enabled",
    "allow_insecure",
    "allow_email_linking",
)


class LDAPProviderSettingsError(Exception):
    """Base class for admin LDAP provider settings errors."""


class LDAPProviderAlreadyExistsError(LDAPProviderSettingsError):
    """Raised when a UI-managed provider id is already used."""


class LDAPProviderManagedByEnvironmentError(LDAPProviderSettingsError):
    """Raised when trying to mutate an environment-managed provider."""


class LDAPProviderNotFoundError(LDAPProviderSettingsError):
    """Raised when a UI-managed provider cannot be found."""


def normalize_ldap_provider_id(provider_id: str) -> str:
    normalized = provider_id.strip().lower()
    if not normalized or not LDAP_PROVIDER_ID_PATTERN.fullmatch(normalized):
        raise ValueError("Invalid LDAP provider id")
    return normalized


def list_effective_ldap_providers(
    db: Session,
    settings: Optional[Settings] = None,
) -> list[LDAPProviderAdminItem]:
    settings = settings or get_settings()
    env_providers = _environment_provider_map(settings)
    items: list[LDAPProviderAdminItem] = [
        _environment_provider_item(provider_id, provider)
        for provider_id, provider in env_providers.items()
    ]
    for provider in _ui_provider_query(db):
        provider_id = provider.provider_id.lower()
        if provider_id in env_providers:
            continue
        items.append(_ui_provider_item(provider))
    return items


def resolve_ldap_provider_map(
    db: Session,
    settings: Optional[Settings] = None,
) -> dict[str, LDAPProviderSettings]:
    settings = settings or get_settings()
    env_providers = _environment_provider_map(settings)
    resolved: dict[str, LDAPProviderSettings] = dict(env_providers)
    for provider in _ui_provider_query(db):
        provider_id = provider.provider_id.lower()
        if provider_id in resolved:
            continue
        resolved[provider_id] = _ui_provider_to_settings(provider)
    return resolved


def create_ldap_provider(db: Session, payload: LDAPProviderAdminPayload) -> LDAPProviderAdminItem:
    provider_id = normalize_ldap_provider_id(payload.provider_id)
    if provider_id in _environment_provider_map():
        raise LDAPProviderManagedByEnvironmentError("LDAP provider is managed by environment settings")
    if _get_ui_provider(db, provider_id):
        raise LDAPProviderAlreadyExistsError("LDAP provider already exists")
    provider = LdapProvider(provider_id=provider_id)
    _apply_payload(provider, payload, replace_secret=True)
    db.add(provider)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise LDAPProviderAlreadyExistsError("LDAP provider already exists") from exc
    db.refresh(provider)
    return _ui_provider_item(provider)


def update_ldap_provider(
    db: Session,
    provider_id: str,
    payload: LDAPProviderAdminPayload,
) -> LDAPProviderAdminItem:
    normalized_id = normalize_ldap_provider_id(provider_id)
    payload_id = normalize_ldap_provider_id(payload.provider_id)
    if payload_id != normalized_id:
        raise ValueError("provider_id cannot be changed")
    if normalized_id in _environment_provider_map():
        raise LDAPProviderManagedByEnvironmentError("LDAP provider is managed by environment settings")
    provider = _get_ui_provider(db, normalized_id)
    if not provider:
        raise LDAPProviderNotFoundError("LDAP provider not found")

    _apply_payload(provider, payload, replace_secret=False)
    provider.updated_at = utcnow()
    db.commit()
    db.refresh(provider)
    return _ui_provider_item(provider)


def delete_ldap_provider(db: Session, provider_id: str) -> None:
    normalized_id = normalize_ldap_provider_id(provider_id)
    if normalized_id in _environment_provider_map():
        raise LDAPProviderManagedByEnvironmentError("LDAP provider is managed by environment settings")
    provider = _get_ui_provider(db, normalized_id)
    if not provider:
        raise LDAPProviderNotFoundError("LDAP provider not found")
    db.delete(provider)
    db.commit()


def _environment_provider_map(settings: Optional[Settings] = None) -> dict[str, LDAPProviderSettings]:
    settings = settings or get_settings()
    resolved: dict[str, LDAPProviderSettings] = {}
    for raw_id, provider in settings.ldap_providers.items():
        provider_id = str(raw_id or "").strip().lower()
        if provider_id:
            resolved[provider_id] = provider
    return resolved


def _ui_provider_query(db: Session) -> Iterable[LdapProvider]:
    return db.query(LdapProvider).order_by(LdapProvider.provider_id.asc()).all()


def _get_ui_provider(db: Session, provider_id: str) -> Optional[LdapProvider]:
    return db.query(LdapProvider).filter(LdapProvider.provider_id == provider_id).first()


def _apply_payload(provider: LdapProvider, payload: LDAPProviderAdminPayload, *, replace_secret: bool) -> None:
    if payload.bind_dn is None:
        candidate_secret = None
    elif payload.clear_bind_password:
        candidate_secret = None
    elif payload.bind_password is not None:
        candidate_secret = payload.bind_password
    else:
        candidate_secret = provider.bind_password
    LDAPProviderSettings(
        display_name=payload.display_name,
        url=payload.url,
        bind_dn=payload.bind_dn,
        bind_password=candidate_secret,
        user_base_dn=payload.user_base_dn,
        user_filter=payload.user_filter,
        email_attribute=payload.email_attribute,
        name_attribute=payload.name_attribute,
        subject_attribute=payload.subject_attribute,
        start_tls=payload.start_tls,
        tls_verify=payload.tls_verify,
        tls_ca_file=payload.tls_ca_file,
        allow_legacy_tls=payload.allow_legacy_tls,
        timeout_seconds=payload.timeout_seconds,
        enabled=payload.enabled,
        allow_insecure=payload.allow_insecure,
        allow_email_linking=payload.allow_email_linking,
    )

    provider.provider_id = normalize_ldap_provider_id(payload.provider_id)
    provider.display_name = payload.display_name
    provider.url = payload.url
    provider.bind_dn = payload.bind_dn
    provider.user_base_dn = payload.user_base_dn
    provider.user_filter = payload.user_filter
    provider.email_attribute = payload.email_attribute
    provider.name_attribute = payload.name_attribute
    provider.subject_attribute = payload.subject_attribute
    provider.start_tls = bool(payload.start_tls)
    provider.tls_verify = bool(payload.tls_verify)
    provider.tls_ca_file = payload.tls_ca_file
    provider.allow_legacy_tls = bool(payload.allow_legacy_tls)
    provider.timeout_seconds = float(payload.timeout_seconds)
    provider.enabled = bool(payload.enabled)
    provider.allow_insecure = bool(payload.allow_insecure)
    provider.allow_email_linking = bool(payload.allow_email_linking)
    if replace_secret or payload.bind_password is not None or payload.bind_dn is None or payload.clear_bind_password:
        provider.bind_password = candidate_secret


def _ui_provider_to_settings(provider: LdapProvider) -> LDAPProviderSettings:
    return LDAPProviderSettings(
        display_name=provider.display_name,
        url=provider.url,
        bind_dn=provider.bind_dn,
        bind_password=provider.bind_password,
        user_base_dn=provider.user_base_dn,
        user_filter=provider.user_filter,
        email_attribute=provider.email_attribute,
        name_attribute=provider.name_attribute,
        subject_attribute=provider.subject_attribute,
        start_tls=bool(provider.start_tls),
        tls_verify=bool(provider.tls_verify),
        tls_ca_file=provider.tls_ca_file,
        allow_legacy_tls=bool(provider.allow_legacy_tls),
        timeout_seconds=provider.timeout_seconds,
        enabled=bool(provider.enabled),
        allow_insecure=bool(provider.allow_insecure),
        allow_email_linking=bool(provider.allow_email_linking),
    )


def _ui_provider_item(provider: LdapProvider) -> LDAPProviderAdminItem:
    return LDAPProviderAdminItem(
        provider_id=provider.provider_id,
        display_name=provider.display_name,
        url=provider.url,
        bind_dn=provider.bind_dn,
        user_base_dn=provider.user_base_dn,
        user_filter=provider.user_filter,
        email_attribute=provider.email_attribute,
        name_attribute=provider.name_attribute,
        subject_attribute=provider.subject_attribute,
        start_tls=bool(provider.start_tls),
        tls_verify=bool(provider.tls_verify),
        tls_ca_file=provider.tls_ca_file,
        allow_legacy_tls=bool(provider.allow_legacy_tls),
        timeout_seconds=provider.timeout_seconds,
        enabled=bool(provider.enabled),
        allow_insecure=bool(provider.allow_insecure),
        allow_email_linking=bool(provider.allow_email_linking),
        source="ui",
        editable=True,
        has_bind_password=bool(provider.bind_password),
    )


def _environment_provider_item(provider_id: str, provider: LDAPProviderSettings) -> LDAPProviderAdminItem:
    return LDAPProviderAdminItem(
        provider_id=provider_id,
        display_name=provider.display_name,
        url=provider.url,
        bind_dn=provider.bind_dn,
        user_base_dn=provider.user_base_dn,
        user_filter=provider.user_filter,
        email_attribute=provider.email_attribute,
        name_attribute=provider.name_attribute,
        subject_attribute=provider.subject_attribute,
        start_tls=bool(provider.start_tls),
        tls_verify=bool(provider.tls_verify),
        tls_ca_file=provider.tls_ca_file,
        allow_legacy_tls=bool(provider.allow_legacy_tls),
        timeout_seconds=provider.timeout_seconds,
        enabled=bool(provider.enabled),
        allow_insecure=bool(provider.allow_insecure),
        allow_email_linking=bool(provider.allow_email_linking),
        source="environment",
        editable=False,
        field_locks={
            field: LDAPProviderFieldLock(forced=True, source=_environment_source(provider_id, field))
            for field in LDAP_PROVIDER_FIELDS
        },
        has_bind_password=bool(provider.bind_password),
    )


def _environment_source(provider_id: str, field: str) -> str:
    if field == "provider_id":
        return f"LDAP_PROVIDERS__{provider_id.upper()}"
    return f"LDAP_PROVIDERS__{provider_id.upper()}__{field.upper()}"
