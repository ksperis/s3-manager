# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import re
from typing import Literal, Optional

from pydantic import Field, field_validator

from app.models.base import ApiModel


OIDC_PROVIDER_ID_PATTERN = re.compile(r"^[a-z0-9_-]+$")
OIDC_PROVIDER_DEFAULT_SCOPES = ["openid", "email", "profile"]


def normalize_trusted_email_domains(value) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        items = value.replace("\n", ",").split(",")
    elif isinstance(value, list):
        items = value
    else:
        raise ValueError("trusted_email_domains must be a list or comma-separated string")
    normalized: list[str] = []
    for item in items:
        domain = str(item or "").strip().lower().lstrip("@")
        if not domain:
            continue
        if len(domain) > 253 or "." not in domain or not re.fullmatch(r"[a-z0-9.-]+", domain):
            raise ValueError("trusted_email_domains must contain exact DNS domains")
        if domain not in normalized:
            normalized.append(domain)
    return normalized


class OIDCProviderInfo(ApiModel):
    id: str
    display_name: str
    icon_url: Optional[str] = None


class OIDCStartRequest(ApiModel):
    redirect_path: Optional[str] = None


class OIDCStartResponse(ApiModel):
    provider: str
    authorization_url: str
    state: str


class OIDCCallbackRequest(ApiModel):
    code: str
    state: str


class OIDCProviderFieldLock(ApiModel):
    forced: bool = False
    source: Optional[str] = None


class OIDCProviderAdminItem(ApiModel):
    provider_id: str
    display_name: str
    discovery_url: str
    client_id: str
    redirect_uri: str
    scopes: list[str] = Field(default_factory=lambda: list(OIDC_PROVIDER_DEFAULT_SCOPES))
    prompt: Optional[str] = None
    enabled: bool = True
    icon_url: Optional[str] = None
    use_pkce: bool = True
    use_nonce: bool = True
    linking_policy: Literal["manual", "trusted_email"] = "manual"
    trusted_email_domains: list[str] = Field(default_factory=list)
    source: Literal["environment", "ui"]
    editable: bool
    field_locks: dict[str, OIDCProviderFieldLock] = Field(default_factory=dict)
    has_client_secret: bool = False


class OIDCProviderAdminPayload(ApiModel):
    provider_id: str
    display_name: str
    discovery_url: str
    client_id: str
    redirect_uri: str
    scopes: list[str] = Field(default_factory=lambda: list(OIDC_PROVIDER_DEFAULT_SCOPES))
    prompt: Optional[str] = None
    enabled: bool = True
    icon_url: Optional[str] = None
    use_pkce: bool = True
    use_nonce: bool = True
    linking_policy: Literal["manual", "trusted_email"] = "manual"
    trusted_email_domains: list[str] = Field(default_factory=list)
    client_secret: Optional[str] = None
    clear_client_secret: bool = False

    @field_validator("provider_id", mode="before")
    @classmethod
    def normalize_provider_id(cls, value: str) -> str:
        if not isinstance(value, str):
            raise ValueError("provider_id must be a string")
        normalized = value.strip().lower()
        if not normalized:
            raise ValueError("provider_id is required")
        if not OIDC_PROVIDER_ID_PATTERN.fullmatch(normalized):
            raise ValueError("provider_id may contain only lowercase letters, numbers, underscores, and hyphens")
        return normalized

    @field_validator("display_name", "discovery_url", "client_id", "redirect_uri", mode="before")
    @classmethod
    def normalize_required_strings(cls, value: str) -> str:
        if not isinstance(value, str):
            raise ValueError("OIDC provider fields must be strings")
        normalized = value.strip()
        if not normalized:
            raise ValueError("OIDC provider fields cannot be empty")
        return normalized

    @field_validator("prompt", "icon_url", "client_secret", mode="before")
    @classmethod
    def normalize_optional_strings(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        if not isinstance(value, str):
            raise ValueError("OIDC provider fields must be strings")
        normalized = value.strip()
        return normalized or None

    @field_validator("scopes", mode="before")
    @classmethod
    def normalize_scopes(cls, value) -> list[str]:
        if value is None:
            return list(OIDC_PROVIDER_DEFAULT_SCOPES)
        if isinstance(value, str):
            normalized = [item.strip() for item in value.replace("\n", ",").split(",") if item.strip()]
            return normalized or list(OIDC_PROVIDER_DEFAULT_SCOPES)
        if isinstance(value, list):
            normalized = [item.strip() for item in value if isinstance(item, str) and item.strip()]
            return normalized or list(OIDC_PROVIDER_DEFAULT_SCOPES)
        raise ValueError("scopes must be a list or comma-separated string")

    @field_validator("trusted_email_domains", mode="before")
    @classmethod
    def normalize_domains(cls, value) -> list[str]:
        return normalize_trusted_email_domains(value)
