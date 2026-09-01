# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import json
from typing import Iterable, Optional
from urllib.parse import urlparse

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import OIDCProviderSettings, Settings, get_settings
from app.db import OidcProvider
from app.models.oidc import (
    OIDC_PROVIDER_DEFAULT_SCOPES,
    OIDC_PROVIDER_ID_PATTERN,
    OIDCProviderAdminItem,
    OIDCProviderAdminPayload,
    OIDCProviderFieldLock,
)
from app.utils.time import utcnow


OIDC_PROVIDER_FIELDS = (
    "provider_id",
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
    "linking_policy",
    "trusted_email_domains",
    "client_secret",
)


class OIDCProviderSettingsError(Exception):
    """Base class for admin OIDC provider settings errors."""


class OIDCProviderAlreadyExistsError(OIDCProviderSettingsError):
    """Raised when a UI-managed provider id is already used."""


class OIDCProviderManagedByEnvironmentError(OIDCProviderSettingsError):
    """Raised when trying to mutate an environment-managed provider."""


class OIDCProviderNotFoundError(OIDCProviderSettingsError):
    """Raised when a UI-managed provider cannot be found."""


def normalize_oidc_provider_id(provider_id: str) -> str:
    normalized = provider_id.strip().lower()
    if not normalized or not OIDC_PROVIDER_ID_PATTERN.fullmatch(normalized):
        raise ValueError("Invalid OIDC provider id")
    return normalized


def _validate_production_payload(payload: OIDCProviderAdminPayload, settings: Optional[Settings] = None) -> None:
    settings = settings or get_settings()
    if settings.app_env != "production" or not payload.enabled:
        return
    discovery = urlparse(payload.discovery_url)
    redirect = urlparse(payload.redirect_uri)
    if discovery.scheme != "https" or not discovery.hostname:
        raise ValueError("OIDC discovery must use HTTPS in production")
    if redirect.scheme != "https" or redirect.netloc != urlparse(settings.public_origin).netloc:
        raise ValueError("OIDC redirect must use PUBLIC_ORIGIN in production")
    if not payload.use_pkce or not payload.use_nonce:
        raise ValueError("OIDC PKCE and nonce are mandatory in production")


def list_effective_oidc_providers(
    db: Session,
    settings: Optional[Settings] = None,
) -> list[OIDCProviderAdminItem]:
    settings = settings or get_settings()
    env_providers = _environment_provider_map(settings)
    items: list[OIDCProviderAdminItem] = [
        _environment_provider_item(provider_id, provider)
        for provider_id, provider in env_providers.items()
    ]
    for provider in _ui_provider_query(db):
        provider_id = provider.provider_id.lower()
        if provider_id in env_providers:
            continue
        items.append(_ui_provider_item(provider))
    return items


def resolve_oidc_provider_map(
    db: Session,
    settings: Optional[Settings] = None,
) -> dict[str, OIDCProviderSettings]:
    settings = settings or get_settings()
    env_providers = _environment_provider_map(settings)
    resolved: dict[str, OIDCProviderSettings] = dict(env_providers)
    for provider in _ui_provider_query(db):
        provider_id = provider.provider_id.lower()
        if provider_id in resolved:
            continue
        resolved[provider_id] = _ui_provider_to_settings(provider)
    return resolved


def create_oidc_provider(db: Session, payload: OIDCProviderAdminPayload) -> OIDCProviderAdminItem:
    _validate_production_payload(payload)
    provider_id = normalize_oidc_provider_id(payload.provider_id)
    if provider_id in _environment_provider_map():
        raise OIDCProviderManagedByEnvironmentError("OIDC provider is managed by environment settings")
    if _get_ui_provider(db, provider_id):
        raise OIDCProviderAlreadyExistsError("OIDC provider already exists")

    provider = OidcProvider(provider_id=provider_id)
    _apply_payload(provider, payload, replace_secret=True)
    db.add(provider)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise OIDCProviderAlreadyExistsError("OIDC provider already exists") from exc
    db.refresh(provider)
    return _ui_provider_item(provider)


def update_oidc_provider(
    db: Session,
    provider_id: str,
    payload: OIDCProviderAdminPayload,
) -> OIDCProviderAdminItem:
    _validate_production_payload(payload)
    normalized_id = normalize_oidc_provider_id(provider_id)
    payload_id = normalize_oidc_provider_id(payload.provider_id)
    if payload_id != normalized_id:
        raise ValueError("provider_id cannot be changed")
    if normalized_id in _environment_provider_map():
        raise OIDCProviderManagedByEnvironmentError("OIDC provider is managed by environment settings")
    provider = _get_ui_provider(db, normalized_id)
    if not provider:
        raise OIDCProviderNotFoundError("OIDC provider not found")

    _apply_payload(provider, payload, replace_secret=False)
    provider.updated_at = utcnow()
    db.commit()
    db.refresh(provider)
    return _ui_provider_item(provider)


def delete_oidc_provider(db: Session, provider_id: str) -> None:
    normalized_id = normalize_oidc_provider_id(provider_id)
    if normalized_id in _environment_provider_map():
        raise OIDCProviderManagedByEnvironmentError("OIDC provider is managed by environment settings")
    provider = _get_ui_provider(db, normalized_id)
    if not provider:
        raise OIDCProviderNotFoundError("OIDC provider not found")
    db.delete(provider)
    db.commit()


def _environment_provider_map(settings: Optional[Settings] = None) -> dict[str, OIDCProviderSettings]:
    settings = settings or get_settings()
    resolved: dict[str, OIDCProviderSettings] = {}
    for raw_id, provider in settings.oidc_providers.items():
        provider_id = str(raw_id or "").strip().lower()
        if provider_id:
            resolved[provider_id] = provider
    return resolved


def _ui_provider_query(db: Session) -> Iterable[OidcProvider]:
    return db.query(OidcProvider).order_by(OidcProvider.provider_id.asc()).all()


def _get_ui_provider(db: Session, provider_id: str) -> Optional[OidcProvider]:
    return db.query(OidcProvider).filter(OidcProvider.provider_id == provider_id).first()


def _apply_payload(provider: OidcProvider, payload: OIDCProviderAdminPayload, *, replace_secret: bool) -> None:
    provider.provider_id = normalize_oidc_provider_id(payload.provider_id)
    provider.display_name = payload.display_name
    provider.discovery_url = payload.discovery_url
    provider.client_id = payload.client_id
    provider.redirect_uri = payload.redirect_uri
    provider.scopes_json = _dump_scopes(payload.scopes)
    provider.prompt = payload.prompt
    provider.enabled = bool(payload.enabled)
    provider.icon_url = payload.icon_url
    provider.use_pkce = bool(payload.use_pkce)
    provider.use_nonce = bool(payload.use_nonce)
    provider.linking_policy = payload.linking_policy
    provider.trusted_email_domains_json = _dump_string_list(payload.trusted_email_domains)
    if payload.clear_client_secret:
        provider.client_secret = None
    elif replace_secret or payload.client_secret is not None:
        provider.client_secret = payload.client_secret


def _ui_provider_to_settings(provider: OidcProvider) -> OIDCProviderSettings:
    return OIDCProviderSettings(
        display_name=provider.display_name,
        discovery_url=provider.discovery_url,
        client_id=provider.client_id,
        client_secret=provider.client_secret,
        redirect_uri=provider.redirect_uri,
        scopes=_load_scopes(provider.scopes_json),
        prompt=provider.prompt,
        enabled=bool(provider.enabled),
        icon_url=provider.icon_url,
        use_pkce=bool(provider.use_pkce),
        use_nonce=bool(provider.use_nonce),
        linking_policy=provider.linking_policy or "manual",
        trusted_email_domains=_load_string_list(provider.trusted_email_domains_json),
    )


def _ui_provider_item(provider: OidcProvider) -> OIDCProviderAdminItem:
    return OIDCProviderAdminItem(
        provider_id=provider.provider_id,
        display_name=provider.display_name,
        discovery_url=provider.discovery_url,
        client_id=provider.client_id,
        redirect_uri=provider.redirect_uri,
        scopes=_load_scopes(provider.scopes_json),
        prompt=provider.prompt,
        enabled=bool(provider.enabled),
        icon_url=provider.icon_url,
        use_pkce=bool(provider.use_pkce),
        use_nonce=bool(provider.use_nonce),
        linking_policy=provider.linking_policy or "manual",
        trusted_email_domains=_load_string_list(provider.trusted_email_domains_json),
        source="ui",
        editable=True,
        has_client_secret=bool(provider.client_secret),
    )


def _environment_provider_item(provider_id: str, provider: OIDCProviderSettings) -> OIDCProviderAdminItem:
    return OIDCProviderAdminItem(
        provider_id=provider_id,
        display_name=provider.display_name,
        discovery_url=provider.discovery_url,
        client_id=provider.client_id,
        redirect_uri=provider.redirect_uri,
        scopes=list(provider.scopes or []),
        prompt=provider.prompt,
        enabled=bool(provider.enabled),
        icon_url=provider.icon_url,
        use_pkce=bool(provider.use_pkce),
        use_nonce=bool(provider.use_nonce),
        linking_policy=provider.linking_policy,
        trusted_email_domains=list(provider.trusted_email_domains or []),
        source="environment",
        editable=False,
        field_locks={
            field: OIDCProviderFieldLock(forced=True, source=_environment_source(provider_id, field))
            for field in OIDC_PROVIDER_FIELDS
        },
        has_client_secret=bool(provider.client_secret),
    )


def _environment_source(provider_id: str, field: str) -> str:
    if field == "provider_id":
        return f"OIDC_PROVIDERS__{provider_id.upper()}"
    return f"OIDC_PROVIDERS__{provider_id.upper()}__{field.upper()}"


def _load_scopes(raw: str) -> list[str]:
    parsed = json.loads(raw)
    if not isinstance(parsed, list) or not parsed:
        raise ValueError("OIDC provider scopes must be a non-empty JSON list")
    if any(not isinstance(item, str) or not item.strip() for item in parsed):
        raise ValueError("OIDC provider scopes must contain non-empty strings")
    return [item.strip() for item in parsed]


def _dump_scopes(scopes: list[str]) -> str:
    normalized = [item.strip() for item in scopes if isinstance(item, str) and item.strip()]
    return json.dumps(normalized or list(OIDC_PROVIDER_DEFAULT_SCOPES), separators=(",", ":"))


def _load_string_list(raw: str) -> list[str]:
    parsed = json.loads(raw or "[]")
    if not isinstance(parsed, list) or any(not isinstance(item, str) for item in parsed):
        raise ValueError("OIDC provider domains must be a JSON list of strings")
    return [item for item in parsed if item]


def _dump_string_list(values: list[str]) -> str:
    return json.dumps(list(values or []), separators=(",", ":"))
