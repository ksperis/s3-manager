# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import re
from typing import Literal, Optional
from urllib.parse import urlparse

from pydantic import BaseModel, Field, field_validator, model_validator

LDAP_USERNAME_MAX_LENGTH = 256
LDAP_PASSWORD_MAX_LENGTH = 1024
LDAP_PROVIDER_ID_PATTERN = re.compile(r"^[a-z0-9_-]+$")
LDAP_PROVIDER_DEFAULT_USER_FILTER = "(|(mail={username})(uid={username})(sAMAccountName={username})(userPrincipalName={username}))"


class LDAPProviderInfo(BaseModel):
    id: str
    display_name: str


class LDAPLoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=LDAP_USERNAME_MAX_LENGTH)
    password: str = Field(min_length=1, max_length=LDAP_PASSWORD_MAX_LENGTH)

    @field_validator("username", mode="before")
    @classmethod
    def normalize_username(cls, value):
        if not isinstance(value, str):
            raise ValueError("username must be a string")
        normalized = value.strip()
        if not normalized:
            raise ValueError("username cannot be empty")
        return normalized


class LDAPProviderFieldLock(BaseModel):
    forced: bool = False
    source: Optional[str] = None


class LDAPProviderAdminItem(BaseModel):
    provider_id: str
    display_name: str
    url: str
    bind_dn: str
    user_base_dn: str
    user_filter: str = LDAP_PROVIDER_DEFAULT_USER_FILTER
    email_attribute: str = "mail"
    name_attribute: Optional[str] = "displayName"
    subject_attribute: Optional[str] = None
    start_tls: bool = False
    tls_verify: bool = True
    tls_ca_file: Optional[str] = None
    timeout_seconds: float = 5.0
    enabled: bool = True
    allow_insecure: bool = False
    allow_email_linking: bool = False
    source: Literal["environment", "ui"]
    editable: bool
    field_locks: dict[str, LDAPProviderFieldLock] = Field(default_factory=dict)
    has_bind_password: bool = False


class LDAPProviderAdminPayload(BaseModel):
    provider_id: str
    display_name: str
    url: str
    bind_dn: str
    bind_password: Optional[str] = None
    user_base_dn: str
    user_filter: str = LDAP_PROVIDER_DEFAULT_USER_FILTER
    email_attribute: str = "mail"
    name_attribute: Optional[str] = "displayName"
    subject_attribute: Optional[str] = None
    start_tls: bool = False
    tls_verify: bool = True
    tls_ca_file: Optional[str] = None
    timeout_seconds: float = Field(5.0, gt=0, le=60)
    enabled: bool = True
    allow_insecure: bool = False
    allow_email_linking: bool = False
    clear_bind_password: bool = False

    @field_validator("provider_id", mode="before")
    @classmethod
    def normalize_provider_id(cls, value: str) -> str:
        if not isinstance(value, str):
            raise ValueError("provider_id must be a string")
        normalized = value.strip().lower()
        if not normalized:
            raise ValueError("provider_id is required")
        if not LDAP_PROVIDER_ID_PATTERN.fullmatch(normalized):
            raise ValueError("provider_id may contain only lowercase letters, numbers, underscores, and hyphens")
        return normalized

    @field_validator(
        "display_name",
        "url",
        "bind_dn",
        "user_base_dn",
        "user_filter",
        "email_attribute",
        mode="before",
    )
    @classmethod
    def normalize_required_strings(cls, value: str) -> str:
        if not isinstance(value, str):
            raise ValueError("LDAP provider fields must be strings")
        normalized = value.strip()
        if not normalized:
            raise ValueError("LDAP provider fields cannot be empty")
        return normalized

    @field_validator("bind_password", "name_attribute", "subject_attribute", "tls_ca_file", mode="before")
    @classmethod
    def normalize_optional_strings(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        if not isinstance(value, str):
            raise ValueError("LDAP provider fields must be strings")
        normalized = value.strip()
        return normalized or None

    @field_validator("url")
    @classmethod
    def validate_url(cls, value: str) -> str:
        parsed = urlparse(value)
        if parsed.scheme not in {"ldap", "ldaps"} or not parsed.hostname:
            raise ValueError("LDAP provider url must be an ldap:// or ldaps:// URL")
        return value

    @field_validator("user_filter")
    @classmethod
    def validate_user_filter(cls, value: str) -> str:
        if "{username}" not in value:
            raise ValueError("LDAP provider user_filter must contain {username}")
        return value

    @model_validator(mode="after")
    def validate_transport(self):
        parsed = urlparse(self.url)
        if parsed.scheme == "ldaps" and self.start_tls:
            raise ValueError("LDAP provider start_tls cannot be used with ldaps:// URLs")
        if parsed.scheme == "ldap" and not self.start_tls and not self.allow_insecure:
            raise ValueError("LDAP provider requires LDAPS or START_TLS unless allow_insecure=true")
        return self
