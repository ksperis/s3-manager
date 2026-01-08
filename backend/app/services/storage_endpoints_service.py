# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import logging
from typing import Optional

from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db_models import StorageEndpoint, StorageProvider, S3Account, S3User
from app.models.storage_endpoint import (
    StorageEndpoint as StorageEndpointSchema,
    StorageEndpointCreate,
    StorageEndpointUpdate,
)
from app.utils.s3_endpoint import configured_s3_endpoint
from app.utils.storage_endpoint_features import (
    dump_features_config,
    features_to_capabilities,
    normalize_features_config,
)

logger = logging.getLogger(__name__)
settings = get_settings()


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

    def _normalize_features(
        self,
        provider: StorageProvider,
        raw: Optional[str],
    ) -> tuple[dict[str, dict[str, object]], str]:
        features = normalize_features_config(provider, raw)
        return features, dump_features_config(features)

    def _serialize(self, endpoint: StorageEndpoint) -> StorageEndpointSchema:
        provider = self._normalize_provider(endpoint.provider)
        features, _ = self._normalize_features(provider, endpoint.features_config)
        capabilities = features_to_capabilities(features)
        allowed_packages = endpoint.allowed_packages
        if isinstance(allowed_packages, list):
            cleaned_packages = [str(p).strip() for p in allowed_packages if isinstance(p, str) and p.strip()]
            allowed_packages = sorted(set(cleaned_packages)) or None
        else:
            allowed_packages = None
        return StorageEndpointSchema(
            id=endpoint.id,
            name=endpoint.name,
            endpoint_url=endpoint.endpoint_url,
            admin_endpoint=features.get("admin", {}).get("endpoint"),
            region=endpoint.region,
            provider=provider,
            admin_access_key=endpoint.admin_access_key,
            supervision_access_key=endpoint.supervision_access_key,
            capabilities=capabilities,
            presign_enabled=bool(getattr(endpoint, "presign_enabled", True)),
            allow_external_access=bool(getattr(endpoint, "allow_external_access", False)),
            max_session_duration=int(getattr(endpoint, "max_session_duration", 3600) or 3600),
            allowed_packages=allowed_packages,
            is_default=bool(endpoint.is_default),
            is_editable=bool(endpoint.is_editable),
            created_at=endpoint.created_at,
            updated_at=endpoint.updated_at,
            has_admin_secret=bool(endpoint.admin_secret_key),
            has_supervision_secret=bool(endpoint.supervision_secret_key),
            features_config=endpoint.features_config,
            features=features,
        )

    def _ensure_unique_name(self, name: str, exclude_id: Optional[int] = None) -> None:
        query = self.db.query(StorageEndpoint).filter(StorageEndpoint.name == name)
        if exclude_id:
            query = query.filter(StorageEndpoint.id != exclude_id)
        if query.first():
            raise ValueError("An endpoint with this name already exists.")

    def _ensure_unique_endpoint(self, endpoint_url: str, exclude_id: Optional[int] = None) -> None:
        query = self.db.query(StorageEndpoint).filter(StorageEndpoint.endpoint_url == endpoint_url)
        if exclude_id:
            query = query.filter(StorageEndpoint.id != exclude_id)
        if query.first():
            raise ValueError("An endpoint with this URL already exists.")

    def _validate_credentials(
        self,
        provider: StorageProvider,
        admin_access_key: Optional[str],
        admin_secret_key: Optional[str],
        supervision_access_key: Optional[str],
        supervision_secret_key: Optional[str],
        admin_enabled: bool,
        supervision_required: bool,
    ) -> tuple[Optional[str], Optional[str], Optional[str], Optional[str]]:
        if provider == StorageProvider.CEPH:
            if admin_enabled and (not admin_access_key or not admin_secret_key):
                raise ValueError("Ceph endpoints with admin enabled require an admin access key and secret key.")
            if supervision_required and (not supervision_access_key or not supervision_secret_key):
                raise ValueError(
                    "Ceph endpoints with usage or metrics enabled require a supervision access key and secret key."
                )
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

    def get_default_endpoint_url(self) -> Optional[str]:
        endpoint = (
            self.db.query(StorageEndpoint)
            .order_by(StorageEndpoint.is_default.desc(), StorageEndpoint.name.asc())
            .first()
        )
        if endpoint and endpoint.endpoint_url:
            return self._normalize_url(endpoint.endpoint_url)
        return configured_s3_endpoint()

    def get_endpoint(self, endpoint_id: int) -> StorageEndpointSchema:
        endpoint = self.db.query(StorageEndpoint).filter(StorageEndpoint.id == endpoint_id).first()
        if not endpoint:
            raise ValueError("Endpoint not found.")
        return self._serialize(endpoint)

    def create_endpoint(self, payload: StorageEndpointCreate) -> StorageEndpointSchema:
        name = self._normalize_name(payload.name, fallback="Endpoint")
        endpoint_url = self._normalize_url(payload.endpoint_url)
        region = self._clean_optional(payload.region)
        provider = self._normalize_provider(payload.provider)
        admin_access = self._clean_optional(payload.admin_access_key)
        admin_secret = self._clean_optional(payload.admin_secret_key)
        supervision_access = self._clean_optional(payload.supervision_access_key)
        supervision_secret = self._clean_optional(payload.supervision_secret_key)
        features, features_config = self._normalize_features(provider, payload.features_config)
        capabilities = features_to_capabilities(features)
        admin_endpoint = features.get("admin", {}).get("endpoint")
        presign_enabled = bool(getattr(payload, "presign_enabled", True))
        allow_external_access = bool(getattr(payload, "allow_external_access", False))
        max_session_duration = int(getattr(payload, "max_session_duration", 3600) or 3600)
        allowed_packages = getattr(payload, "allowed_packages", None)
        if isinstance(allowed_packages, list):
            allowed_packages = [str(p).strip() for p in allowed_packages if isinstance(p, str) and p.strip()] or None
        else:
            allowed_packages = None

        if not endpoint_url:
            raise ValueError("Endpoint URL is required.")
        self._ensure_unique_name(name)
        self._ensure_unique_endpoint(endpoint_url)
        admin_access, admin_secret, supervision_access, supervision_secret = self._validate_credentials(
            provider,
            admin_access,
            admin_secret,
            supervision_access,
            supervision_secret,
            bool(features.get("admin", {}).get("enabled")),
            bool(features.get("usage", {}).get("enabled")) or bool(features.get("metrics", {}).get("enabled")),
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
            features_config=features_config,
            presign_enabled=presign_enabled,
            allow_external_access=allow_external_access,
            max_session_duration=max_session_duration,
            allowed_packages=allowed_packages,
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
            raise ValueError("Endpoint not found.")

        fields_set = getattr(payload, "model_fields_set", None)
        if fields_set is None:
            fields_set = getattr(payload, "__pydantic_fields_set__", set())

        if not endpoint.is_editable:
            allowed_fields = {
                "features_config",
                "presign_enabled",
                "allow_external_access",
                "max_session_duration",
                "allowed_packages",
            }
            unexpected = sorted([field for field in fields_set if field not in allowed_fields])
            if unexpected:
                raise ValueError(
                    "This endpoint is protected; only portal settings can be edited "
                    f"({', '.join(sorted(allowed_fields))})."
                )

            provider = self._normalize_provider(endpoint.provider)
            raw_features = payload.features_config if payload.features_config is not None else endpoint.features_config
            features, features_config = self._normalize_features(provider, raw_features)
            capabilities = features_to_capabilities(features)
            endpoint.admin_endpoint = features.get("admin", {}).get("endpoint")
            endpoint.features_config = features_config
            endpoint.capabilities = capabilities
            if "presign_enabled" in fields_set:
                endpoint.presign_enabled = bool(payload.presign_enabled)
            if "allow_external_access" in fields_set:
                endpoint.allow_external_access = bool(payload.allow_external_access)
            if "max_session_duration" in fields_set and payload.max_session_duration is not None:
                endpoint.max_session_duration = int(payload.max_session_duration)
            if "allowed_packages" in fields_set:
                normalized_packages = payload.allowed_packages or []
                endpoint.allowed_packages = (
                    [str(p).strip() for p in normalized_packages if isinstance(p, str) and p.strip()] or None
                )

            self.db.add(endpoint)
            self.db.commit()
            self.db.refresh(endpoint)
            return self._serialize(endpoint)

        name = (
            self._normalize_name(payload.name, fallback=endpoint.name)
            if "name" in fields_set
            else endpoint.name
        )
        endpoint_url = (
            self._normalize_url(payload.endpoint_url)
            if "endpoint_url" in fields_set
            else endpoint.endpoint_url
        )
        region = (
            self._clean_optional(payload.region)
            if "region" in fields_set
            else endpoint.region
        )
        provider = self._normalize_provider(payload.provider if "provider" in fields_set else endpoint.provider)
        admin_access = (
            self._clean_optional(payload.admin_access_key)
            if "admin_access_key" in fields_set
            else endpoint.admin_access_key
        )
        admin_secret = (
            self._clean_optional(payload.admin_secret_key)
            if "admin_secret_key" in fields_set
            else endpoint.admin_secret_key
        )
        supervision_access = (
            self._clean_optional(payload.supervision_access_key)
            if "supervision_access_key" in fields_set
            else endpoint.supervision_access_key
        )
        supervision_secret = (
            self._clean_optional(payload.supervision_secret_key)
            if "supervision_secret_key" in fields_set
            else endpoint.supervision_secret_key
        )
        raw_features = payload.features_config if payload.features_config is not None else endpoint.features_config
        features, features_config = self._normalize_features(provider, raw_features)
        capabilities = features_to_capabilities(features)
        admin_endpoint = features.get("admin", {}).get("endpoint")
        presign_enabled = endpoint.presign_enabled
        if "presign_enabled" in fields_set:
            presign_enabled = bool(payload.presign_enabled)
        allow_external_access = endpoint.allow_external_access
        if "allow_external_access" in fields_set:
            allow_external_access = bool(payload.allow_external_access)
        max_session_duration = endpoint.max_session_duration
        if "max_session_duration" in fields_set and payload.max_session_duration is not None:
            max_session_duration = int(payload.max_session_duration)
        allowed_packages = endpoint.allowed_packages
        if "allowed_packages" in fields_set:
            normalized_packages = payload.allowed_packages or []
            allowed_packages = (
                [str(p).strip() for p in normalized_packages if isinstance(p, str) and p.strip()] or None
            )

        if not endpoint_url:
            raise ValueError("Endpoint URL is required.")

        self._ensure_unique_name(name, exclude_id=endpoint.id)
        self._ensure_unique_endpoint(endpoint_url, exclude_id=endpoint.id)

        admin_access, admin_secret, supervision_access, supervision_secret = self._validate_credentials(
            provider,
            admin_access,
            admin_secret,
            supervision_access,
            supervision_secret,
            bool(features.get("admin", {}).get("enabled")),
            bool(features.get("usage", {}).get("enabled")) or bool(features.get("metrics", {}).get("enabled")),
        )

        endpoint.name = name
        endpoint.endpoint_url = endpoint_url
        endpoint.admin_endpoint = admin_endpoint
        endpoint.region = region
        endpoint.provider = provider.value
        endpoint.admin_access_key = admin_access
        endpoint.admin_secret_key = admin_secret
        endpoint.supervision_access_key = supervision_access
        endpoint.supervision_secret_key = supervision_secret
        endpoint.capabilities = capabilities
        endpoint.features_config = features_config
        endpoint.presign_enabled = presign_enabled
        endpoint.allow_external_access = allow_external_access
        endpoint.max_session_duration = max_session_duration
        endpoint.allowed_packages = allowed_packages
        self.db.add(endpoint)
        self.db.commit()
        self.db.refresh(endpoint)
        return self._serialize(endpoint)

    def delete_endpoint(self, endpoint_id: int) -> None:
        endpoint = self.db.query(StorageEndpoint).filter(StorageEndpoint.id == endpoint_id).first()
        if not endpoint:
            raise ValueError("Endpoint not found.")
        if not endpoint.is_editable:
            raise ValueError("This endpoint is protected and cannot be deleted.")
        linked_accounts = self.db.query(S3Account).filter(S3Account.storage_endpoint_id == endpoint.id).count()
        linked_users = self.db.query(S3User).filter(S3User.storage_endpoint_id == endpoint.id).count()
        if linked_accounts or linked_users:
            raise ValueError(
                f"Unable to delete this endpoint: {linked_accounts} account(s) and {linked_users} user(s) are linked."
            )
        self.db.delete(endpoint)
        self.db.commit()

    def set_default_endpoint(self, endpoint_id: int) -> StorageEndpointSchema:
        endpoint = self.db.query(StorageEndpoint).filter(StorageEndpoint.id == endpoint_id).first()
        if not endpoint:
            raise ValueError("Endpoint not found.")
        if endpoint.is_default:
            return self._serialize(endpoint)
        (
            self.db.query(StorageEndpoint)
            .filter(StorageEndpoint.is_default.is_(True), StorageEndpoint.id != endpoint.id)
            .update({StorageEndpoint.is_default: False}, synchronize_session=False)
        )
        endpoint.is_default = True
        self.db.add(endpoint)
        self.db.commit()
        self.db.refresh(endpoint)
        return self._serialize(endpoint)

    def _env_endpoint_name(self) -> str:
        candidate = "Default"
        if not self.db.query(StorageEndpoint).filter(StorageEndpoint.name == candidate).first():
            return candidate
        suffix = self.db.query(StorageEndpoint).count() + 1
        return f"{candidate}-{suffix}"

    def ensure_default_endpoint(self) -> Optional[StorageEndpointSchema]:
        endpoint_url = configured_s3_endpoint()
        if not endpoint_url:
            return None
        if self.db.query(StorageEndpoint).count() > 0:
            return None
        region = settings.s3_region
        admin_access = settings.rgw_admin_access_key or settings.s3_access_key
        admin_secret = settings.rgw_admin_secret_key or settings.s3_secret_key
        supervision_access = settings.supervision_access_key
        supervision_secret = settings.supervision_secret_key
        provider = (
            StorageProvider.CEPH if admin_access and admin_secret else StorageProvider.OTHER
        )
        features, features_config = self._normalize_features(provider, settings.s3_endpoint_features)
        capabilities = features_to_capabilities(features)
        admin_endpoint = features.get("admin", {}).get("endpoint")
        name = self._env_endpoint_name()
        admin_access, admin_secret, supervision_access, supervision_secret = self._validate_credentials(
            provider,
            admin_access,
            admin_secret,
            supervision_access,
            supervision_secret,
            bool(features.get("admin", {}).get("enabled")),
            bool(features.get("usage", {}).get("enabled")) or bool(features.get("metrics", {}).get("enabled")),
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
            features_config=features_config,
            is_default=True,
            is_editable=True,
        )
        self.db.add(entry)
        self.db.commit()
        self.db.refresh(entry)
        return self._serialize(entry)


def get_storage_endpoints_service(db: Session) -> StorageEndpointsService:
    return StorageEndpointsService(db)
