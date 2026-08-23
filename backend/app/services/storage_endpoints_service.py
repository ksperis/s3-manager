# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import json
import logging
from dataclasses import dataclass, replace
from typing import Optional

from pydantic import ValidationError, field_validator
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db import (
    S3Account,
    S3Connection,
    S3User,
    StorageEndpoint,
    StorageProvider,
)
from app.models.storage_endpoint import (
    StorageEndpointBase,
    StorageEndpointFeatureDetectionRequest,
    StorageEndpointFeatureDetectionResult,
    StorageEndpointAdminOpsPermissions,
    StorageEndpoint as StorageEndpointSchema,
    StorageEndpointCreate,
    StorageEndpointTagsUpdate,
    StorageEndpointUpdate,
)
from app.models.base import ApiModel
from app.services.mappers.storage_endpoint import storage_endpoint_from_db
from app.services.resource_deletion_purge_service import ResourceDeletionPurgeService
from app.services.rgw_admin import get_rgw_admin_client
from app.services.storage_endpoint_admin_permissions import (
    resolve_storage_endpoint_admin_ops_permissions,
)
from app.services.storage_endpoint_feature_detection import (
    StorageEndpointFeatureDetector,
)
from app.services.tags_service import TagsService
from app.utils.tagging import (
    TAG_DOMAIN_BUCKET_UI_CEPH_ADMIN,
    TAG_DOMAIN_BUCKET_UI_STORAGE_OPS,
    TAG_DOMAIN_ENDPOINT,
)
from app.utils.normalize import normalize_optional_string, normalize_storage_provider
from app.utils.s3_endpoint import configured_s3_endpoint, normalize_s3_endpoint
from app.utils.storage_endpoint_features import (
    AWS_DEFAULT_REGION,
    dump_features_config,
    features_to_capabilities,
    normalize_features_config,
)
from app.utils.name_ordering import name_order_by

logger = logging.getLogger(__name__)
settings = get_settings()

_EndpointCredentialValues = tuple[
    Optional[str],
    Optional[str],
    Optional[str],
    Optional[str],
    Optional[str],
    Optional[str],
]


class EnvStorageEndpoint(ApiModel):
    name: str
    endpoint_url: str
    region: Optional[str] = None
    force_path_style: bool = False
    verify_tls: bool = True
    provider: Optional[StorageProvider] = None
    admin_access_key: Optional[str] = None
    admin_secret_key: Optional[str] = None
    supervision_access_key: Optional[str] = None
    supervision_secret_key: Optional[str] = None
    ceph_admin_access_key: Optional[str] = None
    ceph_admin_secret_key: Optional[str] = None
    features_config: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    features: Optional[dict[str, dict[str, object]]] = None
    is_default: bool = False

    @field_validator("name", "endpoint_url", "region", mode="before")
    @classmethod
    def trim_strings(_cls, value: Optional[str]) -> Optional[str]:
        if isinstance(value, str):
            value = value.strip()
        return value or None

    @field_validator("latitude")
    @classmethod
    def validate_latitude(_cls, value: Optional[float]) -> Optional[float]:
        return StorageEndpointBase.validate_latitude(value)

    @field_validator("longitude")
    @classmethod
    def validate_longitude(_cls, value: Optional[float]) -> Optional[float]:
        return StorageEndpointBase.validate_longitude(value)


@dataclass(frozen=True)
class _EnvEndpointIdentity:
    entry: EnvStorageEndpoint
    name: str
    endpoint_url: str
    is_default: bool


@dataclass(frozen=True)
class _NormalizedEndpointState:
    name: str
    endpoint_url: str
    admin_endpoint: Optional[str]
    region: Optional[str]
    force_path_style: bool
    verify_tls: bool
    latitude: Optional[float]
    longitude: Optional[float]
    provider: StorageProvider
    admin_access_key: Optional[str]
    admin_secret_key: Optional[str]
    supervision_access_key: Optional[str]
    supervision_secret_key: Optional[str]
    ceph_admin_access_key: Optional[str]
    ceph_admin_secret_key: Optional[str]
    features_config: str
    is_default: bool = False


class StorageEndpointsService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.tags = TagsService(db)

    def env_endpoints_locked(self) -> bool:
        raw = settings.env_storage_endpoints
        return bool(raw and raw.strip())

    def _load_env_endpoints(self) -> list[EnvStorageEndpoint]:
        raw = settings.env_storage_endpoints
        if not raw or not raw.strip():
            return []
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise ValueError("ENV_STORAGE_ENDPOINTS must be valid JSON.") from exc
        if not isinstance(payload, list):
            raise ValueError("ENV_STORAGE_ENDPOINTS must be a JSON array.")
        endpoints: list[EnvStorageEndpoint] = []
        for index, entry in enumerate(payload):
            try:
                endpoints.append(EnvStorageEndpoint.model_validate(entry))
            except ValidationError as exc:
                raise ValueError(f"Invalid ENV_STORAGE_ENDPOINTS entry at index {index}.") from exc
        return endpoints

    def _ensure_env_editable(self) -> None:
        if self.env_endpoints_locked():
            raise ValueError("Storage endpoints are managed by ENV_STORAGE_ENDPOINTS.")

    def _normalize_name(self, value: Optional[str], fallback: str = "Endpoint") -> str:
        normalized = (value or fallback).strip()
        return normalized or fallback

    def _normalize_provider(self, provider: Optional[StorageProvider]) -> StorageProvider:
        return normalize_storage_provider(provider)

    def _normalize_region(self, provider: StorageProvider, value: Optional[str]) -> Optional[str]:
        region = normalize_optional_string(value)
        if provider == StorageProvider.AWS and not region:
            return AWS_DEFAULT_REGION
        return region

    def _normalize_features(
        self,
        provider: StorageProvider,
        raw: Optional[str],
        region: Optional[str] = None,
    ) -> tuple[dict[str, dict[str, object]], str]:
        features = normalize_features_config(provider, raw, region)
        return features, dump_features_config(features)

    def _serialize(
        self,
        endpoint: StorageEndpoint,
        *,
        include_admin_ops_permissions: bool = True,
    ) -> StorageEndpointSchema:
        provider = self._normalize_provider(endpoint.provider)
        features, _ = self._normalize_features(provider, endpoint.features_config, endpoint.region)
        capabilities = features_to_capabilities(features)
        admin_ops_permissions = (
            resolve_storage_endpoint_admin_ops_permissions(
                endpoint,
                provider=provider,
                capabilities=capabilities,
                client_factory=get_rgw_admin_client,
            )
            if include_admin_ops_permissions
            else StorageEndpointAdminOpsPermissions()
        )
        return storage_endpoint_from_db(
            endpoint,
            provider=provider,
            features=features,
            capabilities=capabilities,
            admin_ops_permissions=admin_ops_permissions,
            tags=self.tags.get_storage_endpoint_tags(endpoint),
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
        ceph_admin_access_key: Optional[str],
        ceph_admin_secret_key: Optional[str],
        admin_enabled: bool,
        supervision_required: bool,
    ) -> _EndpointCredentialValues:
        if provider == StorageProvider.CEPH:
            if admin_enabled and (not admin_access_key or not admin_secret_key):
                raise ValueError("Ceph endpoints with admin enabled require an admin access key and secret key.")
            if supervision_required and (not supervision_access_key or not supervision_secret_key):
                raise ValueError(
                    "Ceph endpoints with usage or metrics enabled require a supervision access key and secret key."
                )
            if bool(ceph_admin_access_key) != bool(ceph_admin_secret_key):
                raise ValueError("Ceph Admin credentials require both access key and secret key.")
            return (
                admin_access_key,
                admin_secret_key,
                supervision_access_key,
                supervision_secret_key,
                ceph_admin_access_key,
                ceph_admin_secret_key,
            )
        # Provider is not Ceph: clear Ceph-only credentials
        return None, None, None, None, None, None

    def detect_features(
        self,
        payload: StorageEndpointFeatureDetectionRequest,
    ) -> StorageEndpointFeatureDetectionResult:
        return StorageEndpointFeatureDetector(
            self.db,
            get_rgw_admin_client,
        ).detect(payload)

    def _env_endpoint_identities(
        self,
        env_endpoints: list[EnvStorageEndpoint],
    ) -> list[_EnvEndpointIdentity]:
        seen_urls: set[str] = set()
        seen_names: set[str] = set()
        default_count = 0
        identities: list[_EnvEndpointIdentity] = []
        for entry in env_endpoints:
            name = self._normalize_name(entry.name, fallback="Endpoint")
            endpoint_url = normalize_s3_endpoint(entry.endpoint_url)
            if not endpoint_url:
                raise ValueError("ENV_STORAGE_ENDPOINTS requires endpoint_url for each entry.")
            if endpoint_url in seen_urls:
                raise ValueError(f"ENV_STORAGE_ENDPOINTS contains duplicate endpoint_url: {endpoint_url}")
            if name in seen_names:
                raise ValueError(f"ENV_STORAGE_ENDPOINTS contains duplicate name: {name}")
            seen_urls.add(endpoint_url)
            seen_names.add(name)
            if entry.is_default:
                default_count += 1
            identities.append(
                _EnvEndpointIdentity(
                    entry=entry,
                    name=name,
                    endpoint_url=endpoint_url,
                    is_default=bool(entry.is_default),
                )
            )

        if default_count > 1:
            raise ValueError("ENV_STORAGE_ENDPOINTS can only define one default endpoint.")
        if default_count == 0:
            first = identities[0]
            identities[0] = _EnvEndpointIdentity(
                entry=first.entry,
                name=first.name,
                endpoint_url=first.endpoint_url,
                is_default=True,
            )
        return identities

    def _normalize_endpoint_state(
        self,
        payload: StorageEndpointCreate,
    ) -> _NormalizedEndpointState:
        name = self._normalize_name(payload.name, fallback="Endpoint")
        endpoint_url = normalize_s3_endpoint(payload.endpoint_url)
        if not endpoint_url:
            raise ValueError("Endpoint URL is required.")
        provider = self._normalize_provider(payload.provider)
        region = self._normalize_region(provider, payload.region)
        features, features_config = self._normalize_features(
            provider,
            payload.features_config,
            region,
        )
        admin_enabled = bool(features.get("admin", {}).get("enabled")) or bool(
            features.get("account", {}).get("enabled")
        )
        supervision_required = bool(features.get("usage", {}).get("enabled")) or bool(
            features.get("metrics", {}).get("enabled")
        )
        (
            admin_access_key,
            admin_secret_key,
            supervision_access_key,
            supervision_secret_key,
            ceph_admin_access_key,
            ceph_admin_secret_key,
        ) = self._validate_credentials(
            provider,
            normalize_optional_string(payload.admin_access_key),
            normalize_optional_string(payload.admin_secret_key),
            normalize_optional_string(payload.supervision_access_key),
            normalize_optional_string(payload.supervision_secret_key),
            normalize_optional_string(payload.ceph_admin_access_key),
            normalize_optional_string(payload.ceph_admin_secret_key),
            admin_enabled,
            supervision_required,
        )
        return _NormalizedEndpointState(
            name=name,
            endpoint_url=endpoint_url,
            admin_endpoint=features.get("admin", {}).get("endpoint"),
            region=region,
            force_path_style=bool(payload.force_path_style),
            verify_tls=bool(payload.verify_tls),
            latitude=payload.latitude,
            longitude=payload.longitude,
            provider=provider,
            admin_access_key=admin_access_key,
            admin_secret_key=admin_secret_key,
            supervision_access_key=supervision_access_key,
            supervision_secret_key=supervision_secret_key,
            ceph_admin_access_key=ceph_admin_access_key,
            ceph_admin_secret_key=ceph_admin_secret_key,
            features_config=features_config,
        )

    def _normalize_env_endpoint(
        self,
        identity: _EnvEndpointIdentity,
    ) -> _NormalizedEndpointState:
        entry = identity.entry
        raw_features = (
            dump_features_config(entry.features)
            if entry.features is not None
            else entry.features_config
        )
        state = self._normalize_endpoint_state(
            StorageEndpointCreate(
                name=identity.name,
                endpoint_url=identity.endpoint_url,
                region=entry.region,
                force_path_style=entry.force_path_style,
                verify_tls=entry.verify_tls,
                provider=entry.provider,
                admin_access_key=entry.admin_access_key,
                admin_secret_key=entry.admin_secret_key,
                supervision_access_key=entry.supervision_access_key,
                supervision_secret_key=entry.supervision_secret_key,
                ceph_admin_access_key=entry.ceph_admin_access_key,
                ceph_admin_secret_key=entry.ceph_admin_secret_key,
                features_config=raw_features,
                latitude=entry.latitude,
                longitude=entry.longitude,
            )
        )
        return replace(state, is_default=identity.is_default)

    def _normalized_env_endpoints(
        self,
        env_endpoints: list[EnvStorageEndpoint],
    ) -> list[_NormalizedEndpointState]:
        return [
            self._normalize_env_endpoint(identity)
            for identity in self._env_endpoint_identities(env_endpoints)
        ]

    @staticmethod
    def _apply_endpoint_state(
        endpoint: StorageEndpoint,
        config: _NormalizedEndpointState,
    ) -> None:
        endpoint.name = config.name
        endpoint.endpoint_url = config.endpoint_url
        endpoint.admin_endpoint = config.admin_endpoint
        endpoint.region = config.region
        endpoint.force_path_style = config.force_path_style
        endpoint.verify_tls = config.verify_tls
        endpoint.latitude = config.latitude
        endpoint.longitude = config.longitude
        endpoint.provider = config.provider.value
        endpoint.admin_access_key = config.admin_access_key
        endpoint.admin_secret_key = config.admin_secret_key
        endpoint.supervision_access_key = config.supervision_access_key
        endpoint.supervision_secret_key = config.supervision_secret_key
        endpoint.ceph_admin_access_key = config.ceph_admin_access_key
        endpoint.ceph_admin_secret_key = config.ceph_admin_secret_key
        endpoint.features_config = config.features_config

    @classmethod
    def _apply_env_endpoint(
        cls,
        endpoint: StorageEndpoint,
        config: _NormalizedEndpointState,
    ) -> None:
        cls._apply_endpoint_state(endpoint, config)
        endpoint.is_default = config.is_default
        endpoint.is_editable = False

    def _upsert_env_endpoint(
        self,
        config: _NormalizedEndpointState,
        existing_by_url: dict[str, StorageEndpoint],
    ) -> StorageEndpoint:
        endpoint = existing_by_url.get(config.endpoint_url)
        if endpoint is not None:
            self._ensure_unique_name(config.name, exclude_id=endpoint.id)
        else:
            self._ensure_unique_name(config.name)
            self._ensure_unique_endpoint(config.endpoint_url)
            endpoint = StorageEndpoint(name=config.name, endpoint_url=config.endpoint_url)
            existing_by_url[config.endpoint_url] = endpoint
        self._apply_env_endpoint(endpoint, config)
        self.db.add(endpoint)
        return endpoint

    def _clear_other_default_endpoints(self, default_url: str) -> None:
        endpoints = (
            self.db.query(StorageEndpoint)
            .filter(StorageEndpoint.endpoint_url != default_url)
            .all()
        )
        for endpoint in endpoints:
            if endpoint.is_default:
                endpoint.is_default = False
                self.db.add(endpoint)

    def _serialize_env_endpoints(
        self,
        configs: list[_NormalizedEndpointState],
    ) -> list[StorageEndpointSchema]:
        synced: list[StorageEndpointSchema] = []
        for config in configs:
            endpoint = (
                self.db.query(StorageEndpoint)
                .filter(StorageEndpoint.endpoint_url == config.endpoint_url)
                .first()
            )
            if endpoint is not None:
                synced.append(
                    self._serialize(endpoint, include_admin_ops_permissions=False)
                )
        return synced

    def sync_env_endpoints(self, *, _retry_on_integrity: bool = True) -> list[StorageEndpointSchema]:
        env_endpoints = self._load_env_endpoints()
        if not env_endpoints:
            return []
        configs = self._normalized_env_endpoints(env_endpoints)
        existing_by_url = {
            normalized_url: endpoint
            for endpoint in self.db.query(StorageEndpoint).all()
            if endpoint.endpoint_url
            if (normalized_url := normalize_s3_endpoint(endpoint.endpoint_url))
        }

        for config in configs:
            self._upsert_env_endpoint(config, existing_by_url)
        default_config = next(config for config in configs if config.is_default)
        self._clear_other_default_endpoints(default_config.endpoint_url)

        try:
            self.db.commit()
        except IntegrityError:
            self.db.rollback()
            if not _retry_on_integrity:
                raise
            logger.info("ENV_STORAGE_ENDPOINTS sync hit a concurrent insert; reloading existing endpoints.")
            return self.sync_env_endpoints(_retry_on_integrity=False)
        return self._serialize_env_endpoints(configs)

    def list_endpoints(self, *, include_admin_ops_permissions: bool = False) -> list[StorageEndpointSchema]:
        endpoints = (
            self.db.query(StorageEndpoint)
            .order_by(*name_order_by(StorageEndpoint))
            .all()
        )
        return [self._serialize(ep, include_admin_ops_permissions=include_admin_ops_permissions) for ep in endpoints]

    def get_default_endpoint_url(self) -> Optional[str]:
        endpoint = (
            self.db.query(StorageEndpoint)
            .order_by(StorageEndpoint.is_default.desc(), StorageEndpoint.name.asc())
            .first()
        )
        if endpoint and endpoint.endpoint_url:
            return normalize_s3_endpoint(endpoint.endpoint_url)
        return configured_s3_endpoint()

    def get_endpoint(self, endpoint_id: int, *, include_admin_ops_permissions: bool = True) -> StorageEndpointSchema:
        endpoint = self.db.query(StorageEndpoint).filter(StorageEndpoint.id == endpoint_id).first()
        if not endpoint:
            raise ValueError("Endpoint not found.")
        return self._serialize(endpoint, include_admin_ops_permissions=include_admin_ops_permissions)

    def update_endpoint_tags(self, endpoint_id: int, payload: StorageEndpointTagsUpdate) -> StorageEndpointSchema:
        endpoint = self.db.query(StorageEndpoint).filter(StorageEndpoint.id == endpoint_id).first()
        if not endpoint:
            raise ValueError("Endpoint not found.")
        self.tags.replace_storage_endpoint_tags(endpoint, payload.tags)
        self.db.commit()
        self.db.refresh(endpoint)
        return self._serialize(endpoint)

    def _persist_endpoint(self, endpoint: StorageEndpoint) -> StorageEndpointSchema:
        self.db.add(endpoint)
        self.db.commit()
        self.db.refresh(endpoint)
        return self._serialize(endpoint)

    @staticmethod
    def _update_credential_value(
        endpoint: StorageEndpoint,
        payload: StorageEndpointUpdate,
        field: str,
    ) -> Optional[str]:
        if field not in payload.model_fields_set:
            return getattr(endpoint, field)
        return normalize_optional_string(getattr(payload, field))

    def _updated_endpoint_credentials(
        self,
        endpoint: StorageEndpoint,
        payload: StorageEndpointUpdate,
    ) -> _EndpointCredentialValues:
        fields_set = payload.model_fields_set
        admin_access_key = self._update_credential_value(endpoint, payload, "admin_access_key")
        admin_secret_key = self._update_credential_value(endpoint, payload, "admin_secret_key")
        supervision_access_key = self._update_credential_value(
            endpoint,
            payload,
            "supervision_access_key",
        )
        supervision_secret_key = self._update_credential_value(
            endpoint,
            payload,
            "supervision_secret_key",
        )
        ceph_admin_access_key = self._update_credential_value(
            endpoint,
            payload,
            "ceph_admin_access_key",
        )
        ceph_admin_secret_key = self._update_credential_value(
            endpoint,
            payload,
            "ceph_admin_secret_key",
        )
        if "admin_access_key" in fields_set and not admin_access_key:
            admin_secret_key = None
        if "supervision_access_key" in fields_set and not supervision_access_key:
            supervision_secret_key = None
        if "ceph_admin_access_key" in fields_set and not ceph_admin_access_key:
            ceph_admin_secret_key = None
        return (
            admin_access_key,
            admin_secret_key,
            supervision_access_key,
            supervision_secret_key,
            ceph_admin_access_key,
            ceph_admin_secret_key,
        )

    def _updated_endpoint_state(
        self,
        endpoint: StorageEndpoint,
        payload: StorageEndpointUpdate,
    ) -> _NormalizedEndpointState:
        fields_set = payload.model_fields_set
        name = (
            self._normalize_name(payload.name, fallback=endpoint.name)
            if "name" in fields_set
            else endpoint.name
        )
        endpoint_url = (
            normalize_s3_endpoint(payload.endpoint_url)
            if "endpoint_url" in fields_set
            else endpoint.endpoint_url
        )
        if not endpoint_url:
            raise ValueError("Endpoint URL is required.")
        region = payload.region if "region" in fields_set else endpoint.region
        force_path_style = (
            bool(payload.force_path_style)
            if "force_path_style" in fields_set and payload.force_path_style is not None
            else bool(getattr(endpoint, "force_path_style", False))
        )
        verify_tls = (
            bool(payload.verify_tls)
            if "verify_tls" in fields_set and payload.verify_tls is not None
            else bool(getattr(endpoint, "verify_tls", True))
        )
        (
            admin_access_key,
            admin_secret_key,
            supervision_access_key,
            supervision_secret_key,
            ceph_admin_access_key,
            ceph_admin_secret_key,
        ) = self._updated_endpoint_credentials(endpoint, payload)

        return self._normalize_endpoint_state(
            StorageEndpointCreate(
                name=name,
                endpoint_url=endpoint_url,
                region=region,
                force_path_style=force_path_style,
                verify_tls=verify_tls,
                provider=(payload.provider if "provider" in fields_set else endpoint.provider),
                admin_access_key=admin_access_key,
                admin_secret_key=admin_secret_key,
                supervision_access_key=supervision_access_key,
                supervision_secret_key=supervision_secret_key,
                ceph_admin_access_key=ceph_admin_access_key,
                ceph_admin_secret_key=ceph_admin_secret_key,
                features_config=(
                    payload.features_config
                    if payload.features_config is not None
                    else endpoint.features_config
                ),
                latitude=(payload.latitude if "latitude" in fields_set else endpoint.latitude),
                longitude=(payload.longitude if "longitude" in fields_set else endpoint.longitude),
            )
        )

    def create_endpoint(self, payload: StorageEndpointCreate) -> StorageEndpointSchema:
        self._ensure_env_editable()
        state = self._normalize_endpoint_state(payload)
        self._ensure_unique_name(state.name)
        self._ensure_unique_endpoint(state.endpoint_url)
        endpoint = StorageEndpoint(name=state.name, endpoint_url=state.endpoint_url)
        self._apply_endpoint_state(endpoint, state)
        endpoint.is_default = False
        endpoint.is_editable = True
        return self._persist_endpoint(endpoint)

    def update_endpoint(self, endpoint_id: int, payload: StorageEndpointUpdate) -> StorageEndpointSchema:
        self._ensure_env_editable()
        endpoint = self.db.query(StorageEndpoint).filter(StorageEndpoint.id == endpoint_id).first()
        if not endpoint:
            raise ValueError("Endpoint not found.")
        if not endpoint.is_editable:
            raise ValueError("This endpoint is protected and cannot be edited.")
        state = self._updated_endpoint_state(endpoint, payload)
        self._ensure_unique_name(state.name, exclude_id=endpoint.id)
        self._ensure_unique_endpoint(state.endpoint_url, exclude_id=endpoint.id)
        self._apply_endpoint_state(endpoint, state)
        return self._persist_endpoint(endpoint)

    def delete_endpoint(self, endpoint_id: int) -> None:
        self._ensure_env_editable()
        endpoint = self.db.query(StorageEndpoint).filter(StorageEndpoint.id == endpoint_id).first()
        if not endpoint:
            raise ValueError("Endpoint not found.")
        if not endpoint.is_editable:
            raise ValueError("This endpoint is protected and cannot be deleted.")
        linked_accounts = self.db.query(S3Account).filter(S3Account.storage_endpoint_id == endpoint.id).count()
        linked_users = self.db.query(S3User).filter(S3User.storage_endpoint_id == endpoint.id).count()
        linked_connections = self.db.query(S3Connection).filter(S3Connection.storage_endpoint_id == endpoint.id).count()
        has_refs = any(
            count > 0
            for count in [
                linked_accounts,
                linked_users,
                linked_connections,
            ]
        )
        if has_refs:
            raise ValueError(
                "Unable to delete this endpoint: "
                f"accounts={linked_accounts}, users={linked_users}, connections={linked_connections}."
            )
        ResourceDeletionPurgeService(self.db).purge_endpoint_derived_data(endpoint.id)
        self.db.delete(endpoint)
        self.db.flush()
        self.tags.cleanup_orphan_definitions(
            domain_kinds=[
                TAG_DOMAIN_ENDPOINT,
                TAG_DOMAIN_BUCKET_UI_CEPH_ADMIN,
                TAG_DOMAIN_BUCKET_UI_STORAGE_OPS,
            ]
        )
        self.db.commit()

    def set_default_endpoint(self, endpoint_id: int) -> StorageEndpointSchema:
        self._ensure_env_editable()
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
        if self.env_endpoints_locked():
            self.sync_env_endpoints()
            return None
        endpoint_url = configured_s3_endpoint()
        if not endpoint_url:
            return None
        if self.db.query(StorageEndpoint).count() > 0:
            return None
        region = settings.seed_s3_region
        force_path_style = False
        verify_tls = True
        admin_access = settings.seed_rgw_admin_access_key or settings.seed_s3_access_key
        admin_secret = settings.seed_rgw_admin_secret_key or settings.seed_s3_secret_key
        supervision_access = settings.seed_supervision_access_key
        supervision_secret = settings.seed_supervision_secret_key
        ceph_admin_access = settings.seed_ceph_admin_access_key
        ceph_admin_secret = settings.seed_ceph_admin_secret_key
        provider = (
            StorageProvider.CEPH if admin_access and admin_secret else StorageProvider.OTHER
        )
        features, features_config = self._normalize_features(provider, settings.seed_s3_endpoint_features)
        admin_endpoint = features.get("admin", {}).get("endpoint")
        name = self._env_endpoint_name()
        (
            admin_access,
            admin_secret,
            supervision_access,
            supervision_secret,
            ceph_admin_access,
            ceph_admin_secret,
        ) = self._validate_credentials(
            provider,
            admin_access,
            admin_secret,
            supervision_access,
            supervision_secret,
            ceph_admin_access,
            ceph_admin_secret,
            bool(features.get("admin", {}).get("enabled")) or bool(features.get("account", {}).get("enabled")),
            bool(features.get("usage", {}).get("enabled")) or bool(features.get("metrics", {}).get("enabled")),
        )
        entry = StorageEndpoint(
            name=name,
            endpoint_url=endpoint_url,
            admin_endpoint=admin_endpoint,
            region=region,
            force_path_style=force_path_style,
            verify_tls=verify_tls,
            provider=provider.value,
            admin_access_key=admin_access,
            admin_secret_key=admin_secret,
            supervision_access_key=supervision_access,
            supervision_secret_key=supervision_secret,
            ceph_admin_access_key=ceph_admin_access,
            ceph_admin_secret_key=ceph_admin_secret,
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
