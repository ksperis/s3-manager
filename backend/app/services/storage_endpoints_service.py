# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import json
import logging
from typing import Optional
from urllib.parse import urlparse

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db_models import StorageEndpoint, StorageProvider, S3Account, S3User
from app.models.storage_endpoint import (
    StorageEndpoint as StorageEndpointSchema,
    StorageEndpointCreate,
    StorageEndpointUpdate,
)

logger = logging.getLogger(__name__)
settings = get_settings()

DEFAULT_ENDPOINT_CAPABILITIES: dict[str, bool] = {
    "sts": True,
    "static_website": True,
}


def normalize_capabilities(value: Optional[object]) -> dict[str, bool]:
    if value is None:
        data: dict[str, object] = {}
    elif isinstance(value, dict):
        data = value
    elif isinstance(value, str):
        try:
            raw = json.loads(value)
        except json.JSONDecodeError:
            raw = {}
        data = raw if isinstance(raw, dict) else {}
    else:
        data = {}
    normalized: dict[str, bool] = {}
    for key, raw_value in data.items():
        if isinstance(raw_value, bool):
            normalized[str(key)] = raw_value
    for key, default in DEFAULT_ENDPOINT_CAPABILITIES.items():
        normalized.setdefault(key, default)
    return normalized


class StorageEndpointsService:
    def __init__(self, db: Session) -> None:
        self.db = db

    def _normalize_url(self, value: Optional[str]) -> Optional[str]:
        if not value:
            return None
        return value.strip().rstrip("/")

    def _clean_optional(self, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        value = value.strip()
        return value or None

    def _normalize_name(self, value: Optional[str], fallback: str = "Endpoint") -> str:
        normalized = (value or fallback).strip()
        return normalized or fallback

    def _normalize_provider(self, provider: Optional[StorageProvider]) -> StorageProvider:
        if provider is None:
            return StorageProvider.CEPH
        if isinstance(provider, StorageProvider):
            return provider
        # Fallback in case a string sneaks in
        try:
            return StorageProvider(provider)
        except Exception:
            return StorageProvider.CEPH

    def _serialize(self, endpoint: StorageEndpoint) -> StorageEndpointSchema:
        return StorageEndpointSchema(
            id=endpoint.id,
            name=endpoint.name,
            endpoint_url=endpoint.endpoint_url,
            admin_endpoint=endpoint.admin_endpoint,
            region=endpoint.region,
            provider=self._normalize_provider(endpoint.provider),
            admin_access_key=endpoint.admin_access_key,
            supervision_access_key=endpoint.supervision_access_key,
            capabilities=normalize_capabilities(endpoint.capabilities),
            is_default=bool(endpoint.is_default),
            is_editable=bool(endpoint.is_editable),
            created_at=endpoint.created_at,
            updated_at=endpoint.updated_at,
            has_admin_secret=bool(endpoint.admin_secret_key),
            has_supervision_secret=bool(endpoint.supervision_secret_key),
        )

    def _ensure_unique_name(self, name: str, exclude_id: Optional[int] = None) -> None:
        query = self.db.query(StorageEndpoint).filter(StorageEndpoint.name == name)
        if exclude_id:
            query = query.filter(StorageEndpoint.id != exclude_id)
        if query.first():
            raise ValueError("Un endpoint avec ce nom existe déjà.")

    def _ensure_unique_endpoint(self, endpoint_url: str, exclude_id: Optional[int] = None) -> None:
        query = self.db.query(StorageEndpoint).filter(StorageEndpoint.endpoint_url == endpoint_url)
        if exclude_id:
            query = query.filter(StorageEndpoint.id != exclude_id)
        if query.first():
            raise ValueError("Un endpoint avec cette URL existe déjà.")

    def _validate_credentials(
        self,
        provider: StorageProvider,
        admin_access_key: Optional[str],
        admin_secret_key: Optional[str],
        supervision_access_key: Optional[str],
        supervision_secret_key: Optional[str],
    ) -> tuple[Optional[str], Optional[str], Optional[str], Optional[str]]:
        if provider == StorageProvider.CEPH:
            if not admin_access_key or not admin_secret_key:
                raise ValueError("Les endpoints Ceph nécessitent une access key et une secret key d'admin.")
            return admin_access_key, admin_secret_key, supervision_access_key, supervision_secret_key
        # Provider is not Ceph: clear admin/supervision credentials
        return None, None, None, None

    def list_endpoints(self) -> list[StorageEndpointSchema]:
        endpoints = (
            self.db.query(StorageEndpoint)
            .order_by(StorageEndpoint.is_default.desc(), StorageEndpoint.name.asc())
            .all()
        )
        return [self._serialize(ep) for ep in endpoints]

    def get_endpoint(self, endpoint_id: int) -> StorageEndpointSchema:
        endpoint = self.db.query(StorageEndpoint).filter(StorageEndpoint.id == endpoint_id).first()
        if not endpoint:
            raise ValueError("Endpoint introuvable")
        return self._serialize(endpoint)

    def create_endpoint(self, payload: StorageEndpointCreate) -> StorageEndpointSchema:
        name = self._normalize_name(payload.name, fallback="Endpoint")
        endpoint_url = self._normalize_url(payload.endpoint_url)
        admin_endpoint = self._normalize_url(payload.admin_endpoint) or endpoint_url
        region = self._clean_optional(payload.region)
        provider = self._normalize_provider(payload.provider)
        admin_access = self._clean_optional(payload.admin_access_key)
        admin_secret = self._clean_optional(payload.admin_secret_key)
        supervision_access = self._clean_optional(payload.supervision_access_key)
        supervision_secret = self._clean_optional(payload.supervision_secret_key)
        capabilities = normalize_capabilities(payload.capabilities)

        if not endpoint_url:
            raise ValueError("L'URL de l'endpoint est requise.")
        self._ensure_unique_name(name)
        self._ensure_unique_endpoint(endpoint_url)
        admin_access, admin_secret, supervision_access, supervision_secret = self._validate_credentials(
            provider,
            admin_access,
            admin_secret,
            supervision_access,
            supervision_secret,
        )

        entry = StorageEndpoint(
            name=name,
            endpoint_url=endpoint_url,
            admin_endpoint=admin_endpoint,
            region=region,
            provider=provider.value,
            admin_access_key=admin_access,
            admin_secret_key=admin_secret,
            supervision_access_key=supervision_access,
            supervision_secret_key=supervision_secret,
            capabilities=capabilities,
            is_default=False,
            is_editable=True,
        )
        self.db.add(entry)
        self.db.commit()
        self.db.refresh(entry)
        return self._serialize(entry)

    def update_endpoint(self, endpoint_id: int, payload: StorageEndpointUpdate) -> StorageEndpointSchema:
        endpoint = self.db.query(StorageEndpoint).filter(StorageEndpoint.id == endpoint_id).first()
        if not endpoint:
            raise ValueError("Endpoint introuvable")
        if not endpoint.is_editable or endpoint.is_default:
            raise ValueError("Cet endpoint est protégé et ne peut pas être modifié.")

        name = self._normalize_name(payload.name, fallback=endpoint.name) if payload.name is not None else endpoint.name
        endpoint_url = self._normalize_url(payload.endpoint_url) if payload.endpoint_url is not None else endpoint.endpoint_url
        admin_endpoint = (
            self._normalize_url(payload.admin_endpoint)
            if payload.admin_endpoint is not None
            else endpoint.admin_endpoint or endpoint_url
        )
        region = self._clean_optional(payload.region) if payload.region is not None else endpoint.region
        provider = self._normalize_provider(payload.provider or endpoint.provider)
        admin_access = (
            self._clean_optional(payload.admin_access_key)
            if payload.admin_access_key is not None
            else endpoint.admin_access_key
        )
        admin_secret = (
            self._clean_optional(payload.admin_secret_key)
            if payload.admin_secret_key is not None
            else endpoint.admin_secret_key
        )
        supervision_access = (
            self._clean_optional(payload.supervision_access_key)
            if payload.supervision_access_key is not None
            else endpoint.supervision_access_key
        )
        supervision_secret = (
            self._clean_optional(payload.supervision_secret_key)
            if payload.supervision_secret_key is not None
            else endpoint.supervision_secret_key
        )
        capabilities_input = payload.capabilities if payload.capabilities is not None else endpoint.capabilities
        capabilities = normalize_capabilities(capabilities_input)

        if not endpoint_url:
            raise ValueError("L'URL de l'endpoint est requise.")

        self._ensure_unique_name(name, exclude_id=endpoint.id)
        self._ensure_unique_endpoint(endpoint_url, exclude_id=endpoint.id)

        admin_access, admin_secret, supervision_access, supervision_secret = self._validate_credentials(
            provider,
            admin_access,
            admin_secret,
            supervision_access,
            supervision_secret,
        )

        endpoint.name = name
        endpoint.endpoint_url = endpoint_url
        endpoint.admin_endpoint = admin_endpoint or endpoint_url
        endpoint.region = region
        endpoint.provider = provider.value
        endpoint.admin_access_key = admin_access
        endpoint.admin_secret_key = admin_secret
        endpoint.supervision_access_key = supervision_access
        endpoint.supervision_secret_key = supervision_secret
        endpoint.capabilities = capabilities
        self.db.add(endpoint)
        self.db.commit()
        self.db.refresh(endpoint)
        return self._serialize(endpoint)

    def delete_endpoint(self, endpoint_id: int) -> None:
        endpoint = self.db.query(StorageEndpoint).filter(StorageEndpoint.id == endpoint_id).first()
        if not endpoint:
            raise ValueError("Endpoint introuvable")
        if endpoint.is_default or not endpoint.is_editable:
            raise ValueError("Cet endpoint est protégé et ne peut pas être supprimé.")
        linked_accounts = self.db.query(S3Account).filter(S3Account.storage_endpoint_id == endpoint.id).count()
        linked_users = self.db.query(S3User).filter(S3User.storage_endpoint_id == endpoint.id).count()
        if linked_accounts or linked_users:
            raise ValueError(
                f"Impossible de supprimer cet endpoint : {linked_accounts} account(s) et {linked_users} user(s) y sont liés."
            )
        self.db.delete(endpoint)
        self.db.commit()

    def _env_endpoint_name(self) -> str:
        base = settings.app_name or "s3-manager"
        candidate = f"{base} (env)"
        if not self.db.query(StorageEndpoint).filter(StorageEndpoint.name == candidate).first():
            return candidate
        parsed = urlparse(settings.s3_endpoint)
        host = parsed.hostname or parsed.netloc or "endpoint"
        fallback = f"{base} ({host})"
        if not self.db.query(StorageEndpoint).filter(StorageEndpoint.name == fallback).first():
            return fallback
        suffix = self.db.query(StorageEndpoint).count() + 1
        return f"{candidate}-{suffix}"

    def ensure_default_endpoint(self) -> StorageEndpointSchema:
        endpoint_url = self._normalize_url(settings.s3_endpoint)
        admin_endpoint = self._normalize_url(settings.rgw_admin_endpoint) or endpoint_url
        region = settings.s3_region
        admin_access = settings.rgw_admin_access_key or settings.s3_access_key
        admin_secret = settings.rgw_admin_secret_key or settings.s3_secret_key
        supervision_access = settings.supervision_access_key
        supervision_secret = settings.supervision_secret_key
        provider = (
            StorageProvider.CEPH if admin_access and admin_secret else StorageProvider.OTHER
        )
        capabilities = normalize_capabilities(None)

        existing = (
            self.db.query(StorageEndpoint)
            .filter(
                or_(
                    StorageEndpoint.is_default.is_(True),
                    StorageEndpoint.endpoint_url == endpoint_url,
                )
            )
            .first()
        )

        name = self._env_endpoint_name()
        if existing:
            updated = False
            desired_name = name if existing.is_default else existing.name
            if existing.name != desired_name:
                existing.name = desired_name
                updated = True
            desired_admin_endpoint = admin_endpoint or endpoint_url
            if existing.endpoint_url != endpoint_url:
                existing.endpoint_url = endpoint_url
                updated = True
            if existing.admin_endpoint != desired_admin_endpoint:
                existing.admin_endpoint = desired_admin_endpoint
                updated = True
            if existing.region != region:
                existing.region = region
                updated = True
            if existing.provider != provider.value:
                existing.provider = provider.value
                updated = True
            if existing.admin_access_key != admin_access:
                existing.admin_access_key = admin_access
                updated = True
            if existing.admin_secret_key != admin_secret:
                existing.admin_secret_key = admin_secret
                updated = True
            if existing.supervision_access_key != supervision_access:
                existing.supervision_access_key = supervision_access
                updated = True
            if existing.supervision_secret_key != supervision_secret:
                existing.supervision_secret_key = supervision_secret
                updated = True
            if normalize_capabilities(existing.capabilities) != capabilities:
                existing.capabilities = capabilities
                updated = True
            if not existing.is_default:
                existing.is_default = True
                updated = True
            if existing.is_editable:
                existing.is_editable = False
                updated = True
            if updated:
                self.db.add(existing)
                self.db.commit()
                self.db.refresh(existing)
            return self._serialize(existing)

        entry = StorageEndpoint(
            name=name,
            endpoint_url=endpoint_url,
            admin_endpoint=admin_endpoint or endpoint_url,
            region=region,
            provider=provider.value,
            admin_access_key=admin_access,
            admin_secret_key=admin_secret,
            supervision_access_key=supervision_access,
            supervision_secret_key=supervision_secret,
            capabilities=capabilities,
            is_default=True,
            is_editable=False,
        )
        self.db.add(entry)
        self.db.commit()
        self.db.refresh(entry)
        return self._serialize(entry)


def get_storage_endpoints_service(db: Session) -> StorageEndpointsService:
    return StorageEndpointsService(db)
