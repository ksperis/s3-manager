# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from dataclasses import dataclass
import hashlib
import logging
import math
import ssl
from struct import error as StructError
from typing import Any, Optional
from urllib.parse import urlparse

from email_validator import EmailNotValidError, validate_email
from ldap3 import NONE, SUBTREE, Connection, Server, Tls
from ldap3.core.exceptions import LDAPExceptionError
from ldap3.utils.conv import escape_filter_chars
from sqlalchemy.orm import Session

from app.core.config import LDAPProviderSettings, Settings, get_settings
from app.db import User
from app.services.external_identity_user_service import ExternalIdentityLinkRequiredError
from app.services.ldap_provider_settings_service import resolve_ldap_provider_map
from app.services.users_service import UsersService, get_users_service

LOGGER = logging.getLogger(__name__)
LDAP_INVALID_CREDENTIALS_RESULT = 49
LDAP_LEGACY_TLS_CIPHERS = "DEFAULT"


class LDAPError(Exception):
    """Base class for LDAP authentication exceptions."""


class LDAPProviderNotFoundError(LDAPError):
    """Raised when a configured LDAP provider is missing or disabled."""


class LDAPConfigurationError(LDAPError):
    """Raised when provider configuration or directory connectivity is invalid."""


class LDAPAuthenticationError(LDAPError):
    """Raised when LDAP rejects the submitted username/password."""


class LDAPUserConflictError(LDAPError):
    """Raised when a valid LDAP identity cannot be linked to a local UI user."""


@dataclass(frozen=True)
class LDAPIdentity:
    provider: str
    subject: str
    dn: str
    email: Optional[str] = None
    full_name: Optional[str] = None


class LDAPAuthService:
    def __init__(
        self,
        db: Session,
        users_service: UsersService,
        settings: Optional[Settings] = None,
    ) -> None:
        self.db = db
        self.users_service = users_service
        self.settings = settings or get_settings()

    def list_providers(self) -> list[dict[str, str]]:
        providers = []
        for key, provider in self._provider_map().items():
            if provider.enabled:
                providers.append({"id": key, "display_name": provider.display_name})
        return providers

    def authenticate(self, provider_id: str, username: str, password: str) -> tuple[User, bool]:
        normalized_username = str(username or "").strip()
        if not normalized_username or not password:
            raise LDAPAuthenticationError("Invalid credentials")
        provider_key, provider = self._get_provider(provider_id)
        identity = self._authenticate_directory(provider_key, provider, normalized_username, password)
        try:
            user, created = self.users_service.get_or_create_ldap_user(
                provider=provider_key,
                subject=identity.subject,
                email=identity.email,
                full_name=identity.full_name,
            )
        except ExternalIdentityLinkRequiredError:
            raise
        except ValueError as exc:
            raise LDAPUserConflictError(str(exc)) from exc
        if not user.is_active:
            raise LDAPUserConflictError("User is inactive")
        user = self.users_service.mark_last_login(user)
        return user, created

    def _provider_map(self) -> dict[str, LDAPProviderSettings]:
        return resolve_ldap_provider_map(self.db, self.settings)

    def _get_provider(self, provider_id: str) -> tuple[str, LDAPProviderSettings]:
        provider_key = provider_id.lower()
        provider = self._provider_map().get(provider_key)
        if not provider or not provider.enabled:
            raise LDAPProviderNotFoundError("LDAP provider not found")
        return provider_key, provider

    def _authenticate_directory(
        self,
        provider_key: str,
        provider: LDAPProviderSettings,
        username: str,
        password: str,
    ) -> LDAPIdentity:
        service_connection = self._bind_connection(
            provider,
            user=provider.bind_dn,
            password=provider.bind_password,
            invalid_credentials_as_auth=False,
        )
        try:
            identity = self._search_identity(provider_key, provider, service_connection, username)
        finally:
            self._unbind(service_connection)

        user_connection = self._bind_connection(
            provider,
            user=identity.dn,
            password=password,
            invalid_credentials_as_auth=True,
        )
        self._unbind(user_connection)
        return identity

    def _bind_connection(
        self,
        provider: LDAPProviderSettings,
        *,
        user: Optional[str],
        password: Optional[str],
        invalid_credentials_as_auth: bool,
    ) -> Connection:
        server = self._build_server(provider)
        connection = Connection(
            server,
            user=user,
            password=password,
            auto_bind=False,
            auto_referrals=False,
            raise_exceptions=False,
            read_only=True,
            receive_timeout=max(1, math.ceil(provider.timeout_seconds)),
        )
        try:
            if provider.start_tls:
                connection.open()
                if not connection.start_tls():
                    raise LDAPConfigurationError("Unable to start TLS with LDAP provider")
            if not connection.bind():
                result = connection.result or {}
                code = result.get("result")
                if invalid_credentials_as_auth and code == LDAP_INVALID_CREDENTIALS_RESULT:
                    raise LDAPAuthenticationError("Invalid credentials")
                if invalid_credentials_as_auth:
                    raise LDAPAuthenticationError("Invalid credentials")
                detail = result.get("description") or "bind failed"
                bind_kind = "service" if user else "anonymous"
                raise LDAPConfigurationError(f"LDAP {bind_kind} bind failed: {detail}")
        except LDAPAuthenticationError:
            self._unbind(connection)
            raise
        except LDAPConfigurationError:
            self._unbind(connection)
            raise
        except (LDAPExceptionError, OSError, StructError) as exc:
            self._unbind(connection)
            if invalid_credentials_as_auth:
                raise LDAPAuthenticationError("Invalid credentials") from exc
            raise LDAPConfigurationError("Unable to bind to LDAP provider") from exc
        return connection

    def _build_server(self, provider: LDAPProviderSettings) -> Server:
        parsed = urlparse(provider.url)
        use_ssl = parsed.scheme == "ldaps"
        port = parsed.port or (636 if use_ssl else 389)
        tls = Tls(
            validate=ssl.CERT_REQUIRED if provider.tls_verify else ssl.CERT_NONE,
            ca_certs_file=provider.tls_ca_file,
            ciphers=LDAP_LEGACY_TLS_CIPHERS if provider.allow_legacy_tls else None,
            sni=parsed.hostname,
        )
        return Server(
            parsed.hostname or "",
            port=port,
            use_ssl=use_ssl,
            tls=tls,
            get_info=NONE,
            connect_timeout=provider.timeout_seconds,
        )

    def _search_identity(
        self,
        provider_key: str,
        provider: LDAPProviderSettings,
        connection: Connection,
        username: str,
    ) -> LDAPIdentity:
        search_filter = self._build_search_filter(provider, username)
        attributes = self._requested_attributes(provider)
        try:
            search_ok = connection.search(
                search_base=provider.user_base_dn,
                search_filter=search_filter,
                search_scope=SUBTREE,
                attributes=attributes,
                size_limit=2,
            )
        except (KeyError, ValueError) as exc:
            raise LDAPConfigurationError("LDAP user_filter is invalid") from exc
        except LDAPExceptionError as exc:
            raise LDAPConfigurationError("LDAP user search failed") from exc
        if not search_ok:
            result = connection.result or {}
            detail = result.get("description") or "search failed"
            raise LDAPConfigurationError(f"LDAP user search failed: {detail}")

        entries = list(getattr(connection, "entries", []) or [])
        if len(entries) != 1:
            raise LDAPAuthenticationError("Invalid credentials")
        entry = entries[0]
        user_dn = str(getattr(entry, "entry_dn", "") or "").strip()
        if not user_dn:
            raise LDAPConfigurationError("LDAP user entry is missing a DN")

        email = self._normalize_email(self._entry_value(entry, provider.email_attribute))
        full_name = self._entry_value(entry, provider.name_attribute) if provider.name_attribute else None
        subject = (
            self._entry_value(entry, provider.subject_attribute)
            if provider.subject_attribute
            else user_dn.lower()
        )
        if not subject:
            raise LDAPConfigurationError("LDAP user entry is missing the configured subject attribute")
        return LDAPIdentity(
            provider=provider_key,
            subject=subject,
            dn=user_dn,
            email=email,
            full_name=full_name,
        )

    def _build_search_filter(self, provider: LDAPProviderSettings, username: str) -> str:
        escaped_username = escape_filter_chars(str(username or "").strip())
        try:
            return provider.user_filter.format(username=escaped_username)
        except (KeyError, ValueError) as exc:
            raise LDAPConfigurationError("LDAP user_filter is invalid") from exc

    def _requested_attributes(self, provider: LDAPProviderSettings) -> list[str]:
        attributes = {
            provider.email_attribute,
            provider.name_attribute,
            provider.subject_attribute,
        }
        return sorted(attr for attr in attributes if attr)

    @staticmethod
    def _entry_value(entry: Any, attribute: Optional[str]) -> Optional[str]:
        if not attribute:
            return None
        values_by_attr = getattr(entry, "entry_attributes_as_dict", None)
        if isinstance(values_by_attr, dict):
            for key, value in values_by_attr.items():
                if str(key).lower() != attribute.lower():
                    continue
                return LDAPAuthService._coerce_attribute_value(value)
        try:
            return LDAPAuthService._coerce_attribute_value(entry[attribute].value)
        except Exception:
            return None

    @staticmethod
    def _coerce_attribute_value(value: Any) -> Optional[str]:
        if isinstance(value, (list, tuple)):
            if not value:
                return None
            value = value[0]
        if value is None:
            return None
        text = str(value).strip()
        return text or None

    @staticmethod
    def _normalize_email(value: Optional[str]) -> Optional[str]:
        if not value:
            return None
        normalized = value.strip()
        if not normalized:
            return None
        try:
            validated = validate_email(normalized, check_deliverability=False)
        except EmailNotValidError as exc:
            raise LDAPConfigurationError("LDAP user entry contains an invalid email address") from exc
        return validated.normalized.lower()

    @staticmethod
    def generated_email(provider: str, subject: str) -> str:
        digest = hashlib.sha256(f"{provider}:{subject}".encode()).hexdigest()[:16]
        return f"ldap-{provider}-{digest}@ldap.local"

    @staticmethod
    def _unbind(connection: Connection) -> None:
        try:
            connection.unbind()
        except Exception:
            LOGGER.debug("Ignoring LDAP unbind failure", exc_info=True)


def get_ldap_auth_service(db: Session) -> LDAPAuthService:
    return LDAPAuthService(db, users_service=get_users_service(db))
