# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import logging
from typing import Optional

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
    StorageEndpointFeatureDetectionRequest,
    StorageEndpointFeatureDetectionResult,
    StorageEndpointAdminOpsPermissions,
    StorageEndpoint as StorageEndpointSchema,
    StorageEndpointCreate,
    StorageEndpointTagsUpdate,
    StorageEndpointUpdate,
)
from app.services.mappers.storage_endpoint import storage_endpoint_from_db
from app.services.resource_deletion_purge_service import ResourceDeletionPurgeService
from app.services.rgw_admin import get_rgw_admin_client
from app.services.storage_endpoint_admin_permissions import (
    resolve_storage_endpoint_admin_ops_permissions,
)
from app.services.storage_endpoint_feature_detection import (
    StorageEndpointFeatureDetector,
)
from app.services.storage_endpoint_normalization import (
    NormalizedEndpointState,
    normalize_env_storage_endpoint_states,
    normalize_storage_endpoint_state,
    normalize_storage_endpoint_update,
    parse_env_storage_endpoints,
)
from app.services.tags_service import TagsService
from app.utils.tagging import (
    TAG_DOMAIN_BUCKET_UI_CEPH_ADMIN,
    TAG_DOMAIN_BUCKET_UI_STORAGE_OPS,
    TAG_DOMAIN_ENDPOINT,
)
from app.utils.normalize import normalize_storage_provider
from app.utils.s3_endpoint import configured_s3_endpoint, normalize_s3_endpoint
from app.utils.name_ordering import name_order_by
from app.utils.storage_endpoint_features import (
    features_to_capabilities,
    normalize_features_config,
)

logger = logging.getLogger(__name__)
settings = get_settings()

class StorageEndpointsService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.tags = TagsService(db)

    def env_endpoints_locked(self) -> bool:
        raw = settings.env_storage_endpoints
        return bool(raw and raw.strip())

    def _ensure_env_editable(self) -> None:
        if self.env_endpoints_locked():
            raise ValueError("Storage endpoints are managed by ENV_STORAGE_ENDPOINTS.")

    def _serialize(
        self,
        endpoint: StorageEndpoint,
        *,
        include_admin_ops_permissions: bool = True,
    ) -> StorageEndpointSchema:
        provider = normalize_storage_provider(endpoint.provider)
        features = normalize_features_config(
            provider,
            endpoint.features_config,
            endpoint.region,
        )
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

    def detect_features(
        self,
        payload: StorageEndpointFeatureDetectionRequest,
    ) -> StorageEndpointFeatureDetectionResult:
        return StorageEndpointFeatureDetector(
            self.db,
            get_rgw_admin_client,
        ).detect(payload)

    @staticmethod
    def _apply_endpoint_state(
        endpoint: StorageEndpoint,
        config: NormalizedEndpointState,
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
        config: NormalizedEndpointState,
    ) -> None:
        cls._apply_endpoint_state(endpoint, config)
        endpoint.is_default = config.is_default
        endpoint.is_editable = False

    def _upsert_env_endpoint(
        self,
        config: NormalizedEndpointState,
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
        configs: list[NormalizedEndpointState],
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
        env_endpoints = parse_env_storage_endpoints(settings.env_storage_endpoints)
        if not env_endpoints:
            return []
        configs = normalize_env_storage_endpoint_states(env_endpoints)
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

    def create_endpoint(self, payload: StorageEndpointCreate) -> StorageEndpointSchema:
        self._ensure_env_editable()
        state = normalize_storage_endpoint_state(payload)
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
        state = normalize_storage_endpoint_update(endpoint, payload)
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
        admin_access = settings.seed_rgw_admin_access_key or settings.seed_s3_access_key
        admin_secret = settings.seed_rgw_admin_secret_key or settings.seed_s3_secret_key
        supervision_access = settings.seed_supervision_access_key
        supervision_secret = settings.seed_supervision_secret_key
        ceph_admin_access = settings.seed_ceph_admin_access_key
        ceph_admin_secret = settings.seed_ceph_admin_secret_key
        provider = (
            StorageProvider.CEPH if admin_access and admin_secret else StorageProvider.OTHER
        )
        state = normalize_storage_endpoint_state(
            StorageEndpointCreate(
                name=self._env_endpoint_name(),
                endpoint_url=endpoint_url,
                region=settings.seed_s3_region,
                force_path_style=False,
                verify_tls=True,
                provider=provider,
                admin_access_key=admin_access,
                admin_secret_key=admin_secret,
                supervision_access_key=supervision_access,
                supervision_secret_key=supervision_secret,
                ceph_admin_access_key=ceph_admin_access,
                ceph_admin_secret_key=ceph_admin_secret,
                features_config=settings.seed_s3_endpoint_features,
            )
        )
        entry = StorageEndpoint(
            name=state.name,
            endpoint_url=state.endpoint_url,
            is_default=True,
            is_editable=True,
        )
        self._apply_endpoint_state(entry, state)
        self.db.add(entry)
        self.db.commit()
        self.db.refresh(entry)
        return self._serialize(entry)


def get_storage_endpoints_service(db: Session) -> StorageEndpointsService:
    return StorageEndpointsService(db)
