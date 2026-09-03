# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Authorization policy for Manager Ceph quota and RGW key operations."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from sqlalchemy.orm import Session

from app.db import S3Account, S3User, StorageEndpoint, StorageProvider, User
from app.models.storage_endpoint import StorageEndpointAdminOpsPermissions
from app.services import app_settings_service
from app.services.effective_access_service import EffectiveAccessService, MANAGER_TOOL_ROLES
from app.services.rgw_admin import get_rgw_admin_client
from app.services.s3_execution_context import S3ExecutionTarget
from app.services.storage_endpoint_admin_permissions import (
    resolve_storage_endpoint_admin_ops_permissions,
)
from app.utils.normalize import normalize_storage_provider
from app.utils.storage_endpoint_features import resolve_feature_flags


ManagerCephManagementOperation = Literal["bucket_quota", "rgw_access_keys"]
ManagerCephManagementSurface = Literal["manager", "browser"]


def _resolve_endpoint_admin_ops_permissions(endpoint: StorageEndpoint) -> StorageEndpointAdminOpsPermissions:
    return resolve_storage_endpoint_admin_ops_permissions(
        endpoint,
        provider=normalize_storage_provider(endpoint.provider),
        capabilities={"admin": resolve_feature_flags(endpoint).admin_enabled},
        client_factory=get_rgw_admin_client,
    )


@dataclass(frozen=True, slots=True)
class ManagerCephManagementDecision:
    allowed: bool
    reason: str


class ManagerCephManagementAccessService:
    """Resolve catalogue and execution availability from one fresh access policy."""

    def __init__(self, db: Session) -> None:
        self.db = db

    @staticmethod
    def _deny(reason: str) -> ManagerCephManagementDecision:
        return ManagerCephManagementDecision(allowed=False, reason=reason)

    @staticmethod
    def _endpoint_supports_ceph_admin(endpoint: StorageEndpoint | None) -> bool:
        if endpoint is None:
            return False
        if normalize_storage_provider(endpoint.provider) != StorageProvider.CEPH:
            return False
        if not resolve_feature_flags(endpoint).admin_enabled:
            return False
        return bool(
            (endpoint.admin_access_key or "").strip()
            and (endpoint.admin_secret_key or "").strip()
        )

    def evaluate(
        self,
        operation: ManagerCephManagementOperation,
        *,
        surface: ManagerCephManagementSurface,
        actor: User | None,
        account: S3ExecutionTarget | None,
    ) -> ManagerCephManagementDecision:
        label = "Bucket quota management" if operation == "bucket_quota" else "Ceph access key management"
        if surface != "manager":
            return self._deny(f"{label} is only available in Manager")
        if actor is None or actor.role not in MANAGER_TOOL_ROLES:
            return self._deny("Not authorized")

        settings = app_settings_service.load_app_settings().general
        if operation == "bucket_quota" and not settings.bucket_quota_management_enabled:
            return self._deny("Bucket quota management feature is disabled")
        if operation == "rgw_access_keys" and not settings.manager_ceph_s3_user_keys_enabled:
            return self._deny("Ceph access key management feature is disabled")
        if account is None:
            return self._deny(f"{label} is not available for this context")

        effective = EffectiveAccessService(self.db).resolve_user(actor)
        context_kind = getattr(account, "context_kind", "account")
        resource: S3Account | S3User | None = None

        if context_kind == "account" and operation == "bucket_quota":
            account_id = getattr(account, "id", None)
            if not isinstance(account_id, int) or account_id <= 0:
                return self._deny(f"{label} is not available for this context")
            link = effective.account_link_for(account_id)
            if link is None or not EffectiveAccessService.manager_account_allowed(link):
                return self._deny("Not authorized for this Manager context")
            resource = self.db.query(S3Account).filter(S3Account.id == account_id).first()
            if resource is None or not resource.allow_bucket_quota_management:
                return self._deny("Bucket quota management is not enabled for this resource")
        elif context_kind == "s3_user":
            s3_user_id = getattr(account, "s3_user_id", None)
            if not isinstance(s3_user_id, int) or s3_user_id <= 0:
                return self._deny(f"{label} is not available for this context")
            if not effective.has_s3_user(s3_user_id):
                return self._deny("Not authorized for this Manager context")
            resource = self.db.query(S3User).filter(S3User.id == s3_user_id).first()
            if resource is None:
                return self._deny(f"{label} is not available for this context")
            if operation == "bucket_quota" and not resource.allow_bucket_quota_management:
                return self._deny("Bucket quota management is not enabled for this resource")
            if operation == "rgw_access_keys" and not resource.allow_access_key_management:
                return self._deny("Ceph access key management is not enabled for this resource")
        else:
            return self._deny(f"{label} is not available for this context")

        endpoint_id = getattr(resource, "storage_endpoint_id", None)
        endpoint = (
            self.db.query(StorageEndpoint).filter(StorageEndpoint.id == endpoint_id).first()
            if isinstance(endpoint_id, int)
            else None
        )
        if not self._endpoint_supports_ceph_admin(endpoint):
            return self._deny("Ceph Admin API is not available for this context")
        if operation == "bucket_quota":
            permissions = _resolve_endpoint_admin_ops_permissions(endpoint)
            if not permissions.buckets_write:
                return self._deny(
                    "Bucket quota management requires buckets=write on the endpoint Admin Ops identity"
                )
        return ManagerCephManagementDecision(allowed=True, reason="")
