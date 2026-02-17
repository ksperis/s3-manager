# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import json
import logging
import re
from typing import Optional

from pydantic import BaseModel, ConfigDict, ValidationError, field_validator
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db import StorageEndpoint, StorageProvider, S3Account, S3User
from app.models.storage_endpoint import (
    StorageEndpointFeatureDetectionRequest,
    StorageEndpointFeatureDetectionResult,
    StorageEndpointAdminOpsPermissions,
    StorageEndpoint as StorageEndpointSchema,
    StorageEndpointCreate,
    StorageEndpointUpdate,
)
from app.services.rgw_admin import RGWAdminError, get_rgw_admin_client
from app.utils.s3_endpoint import configured_s3_endpoint
from app.utils.storage_endpoint_features import (
    dump_features_config,
    features_to_capabilities,
    normalize_features_config,
    resolve_admin_endpoint,
)
from app.utils.normalize import normalize_storage_provider

logger = logging.getLogger(__name__)
settings = get_settings()


class EnvStorageEndpoint(BaseModel):
    model_config = ConfigDict(extra="ignore")

    name: str
    endpoint_url: str
    region: Optional[str] = None
    provider: Optional[StorageProvider] = None
    admin_access_key: Optional[str] = None
    admin_secret_key: Optional[str] = None
    supervision_access_key: Optional[str] = None
    supervision_secret_key: Optional[str] = None
    ceph_admin_access_key: Optional[str] = None
    ceph_admin_secret_key: Optional[str] = None
    features_config: Optional[str] = None
    features: Optional[dict[str, dict[str, object]]] = None
    is_default: bool = False

    @field_validator("name", "endpoint_url", "region", mode="before")
    @classmethod
    def trim_strings(cls, value: Optional[str]) -> Optional[str]:
        if isinstance(value, str):
            value = value.strip()
        return value or None


class StorageEndpointsService:
    def __init__(self, db: Session) -> None:
        self.db = db

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
        return normalize_storage_provider(provider)

    def _normalize_features(
        self,
        provider: StorageProvider,
        raw: Optional[str],
    ) -> tuple[dict[str, dict[str, object]], str]:
        features = normalize_features_config(provider, raw)
        return features, dump_features_config(features)

    @staticmethod
    def _empty_admin_ops_permissions() -> StorageEndpointAdminOpsPermissions:
        return StorageEndpointAdminOpsPermissions()

    @staticmethod
    def _parse_caps_payload(raw_caps: object) -> dict[str, set[str]]:
        parsed: dict[str, set[str]] = {}
        if not raw_caps:
            return parsed

        def _append(scope: str, perms: str) -> None:
            normalized_scope = scope.strip().lower()
            if not normalized_scope:
                return
            scope_perms = parsed.setdefault(normalized_scope, set())
            tokens = [token.strip().lower() for token in re.split(r"[,\s]+", perms) if token.strip()]
            if not tokens:
                scope_perms.add("*")
                return
            scope_perms.update(tokens)

        if isinstance(raw_caps, str):
            for item in raw_caps.split(";"):
                scope, sep, perms = item.partition("=")
                if sep:
                    _append(scope, perms)
            return parsed

        if isinstance(raw_caps, list):
            for item in raw_caps:
                if isinstance(item, str):
                    scope, sep, perms = item.partition("=")
                    if sep:
                        _append(scope, perms)
                    continue
                if isinstance(item, dict):
                    scope = str(item.get("type") or item.get("scope") or "").strip()
                    perms = str(item.get("perm") or item.get("permissions") or "*").strip()
                    _append(scope, perms)
            return parsed

        if isinstance(raw_caps, dict):
            for scope, perms in raw_caps.items():
                _append(str(scope), str(perms))
        return parsed

    @staticmethod
    def _perm_allows(scope_perms: set[str], permission: str) -> bool:
        normalized_permission = permission.strip().lower()
        if not normalized_permission:
            return False
        return "*" in scope_perms or normalized_permission in scope_perms

    def _resolve_admin_ops_permissions(
        self,
        endpoint: StorageEndpoint,
        capabilities: dict[str, bool],
    ) -> StorageEndpointAdminOpsPermissions:
        provider = self._normalize_provider(endpoint.provider)
        if provider != StorageProvider.CEPH:
            return self._empty_admin_ops_permissions()
        if not capabilities.get("admin"):
            return self._empty_admin_ops_permissions()
        if not endpoint.admin_access_key or not endpoint.admin_secret_key:
            return self._empty_admin_ops_permissions()

        admin_endpoint = resolve_admin_endpoint(endpoint)
        if not admin_endpoint:
            return self._empty_admin_ops_permissions()

        try:
            admin_client = get_rgw_admin_client(
                access_key=endpoint.admin_access_key,
                secret_key=endpoint.admin_secret_key,
                endpoint=admin_endpoint,
                region=endpoint.region,
            )
            user_payload = admin_client.get_user_by_access_key(endpoint.admin_access_key, allow_not_found=True)
            if not user_payload:
                return self._empty_admin_ops_permissions()
            parsed_caps = self._parse_caps_payload(user_payload.get("caps"))
            users_perms = parsed_caps.get("users", set())
            accounts_perms = parsed_caps.get("accounts", set())
            return StorageEndpointAdminOpsPermissions(
                users_read=self._perm_allows(users_perms, "read") or self._perm_allows(users_perms, "write"),
                users_write=self._perm_allows(users_perms, "write"),
                accounts_read=self._perm_allows(accounts_perms, "read") or self._perm_allows(accounts_perms, "write"),
                accounts_write=self._perm_allows(accounts_perms, "write"),
            )
        except RGWAdminError as exc:
            logger.warning(
                "Unable to evaluate admin ops permissions for endpoint id=%s name=%s: %s",
                endpoint.id,
                endpoint.name,
                exc,
            )
            return self._empty_admin_ops_permissions()

    def _serialize(
        self,
        endpoint: StorageEndpoint,
        *,
        include_admin_ops_permissions: bool = True,
    ) -> StorageEndpointSchema:
        provider = self._normalize_provider(endpoint.provider)
        features, _ = self._normalize_features(provider, endpoint.features_config)
        capabilities = features_to_capabilities(features)
        admin_ops_permissions = (
            self._resolve_admin_ops_permissions(endpoint, capabilities)
            if include_admin_ops_permissions
            else self._empty_admin_ops_permissions()
        )
        return StorageEndpointSchema(
            id=endpoint.id,
            name=endpoint.name,
            endpoint_url=endpoint.endpoint_url,
            admin_endpoint=features.get("admin", {}).get("endpoint"),
            region=endpoint.region,
            provider=provider,
            admin_access_key=endpoint.admin_access_key,
            supervision_access_key=endpoint.supervision_access_key,
            ceph_admin_access_key=endpoint.ceph_admin_access_key,
            capabilities=capabilities,
            admin_ops_permissions=admin_ops_permissions,
            is_default=bool(endpoint.is_default),
            is_editable=bool(endpoint.is_editable),
            created_at=endpoint.created_at,
            updated_at=endpoint.updated_at,
            has_admin_secret=bool(endpoint.admin_secret_key),
            has_supervision_secret=bool(endpoint.supervision_secret_key),
            has_ceph_admin_secret=bool(endpoint.ceph_admin_secret_key),
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
        ceph_admin_access_key: Optional[str],
        ceph_admin_secret_key: Optional[str],
        admin_enabled: bool,
        supervision_required: bool,
    ) -> tuple[Optional[str], Optional[str], Optional[str], Optional[str], Optional[str], Optional[str]]:
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

    def detect_features(self, payload: StorageEndpointFeatureDetectionRequest) -> StorageEndpointFeatureDetectionResult:
        endpoint_url = self._normalize_url(payload.endpoint_url)
        if not endpoint_url:
            raise ValueError("Endpoint URL is required.")

        stored_endpoint: Optional[StorageEndpoint] = None
        if payload.endpoint_id is not None:
            stored_endpoint = self.db.query(StorageEndpoint).filter(StorageEndpoint.id == payload.endpoint_id).first()
            if not stored_endpoint:
                raise ValueError("Endpoint not found.")

        region = self._clean_optional(payload.region) or (stored_endpoint.region if stored_endpoint else None)
        admin_endpoint = self._normalize_url(payload.admin_endpoint) or endpoint_url

        admin_access_key = self._clean_optional(payload.admin_access_key)
        admin_secret_key = self._clean_optional(payload.admin_secret_key)
        supervision_access_key = self._clean_optional(payload.supervision_access_key)
        supervision_secret_key = self._clean_optional(payload.supervision_secret_key)

        if stored_endpoint:
            if admin_access_key and not admin_secret_key and admin_access_key == (stored_endpoint.admin_access_key or ""):
                admin_secret_key = stored_endpoint.admin_secret_key
            if (
                supervision_access_key
                and not supervision_secret_key
                and supervision_access_key == (stored_endpoint.supervision_access_key or "")
            ):
                supervision_secret_key = stored_endpoint.supervision_secret_key

        result = StorageEndpointFeatureDetectionResult()

        admin_client = None
        if admin_access_key and admin_secret_key:
            try:
                admin_client = get_rgw_admin_client(
                    access_key=admin_access_key,
                    secret_key=admin_secret_key,
                    endpoint=admin_endpoint,
                    region=region,
                )
                admin_payload = admin_client.get_user_by_access_key(admin_access_key, allow_not_found=True)
                if admin_payload:
                    result.admin = True
                else:
                    result.admin_error = "Admin access key is not recognized by RGW."
            except RGWAdminError as exc:
                result.admin_error = str(exc)
        elif admin_access_key or admin_secret_key:
            result.admin_error = "Admin detection requires both access key and secret key."

        if admin_client is not None:
            try:
                # Probe /admin/account directly with a synthetic account id.
                # If the account does not exist, RGW returns not_found and the API is still available.
                admin_client.get_account("RGW00000000000000000", allow_not_found=True)
                result.account = True
            except RGWAdminError as exc:
                result.account_error = str(exc)

        if supervision_access_key and supervision_secret_key:
            supervision_client = None
            try:
                supervision_client = get_rgw_admin_client(
                    access_key=supervision_access_key,
                    secret_key=supervision_secret_key,
                    endpoint=admin_endpoint,
                    region=region,
                )
                supervision_client.get_all_buckets(with_stats=False)
                result.metrics = True
            except RGWAdminError as exc:
                result.metrics_error = str(exc)

            if supervision_client is not None:
                try:
                    usage_payload = supervision_client.get_usage(show_entries=False, show_summary=False)
                    if isinstance(usage_payload, dict) and usage_payload.get("not_found"):
                        result.usage = False
                        result.usage_error = "RGW usage logs endpoint is unavailable."
                    else:
                        result.usage = True
                except RGWAdminError as exc:
                    result.usage_error = str(exc)
        elif supervision_access_key or supervision_secret_key:
            message = "Supervision detection requires both access key and secret key."
            result.metrics_error = message
            result.usage_error = message

        if result.metrics and not result.usage:
            result.warnings.append(
                "Usage logs do not appear enabled on this RGW endpoint; activity traffic stats will not be available."
            )

        return result

    def sync_env_endpoints(self) -> list[StorageEndpointSchema]:
        env_endpoints = self._load_env_endpoints()
        if not env_endpoints:
            return []

        seen_urls: set[str] = set()
        seen_names: set[str] = set()
        default_count = 0
        normalized_entries: list[tuple[EnvStorageEndpoint, str, str]] = []

        for entry in env_endpoints:
            name = self._normalize_name(entry.name, fallback="Endpoint")
            endpoint_url = self._normalize_url(entry.endpoint_url)
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
            normalized_entries.append((entry, name, endpoint_url))

        if default_count > 1:
            raise ValueError("ENV_STORAGE_ENDPOINTS can only define one default endpoint.")
        if default_count == 0:
            normalized_entries[0][0].is_default = True

        existing = self.db.query(StorageEndpoint).all()
        existing_by_url = {
            self._normalize_url(endpoint.endpoint_url): endpoint
            for endpoint in existing
            if endpoint.endpoint_url
        }

        default_url: Optional[str] = None
        for entry, name, endpoint_url in normalized_entries:
            provider = self._normalize_provider(entry.provider)
            region = self._clean_optional(entry.region)
            admin_access = self._clean_optional(entry.admin_access_key)
            admin_secret = self._clean_optional(entry.admin_secret_key)
            supervision_access = self._clean_optional(entry.supervision_access_key)
            supervision_secret = self._clean_optional(entry.supervision_secret_key)
            ceph_admin_access = self._clean_optional(entry.ceph_admin_access_key)
            ceph_admin_secret = self._clean_optional(entry.ceph_admin_secret_key)
            raw_features = entry.features_config
            if entry.features is not None:
                raw_features = dump_features_config(entry.features)
            features, features_config = self._normalize_features(provider, raw_features)
            admin_endpoint = features.get("admin", {}).get("endpoint")

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

            endpoint = existing_by_url.get(endpoint_url)
            if endpoint:
                self._ensure_unique_name(name, exclude_id=endpoint.id)
                endpoint.name = name
                endpoint.endpoint_url = endpoint_url
                endpoint.admin_endpoint = admin_endpoint
                endpoint.region = region
                endpoint.provider = provider.value
                endpoint.admin_access_key = admin_access
                endpoint.admin_secret_key = admin_secret
                endpoint.supervision_access_key = supervision_access
                endpoint.supervision_secret_key = supervision_secret
                endpoint.ceph_admin_access_key = ceph_admin_access
                endpoint.ceph_admin_secret_key = ceph_admin_secret
                endpoint.features_config = features_config
                endpoint.is_default = bool(entry.is_default)
                endpoint.is_editable = False
                self.db.add(endpoint)
            else:
                self._ensure_unique_name(name)
                self._ensure_unique_endpoint(endpoint_url)
                endpoint = StorageEndpoint(
                    name=name,
                    endpoint_url=endpoint_url,
                    admin_endpoint=admin_endpoint,
                    region=region,
                    provider=provider.value,
                    admin_access_key=admin_access,
                    admin_secret_key=admin_secret,
                    supervision_access_key=supervision_access,
                    supervision_secret_key=supervision_secret,
                    ceph_admin_access_key=ceph_admin_access,
                    ceph_admin_secret_key=ceph_admin_secret,
                    features_config=features_config,
                    is_default=bool(entry.is_default),
                    is_editable=False,
                )
                self.db.add(endpoint)
                existing_by_url[endpoint_url] = endpoint

            if entry.is_default:
                default_url = endpoint_url

        if default_url:
            for endpoint in self.db.query(StorageEndpoint).filter(StorageEndpoint.endpoint_url != default_url).all():
                if endpoint.is_default:
                    endpoint.is_default = False
                    self.db.add(endpoint)

        self.db.commit()
        synced: list[StorageEndpointSchema] = []
        for endpoint_url in seen_urls:
            endpoint = self.db.query(StorageEndpoint).filter(StorageEndpoint.endpoint_url == endpoint_url).first()
            if endpoint:
                synced.append(self._serialize(endpoint, include_admin_ops_permissions=False))
        return synced

    def list_endpoints(self, *, include_admin_ops_permissions: bool = False) -> list[StorageEndpointSchema]:
        endpoints = (
            self.db.query(StorageEndpoint)
            .order_by(StorageEndpoint.is_default.desc(), StorageEndpoint.name.asc())
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
            return self._normalize_url(endpoint.endpoint_url)
        return configured_s3_endpoint()

    def get_endpoint(self, endpoint_id: int, *, include_admin_ops_permissions: bool = True) -> StorageEndpointSchema:
        endpoint = self.db.query(StorageEndpoint).filter(StorageEndpoint.id == endpoint_id).first()
        if not endpoint:
            raise ValueError("Endpoint not found.")
        return self._serialize(endpoint, include_admin_ops_permissions=include_admin_ops_permissions)

    def create_endpoint(self, payload: StorageEndpointCreate) -> StorageEndpointSchema:
        self._ensure_env_editable()
        name = self._normalize_name(payload.name, fallback="Endpoint")
        endpoint_url = self._normalize_url(payload.endpoint_url)
        region = self._clean_optional(payload.region)
        provider = self._normalize_provider(payload.provider)
        admin_access = self._clean_optional(payload.admin_access_key)
        admin_secret = self._clean_optional(payload.admin_secret_key)
        supervision_access = self._clean_optional(payload.supervision_access_key)
        supervision_secret = self._clean_optional(payload.supervision_secret_key)
        ceph_admin_access = self._clean_optional(payload.ceph_admin_access_key)
        ceph_admin_secret = self._clean_optional(payload.ceph_admin_secret_key)
        features, features_config = self._normalize_features(provider, payload.features_config)
        admin_endpoint = features.get("admin", {}).get("endpoint")

        if not endpoint_url:
            raise ValueError("Endpoint URL is required.")
        self._ensure_unique_name(name)
        self._ensure_unique_endpoint(endpoint_url)
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
            provider=provider.value,
            admin_access_key=admin_access,
            admin_secret_key=admin_secret,
            supervision_access_key=supervision_access,
            supervision_secret_key=supervision_secret,
            ceph_admin_access_key=ceph_admin_access,
            ceph_admin_secret_key=ceph_admin_secret,
            features_config=features_config,
            is_default=False,
            is_editable=True,
        )
        self.db.add(entry)
        self.db.commit()
        self.db.refresh(entry)
        return self._serialize(entry)

    def update_endpoint(self, endpoint_id: int, payload: StorageEndpointUpdate) -> StorageEndpointSchema:
        self._ensure_env_editable()
        endpoint = self.db.query(StorageEndpoint).filter(StorageEndpoint.id == endpoint_id).first()
        if not endpoint:
            raise ValueError("Endpoint not found.")
        if not endpoint.is_editable:
            raise ValueError("This endpoint is protected and cannot be edited.")

        fields_set = payload.model_fields_set
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
        ceph_admin_access = (
            self._clean_optional(payload.ceph_admin_access_key)
            if "ceph_admin_access_key" in fields_set
            else endpoint.ceph_admin_access_key
        )
        ceph_admin_secret = (
            self._clean_optional(payload.ceph_admin_secret_key)
            if "ceph_admin_secret_key" in fields_set
            else endpoint.ceph_admin_secret_key
        )
        # Keep credentials consistent when an access key is explicitly cleared.
        # This avoids stale encrypted secrets if API clients only send access_key=null.
        if "admin_access_key" in fields_set and not admin_access:
            admin_secret = None
        if "supervision_access_key" in fields_set and not supervision_access:
            supervision_secret = None
        if "ceph_admin_access_key" in fields_set and not ceph_admin_access:
            ceph_admin_secret = None
        raw_features = payload.features_config if payload.features_config is not None else endpoint.features_config
        features, features_config = self._normalize_features(provider, raw_features)
        admin_endpoint = features.get("admin", {}).get("endpoint")

        if not endpoint_url:
            raise ValueError("Endpoint URL is required.")

        self._ensure_unique_name(name, exclude_id=endpoint.id)
        self._ensure_unique_endpoint(endpoint_url, exclude_id=endpoint.id)

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

        endpoint.name = name
        endpoint.endpoint_url = endpoint_url
        endpoint.admin_endpoint = admin_endpoint
        endpoint.region = region
        endpoint.provider = provider.value
        endpoint.admin_access_key = admin_access
        endpoint.admin_secret_key = admin_secret
        endpoint.supervision_access_key = supervision_access
        endpoint.supervision_secret_key = supervision_secret
        endpoint.ceph_admin_access_key = ceph_admin_access
        endpoint.ceph_admin_secret_key = ceph_admin_secret
        endpoint.features_config = features_config
        self.db.add(endpoint)
        self.db.commit()
        self.db.refresh(endpoint)
        return self._serialize(endpoint)

    def delete_endpoint(self, endpoint_id: int) -> None:
        self._ensure_env_editable()
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
