# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from threading import Lock
from typing import Optional

from app.db import S3Connection, StorageProvider
from app.services.rgw_admin import RGWAdminError, get_rgw_admin_client
from app.utils.rgw import is_rgw_account_id
from app.utils.storage_endpoint_features import resolve_feature_flags, resolve_rgw_admin_api_endpoint


@dataclass(frozen=True)
class ConnectionIdentityResolution:
    rgw_user_uid: Optional[str]
    rgw_account_id: Optional[str]
    metrics_enabled: bool
    usage_enabled: bool
    reason: Optional[str] = None

    @property
    def iam_identity(self) -> Optional[str]:
        return self.rgw_user_uid or self.rgw_account_id

    @property
    def eligible(self) -> bool:
        return bool(self.iam_identity) and self.reason is None


@dataclass
class _CacheEntry:
    expires_at: datetime
    value: ConnectionIdentityResolution


_CACHE_TTL_SECONDS = 60
_CACHE: dict[tuple, _CacheEntry] = {}
_CACHE_LOCK = Lock()


def reset_connection_identity_cache() -> None:
    with _CACHE_LOCK:
        _CACHE.clear()


class ConnectionIdentityService:
    def __init__(self, ttl_seconds: int = _CACHE_TTL_SECONDS) -> None:
        self.ttl_seconds = max(1, int(ttl_seconds))

    def resolve_metrics_identity(self, connection: S3Connection) -> ConnectionIdentityResolution:
        key = self._cache_key(connection, scope="metrics")
        cached = self._cache_get(key)
        if cached is not None:
            return cached
        resolved = self._resolve_metrics_uncached(connection)
        self._cache_set(key, resolved)
        return resolved

    def resolve_rgw_identity(self, connection: S3Connection) -> ConnectionIdentityResolution:
        key = self._cache_key(connection, scope="identity")
        cached = self._cache_get(key)
        if cached is not None:
            return cached
        resolved = self._resolve_identity_uncached(connection)
        self._cache_set(key, resolved)
        return resolved

    def _resolve_identity_uncached(self, connection: S3Connection) -> ConnectionIdentityResolution:
        endpoint = getattr(connection, "storage_endpoint", None)
        if connection.storage_endpoint_id is None or endpoint is None:
            return ConnectionIdentityResolution(
                rgw_user_uid=None,
                rgw_account_id=None,
                metrics_enabled=False,
                usage_enabled=False,
                reason="RGW identity is unavailable: this connection must target a configured storage endpoint.",
            )

        provider_value = str(getattr(endpoint, "provider", "")).strip().lower()
        if provider_value != StorageProvider.CEPH.value:
            return ConnectionIdentityResolution(
                rgw_user_uid=None,
                rgw_account_id=None,
                metrics_enabled=False,
                usage_enabled=False,
                reason="RGW identity is unavailable: this connection endpoint is not a Ceph provider.",
            )

        flags = resolve_feature_flags(endpoint)
        metrics_enabled = bool(flags.metrics_enabled)
        usage_enabled = bool(flags.usage_enabled)

        uid, account_id = _identity_from_metadata(
            getattr(connection, "credential_owner_type", None),
            getattr(connection, "credential_owner_identifier", None),
        )
        if uid:
            return ConnectionIdentityResolution(
                rgw_user_uid=uid,
                rgw_account_id=account_id,
                metrics_enabled=metrics_enabled,
                usage_enabled=usage_enabled,
                reason=None,
            )

        access_key = (getattr(connection, "access_key_id", None) or "").strip()
        if not access_key:
            return ConnectionIdentityResolution(
                rgw_user_uid=None,
                rgw_account_id=None,
                metrics_enabled=metrics_enabled,
                usage_enabled=usage_enabled,
                reason="RGW identity is unavailable: connection access key is missing.",
            )

        admin_endpoint = resolve_rgw_admin_api_endpoint(endpoint)
        if not admin_endpoint:
            return ConnectionIdentityResolution(
                rgw_user_uid=None,
                rgw_account_id=None,
                metrics_enabled=metrics_enabled,
                usage_enabled=usage_enabled,
                reason="RGW identity is unavailable: admin endpoint is not configured for this endpoint.",
            )

        lookup_access_key = getattr(endpoint, "supervision_access_key", None) or getattr(endpoint, "admin_access_key", None)
        lookup_secret_key = getattr(endpoint, "supervision_secret_key", None) or getattr(endpoint, "admin_secret_key", None)
        if not lookup_access_key or not lookup_secret_key:
            return ConnectionIdentityResolution(
                rgw_user_uid=None,
                rgw_account_id=None,
                metrics_enabled=metrics_enabled,
                usage_enabled=usage_enabled,
                reason="RGW identity is unavailable: lookup credentials are not configured for this endpoint.",
            )

        try:
            rgw_admin = get_rgw_admin_client(
                access_key=lookup_access_key,
                secret_key=lookup_secret_key,
                endpoint=admin_endpoint,
                region=getattr(endpoint, "region", None),
                verify_tls=bool(getattr(endpoint, "verify_tls", True)),
            )
            payload = rgw_admin.get_user_by_access_key(access_key, allow_not_found=True)
        except RGWAdminError as exc:
            return ConnectionIdentityResolution(
                rgw_user_uid=None,
                rgw_account_id=None,
                metrics_enabled=metrics_enabled,
                usage_enabled=usage_enabled,
                reason=f"RGW identity is unavailable: unable to resolve RGW identity ({exc}).",
            )

        uid, account_id = _identity_from_rgw_payload(payload)
        if not uid:
            return ConnectionIdentityResolution(
                rgw_user_uid=None,
                rgw_account_id=None,
                metrics_enabled=metrics_enabled,
                usage_enabled=usage_enabled,
                reason="RGW identity is unavailable: unable to resolve RGW identity for this connection.",
            )
        return ConnectionIdentityResolution(
            rgw_user_uid=uid,
            rgw_account_id=account_id,
            metrics_enabled=metrics_enabled,
            usage_enabled=usage_enabled,
            reason=None,
        )

    def _resolve_metrics_uncached(self, connection: S3Connection) -> ConnectionIdentityResolution:
        endpoint = getattr(connection, "storage_endpoint", None)
        if connection.storage_endpoint_id is None or endpoint is None:
            return ConnectionIdentityResolution(
                rgw_user_uid=None,
                rgw_account_id=None,
                metrics_enabled=False,
                usage_enabled=False,
                reason="Metrics are unavailable: this connection must target a configured storage endpoint.",
            )

        provider_value = str(getattr(endpoint, "provider", "")).strip().lower()
        if provider_value != StorageProvider.CEPH.value:
            return ConnectionIdentityResolution(
                rgw_user_uid=None,
                rgw_account_id=None,
                metrics_enabled=False,
                usage_enabled=False,
                reason="Metrics are unavailable: this connection endpoint is not a Ceph provider.",
            )

        flags = resolve_feature_flags(endpoint)
        metrics_enabled = bool(flags.metrics_enabled)
        usage_enabled = bool(flags.usage_enabled)
        if not metrics_enabled and not usage_enabled:
            return ConnectionIdentityResolution(
                rgw_user_uid=None,
                rgw_account_id=None,
                metrics_enabled=False,
                usage_enabled=False,
                reason="Metrics are unavailable: storage metrics and usage logs are disabled for this endpoint.",
            )

        supervision_access_key = getattr(endpoint, "supervision_access_key", None)
        supervision_secret_key = getattr(endpoint, "supervision_secret_key", None)
        if not supervision_access_key or not supervision_secret_key:
            return ConnectionIdentityResolution(
                rgw_user_uid=None,
                rgw_account_id=None,
                metrics_enabled=metrics_enabled,
                usage_enabled=usage_enabled,
                reason="Metrics are unavailable: supervision credentials are not configured for this endpoint.",
            )

        identity = self._resolve_identity_uncached(connection)
        if identity.iam_identity:
            return ConnectionIdentityResolution(
                rgw_user_uid=identity.rgw_user_uid,
                rgw_account_id=identity.rgw_account_id,
                metrics_enabled=metrics_enabled,
                usage_enabled=usage_enabled,
                reason=None,
            )
        return ConnectionIdentityResolution(
            rgw_user_uid=None,
            rgw_account_id=None,
            metrics_enabled=metrics_enabled,
            usage_enabled=usage_enabled,
            reason=identity.reason or "Metrics are unavailable: unable to resolve RGW identity for this connection.",
        )

    def _cache_key(self, connection: S3Connection, *, scope: str) -> tuple:
        endpoint = getattr(connection, "storage_endpoint", None)
        endpoint_updated = getattr(endpoint, "updated_at", None)
        connection_updated = getattr(connection, "updated_at", None)
        return (
            scope,
            getattr(connection, "id", None),
            (getattr(connection, "access_key_id", None) or "").strip(),
            getattr(connection, "storage_endpoint_id", None),
            (getattr(connection, "credential_owner_type", None) or "").strip().lower(),
            (getattr(connection, "credential_owner_identifier", None) or "").strip(),
            str(getattr(endpoint, "provider", "")).strip().lower() if endpoint is not None else "",
            bool(getattr(endpoint, "supervision_access_key", None)) if endpoint is not None else False,
            bool(getattr(endpoint, "supervision_secret_key", None)) if endpoint is not None else False,
            (getattr(endpoint, "features_config", None) or "") if endpoint is not None else "",
            (getattr(endpoint, "admin_endpoint", None) or "") if endpoint is not None else "",
            int(connection_updated.timestamp()) if isinstance(connection_updated, datetime) else 0,
            int(endpoint_updated.timestamp()) if isinstance(endpoint_updated, datetime) else 0,
        )

    def _cache_get(self, key: tuple) -> Optional[ConnectionIdentityResolution]:
        now = datetime.now(timezone.utc)
        with _CACHE_LOCK:
            cached = _CACHE.get(key)
            if cached is None:
                return None
            if cached.expires_at <= now:
                _CACHE.pop(key, None)
                return None
            return cached.value

    def _cache_set(self, key: tuple, value: ConnectionIdentityResolution) -> None:
        expires_at = datetime.now(timezone.utc) + timedelta(seconds=self.ttl_seconds)
        with _CACHE_LOCK:
            _CACHE[key] = _CacheEntry(expires_at=expires_at, value=value)


def _normalize_optional_str(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    normalized = value.strip()
    return normalized or None


def _identity_from_metadata(owner_type: Optional[str], owner_identifier: Optional[str]) -> tuple[Optional[str], Optional[str]]:
    type_slug = (_normalize_optional_str(owner_type) or "").lower()
    identifier = _normalize_optional_str(owner_identifier)
    if not identifier:
        return None, None

    if "$" in identifier:
        account_hint = identifier.split("$", 1)[0].strip()
        account_id = account_hint if is_rgw_account_id(account_hint) else None
        return identifier, account_id

    if type_slug == "account_user":
        if ":" in identifier:
            account_id, principal = [part.strip() for part in identifier.split(":", 1)]
            if is_rgw_account_id(account_id) and principal:
                return f"{account_id}${principal}", account_id
        return None, None

    if type_slug == "s3_user":
        candidate = identifier
        if candidate.lower().startswith("iam:"):
            candidate = candidate.split(":", 1)[1].strip()
        if candidate and ":" not in candidate:
            return candidate, None
        return None, None

    if type_slug == "iam_user":
        candidate = identifier
        if candidate.lower().startswith("iam:"):
            candidate = candidate.split(":", 1)[1].strip()
        if ":" in candidate:
            account_id, principal = [part.strip() for part in candidate.split(":", 1)]
            if is_rgw_account_id(account_id) and principal:
                return f"{account_id}${principal}", account_id
        if candidate and ":" not in candidate:
            return candidate, None
        return None, None

    return None, None


def _identity_from_rgw_payload(payload: object) -> tuple[Optional[str], Optional[str]]:
    if not isinstance(payload, dict) or payload.get("not_found"):
        return None, None
    candidates: list[dict] = [payload]
    nested_user = payload.get("user")
    if isinstance(nested_user, dict):
        candidates.append(nested_user)

    uid: Optional[str] = None
    account_id: Optional[str] = None
    for candidate in candidates:
        uid = _normalize_optional_str(
            candidate.get("uid")
            or candidate.get("user_id")
            or (candidate.get("user") if isinstance(candidate.get("user"), str) else None)
        )
        if uid:
            break
    for candidate in candidates:
        account_id = _normalize_optional_str(
            candidate.get("account_id")
            or candidate.get("account")
            or candidate.get("tenant")
        )
        if account_id:
            break
    if uid and "$" in uid and not account_id:
        account_hint = uid.split("$", 1)[0].strip()
        if is_rgw_account_id(account_hint):
            account_id = account_hint
    if not uid and account_id and is_rgw_account_id(account_id):
        return None, account_id
    return uid, account_id
