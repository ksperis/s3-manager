# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Any, Optional

from sqlalchemy.orm import Session

from app.db import StorageEndpoint, StorageProvider, User
from app.models.admin_automation import (
    AdminAutomationItemResult,
    StorageEndpointApply,
    StorageEndpointSpec,
)
from app.models.storage_endpoint import StorageEndpointCreate, StorageEndpointUpdate
from app.services.admin_automation_results import AdminAutomationResultFactory
from app.services.admin_automation_storage_endpoint_resolver import find_storage_endpoint
from app.services.audit_service import AuditService
from app.services.mappers.s3_connection import mask_access_key_id
from app.services.storage_endpoints_service import StorageEndpointsService
from app.utils.normalize import normalize_optional_string, normalize_storage_provider
from app.utils.s3_endpoint import normalize_s3_endpoint
from app.utils.storage_endpoint_features import (
    dump_features_config,
    normalize_features_config,
    resolve_feature_flags,
)


class AdminAutomationStorageEndpointHandler(AdminAutomationResultFactory):
    def __init__(self, db: Session, endpoints: StorageEndpointsService) -> None:
        self.db = db
        self.endpoints = endpoints

    def apply(
        self,
        item: StorageEndpointApply,
        dry_run: bool,
        current_user: User,
        audit_service: AuditService,
    ) -> AdminAutomationItemResult:
        key = self._key(item)
        try:
            endpoint = self._find(item)
            if item.state == "absent":
                if not endpoint:
                    return self._skipped("storage_endpoint", key, dry_run=dry_run)
                if dry_run:
                    return self._deleted(
                        "storage_endpoint",
                        key,
                        endpoint.id,
                        dry_run=dry_run,
                    )
                self.endpoints.delete_endpoint(endpoint.id)
                audit_service.record_action(
                    user=current_user,
                    scope="admin",
                    action="delete_storage_endpoint",
                    entity_type="storage_endpoint",
                    entity_id=str(endpoint.id),
                )
                return self._deleted(
                    "storage_endpoint",
                    key,
                    endpoint.id,
                    dry_run=dry_run,
                )

            spec = item.spec
            if not endpoint:
                if not spec:
                    raise ValueError(
                        "storage_endpoints.spec is required to create a new endpoint"
                    )
                payload = self._build_create(item, spec)
                if dry_run:
                    return self._created("storage_endpoint", key, dry_run=dry_run)
                created = self.endpoints.create_endpoint(payload)
                if spec.set_default:
                    created = self.endpoints.set_default_endpoint(created.id)
                audit_service.record_action(
                    user=current_user,
                    scope="admin",
                    action="create_storage_endpoint",
                    entity_type="storage_endpoint",
                    entity_id=str(created.id),
                    metadata=self._audit_metadata(created),
                )
                return self._created(
                    "storage_endpoint",
                    key,
                    created.id,
                    dry_run=dry_run,
                )

            diff = self._diff(endpoint, item)
            if spec and spec.set_default and not endpoint.is_default:
                diff["is_default"] = {"from": False, "to": True}
            if not diff:
                return self._skipped("storage_endpoint", key, dry_run=dry_run)
            if dry_run:
                return self._updated(
                    "storage_endpoint",
                    key,
                    endpoint.id,
                    diff,
                    dry_run=dry_run,
                )

            if set(diff) == {"is_default"}:
                updated = self.endpoints.set_default_endpoint(endpoint.id)
                audit_service.record_action(
                    user=current_user,
                    scope="admin",
                    action="set_default_storage_endpoint",
                    entity_type="storage_endpoint",
                    entity_id=str(updated.id),
                    metadata={
                        "endpoint_url": updated.endpoint_url,
                        "provider": updated.provider.value,
                    },
                )
            else:
                update_payload = self._build_update(item)
                updated = self.endpoints.update_endpoint(endpoint.id, update_payload)
                if spec and spec.set_default and not updated.is_default:
                    updated = self.endpoints.set_default_endpoint(updated.id)
                audit_service.record_action(
                    user=current_user,
                    scope="admin",
                    action="update_storage_endpoint",
                    entity_type="storage_endpoint",
                    entity_id=str(endpoint.id),
                    metadata=self._audit_metadata(updated),
                )
            return self._updated(
                "storage_endpoint",
                key,
                endpoint.id,
                diff,
                dry_run=dry_run,
            )
        except Exception as exc:  # noqa: BLE001
            return self._failed("storage_endpoint", key, exc, dry_run=dry_run)

    def _diff(
        self,
        endpoint: StorageEndpoint,
        item: StorageEndpointApply,
    ) -> dict[str, dict[str, Any]]:
        spec = item.spec
        if not spec:
            return {}
        diff: dict[str, dict[str, Any]] = {}
        fields_set = spec.model_fields_set
        if "name" in fields_set:
            desired = normalize_optional_string(spec.name) or endpoint.name
            if desired != endpoint.name:
                diff["name"] = {"from": endpoint.name, "to": desired}
        if "endpoint_url" in fields_set:
            desired = normalize_s3_endpoint(spec.endpoint_url)
            current = normalize_s3_endpoint(endpoint.endpoint_url)
            if desired != current:
                diff["endpoint_url"] = {"from": current, "to": desired}
        if "region" in fields_set:
            desired = normalize_optional_string(spec.region)
            if desired != normalize_optional_string(endpoint.region):
                diff["region"] = {"from": endpoint.region, "to": desired}
        if "force_path_style" in fields_set and spec.force_path_style is not None:
            desired = bool(spec.force_path_style)
            current = bool(endpoint.force_path_style)
            if desired != current:
                diff["force_path_style"] = {"from": current, "to": desired}
        if "verify_tls" in fields_set and spec.verify_tls is not None:
            desired = bool(spec.verify_tls)
            current = bool(endpoint.verify_tls)
            if desired != current:
                diff["verify_tls"] = {"from": current, "to": desired}
        if "provider" in fields_set:
            desired = normalize_storage_provider(spec.provider).value
            current = normalize_storage_provider(endpoint.provider).value
            if desired != current:
                diff["provider"] = {"from": current, "to": desired}
        if "features_config" in fields_set:
            provider = normalize_storage_provider(
                spec.provider if "provider" in fields_set else endpoint.provider
            )
            desired_region = spec.region if "region" in fields_set else endpoint.region
            desired_features = dump_features_config(
                normalize_features_config(
                    provider,
                    spec.features_config,
                    desired_region,
                )
            )
            current_features = dump_features_config(
                normalize_features_config(
                    provider,
                    endpoint.features_config,
                    endpoint.region,
                )
            )
            if desired_features != current_features:
                diff["features_config"] = {
                    "from": current_features,
                    "to": desired_features,
                }
        for coordinate in ("latitude", "longitude"):
            if coordinate in fields_set:
                desired = getattr(spec, coordinate)
                current = getattr(endpoint, coordinate)
                if desired != current:
                    diff[coordinate] = {"from": current, "to": desired}
        if item.update_secrets:
            self._add_credential_diff(
                diff,
                "admin_access_key",
                spec.admin_access_key,
                endpoint.admin_access_key,
                fields_set,
            )
            self._add_secret_diff(
                diff,
                "admin_secret_key",
                spec.admin_secret_key,
                endpoint.admin_secret_key,
                fields_set,
            )
            self._add_credential_diff(
                diff,
                "supervision_access_key",
                spec.supervision_access_key,
                endpoint.supervision_access_key,
                fields_set,
            )
            self._add_secret_diff(
                diff,
                "supervision_secret_key",
                spec.supervision_secret_key,
                endpoint.supervision_secret_key,
                fields_set,
            )
            self._add_credential_diff(
                diff,
                "ceph_admin_access_key",
                spec.ceph_admin_access_key,
                endpoint.ceph_admin_access_key,
                fields_set,
            )
            self._add_secret_diff(
                diff,
                "ceph_admin_secret_key",
                spec.ceph_admin_secret_key,
                endpoint.ceph_admin_secret_key,
                fields_set,
            )
        return diff

    @staticmethod
    def _add_credential_diff(
        diff: dict[str, dict[str, Any]],
        field: str,
        desired_value: Optional[str],
        current_value: Optional[str],
        fields_set: set[str],
    ) -> None:
        if field not in fields_set:
            return
        desired = normalize_optional_string(desired_value)
        current = normalize_optional_string(current_value)
        if desired != current:
            diff[field] = {
                "from": mask_access_key_id(current),
                "to": mask_access_key_id(desired),
            }

    @staticmethod
    def _add_secret_diff(
        diff: dict[str, dict[str, Any]],
        field: str,
        desired_value: Optional[str],
        current_value: Optional[str],
        fields_set: set[str],
    ) -> None:
        if field not in fields_set:
            return
        desired = normalize_optional_string(desired_value)
        current = normalize_optional_string(current_value)
        if desired != current:
            diff[field] = {"from": "<redacted>", "to": "<redacted>"}

    @staticmethod
    def _build_create(
        item: StorageEndpointApply,
        spec: StorageEndpointSpec,
    ) -> StorageEndpointCreate:
        name = normalize_optional_string(spec.name or item.match.name) or "Endpoint"
        endpoint_url = normalize_s3_endpoint(
            spec.endpoint_url or item.match.endpoint_url
        )
        if not endpoint_url:
            raise ValueError(
                "storage_endpoints.spec.endpoint_url is required to create a new endpoint"
            )
        return StorageEndpointCreate(
            name=name,
            endpoint_url=endpoint_url,
            region=normalize_optional_string(spec.region),
            force_path_style=bool(
                spec.force_path_style if spec.force_path_style is not None else False
            ),
            verify_tls=bool(spec.verify_tls if spec.verify_tls is not None else True),
            provider=spec.provider or StorageProvider.CEPH,
            admin_access_key=spec.admin_access_key,
            admin_secret_key=spec.admin_secret_key,
            supervision_access_key=spec.supervision_access_key,
            supervision_secret_key=spec.supervision_secret_key,
            ceph_admin_access_key=spec.ceph_admin_access_key,
            ceph_admin_secret_key=spec.ceph_admin_secret_key,
            features_config=spec.features_config,
            latitude=spec.latitude,
            longitude=spec.longitude,
        )

    @staticmethod
    def _build_update(item: StorageEndpointApply) -> StorageEndpointUpdate:
        spec = item.spec
        if not spec:
            return StorageEndpointUpdate()
        payload = spec.model_dump(exclude_unset=True)
        if not item.update_secrets:
            for field in (
                "admin_access_key",
                "admin_secret_key",
                "supervision_access_key",
                "supervision_secret_key",
                "ceph_admin_access_key",
                "ceph_admin_secret_key",
            ):
                payload.pop(field, None)
        payload.pop("set_default", None)
        return StorageEndpointUpdate(**payload)

    def _find(self, item: StorageEndpointApply) -> Optional[StorageEndpoint]:
        return find_storage_endpoint(
            self.db,
            endpoint_id=item.match.id,
            endpoint_name=item.match.name,
            endpoint_url=item.match.endpoint_url,
        )

    @staticmethod
    def _audit_metadata(endpoint: StorageEndpoint) -> dict[str, Any]:
        return {
            "endpoint_url": endpoint.endpoint_url,
            "provider": normalize_storage_provider(endpoint.provider).value,
            "admin_endpoint": resolve_feature_flags(endpoint).admin_endpoint,
            "verify_tls": endpoint.verify_tls,
        }

    @staticmethod
    def _key(item: StorageEndpointApply) -> str:
        if item.match.endpoint_url:
            return f"endpoint_url={item.match.endpoint_url}"
        if item.match.name:
            return f"name={item.match.name}"
        return f"id={item.match.id}"
