# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import logging
from typing import Callable, Optional

from app.db import StorageEndpoint, StorageProvider
from app.services.rgw_admin import RGWAdminClient, RGWAdminError
from app.services.rgw_user_key_parser import RgwUserKeyParser
from app.utils.normalize import normalize_optional_string, normalize_storage_provider
from app.utils.storage_endpoint_features import (
    resolve_admin_endpoint,
    resolve_feature_flags,
)

logger = logging.getLogger(__name__)


class RgwAccessKeyRotator:
    """Perform the RGW operations required by credential rotation workflows."""

    def __init__(self, client_factory: Callable[..., RGWAdminClient]) -> None:
        self._client_factory = client_factory

    def validate_ceph_admin_api(self, endpoint: StorageEndpoint) -> Optional[str]:
        provider = normalize_storage_provider(endpoint.provider)
        if provider != StorageProvider.CEPH:
            return "Key rotation is only supported for Ceph endpoints."
        if not resolve_feature_flags(endpoint).admin_enabled:
            return "Admin feature is disabled."
        return None

    def build_endpoint_admin_client(
        self,
        endpoint: StorageEndpoint,
    ) -> RGWAdminClient:
        if not endpoint.admin_access_key or not endpoint.admin_secret_key:
            raise ValueError("Endpoint admin credentials are not configured.")
        return self.build_direct_client(
            endpoint=endpoint,
            access_key=endpoint.admin_access_key,
            secret_key=endpoint.admin_secret_key,
        )

    def build_direct_client(
        self,
        *,
        endpoint: StorageEndpoint,
        access_key: str,
        secret_key: str,
    ) -> RGWAdminClient:
        admin_endpoint = resolve_admin_endpoint(endpoint)
        if not admin_endpoint:
            raise ValueError(
                "Admin feature is disabled or admin endpoint is not configured."
            )
        try:
            return self._client_factory(
                endpoint,
                access_key=access_key,
                secret_key=secret_key,
            )
        except RGWAdminError as exc:
            raise ValueError(f"Unable to build RGW admin client: {exc}") from exc

    def detect_user_tenant(
        self,
        admin: RGWAdminClient,
        *,
        uid: str,
        preferred_tenant: Optional[str],
    ) -> Optional[str]:
        attempts: list[Optional[str]] = []
        for candidate in (normalize_optional_string(preferred_tenant), None):
            if candidate in attempts:
                continue
            attempts.append(candidate)

        last_error: Optional[Exception] = None
        for tenant in attempts:
            try:
                payload = admin.get_user(uid, tenant=tenant, allow_not_found=True)
            except RGWAdminError as exc:
                last_error = exc
                continue
            if payload and not payload.get("not_found"):
                return tenant

        if last_error:
            raise ValueError(f"Unable to load RGW user '{uid}': {last_error}") from last_error
        raise ValueError(f"RGW user '{uid}' was not found.")

    def rotate_identity_access_key(
        self,
        admin: RGWAdminClient,
        *,
        uid: str,
        tenant: Optional[str],
        previous_access_key: Optional[str],
        deactivate_only: bool,
    ) -> tuple[str, str, Optional[str], Optional[str]]:
        old_access_key = normalize_optional_string(previous_access_key)
        response, active_tenant = self._create_access_key_with_fallback(
            admin,
            uid=uid,
            tenant=tenant,
        )
        new_access_key, new_secret_key = RgwUserKeyParser.select_credentials(
            admin.extract_keys(response),
            exclude_access_key=old_access_key,
        )
        if not new_access_key or not new_secret_key:
            raise ValueError(f"RGW did not return the new key pair for '{uid}'.")
        if old_access_key and new_access_key == old_access_key:
            raise ValueError(
                f"RGW returned the existing key for '{uid}' instead of generating a new one."
            )

        retired_action: Optional[str] = None
        if old_access_key:
            retired_action = self._retire_previous_key(
                admin=admin,
                uid=uid,
                tenant=active_tenant,
                previous_access_key=old_access_key,
                deactivate_only=deactivate_only,
                new_access_key=new_access_key,
            )

        return new_access_key, new_secret_key, retired_action, active_tenant

    def cleanup_new_key(
        self,
        admin: RGWAdminClient,
        *,
        uid: str,
        access_key: Optional[str],
        tenant: Optional[str],
    ) -> None:
        candidate = normalize_optional_string(access_key)
        if not candidate:
            return
        try:
            admin.delete_access_key(uid, candidate, tenant=tenant)
        except RGWAdminError:
            logger.warning(
                "Unable to clean up newly created key '%s' for '%s'",
                candidate,
                uid,
            )

    def resolve_identity_from_access_key(
        self,
        admin: RGWAdminClient,
        access_key: str,
    ) -> tuple[str, Optional[str]]:
        try:
            payload = admin.get_user_by_access_key(access_key, allow_not_found=True)
        except RGWAdminError as exc:
            raise ValueError(f"Unable to resolve RGW user for access key: {exc}") from exc
        if not payload:
            raise ValueError("Access key is not associated with an RGW user.")

        candidates: list[dict] = []
        if isinstance(payload, dict):
            candidates.append(payload)
            nested_user = payload.get("user")
            if isinstance(nested_user, dict):
                candidates.append(nested_user)

        uid: Optional[str] = None
        tenant: Optional[str] = None
        for candidate in candidates:
            for field_name in ("uid", "user_id", "user"):
                normalized = normalize_optional_string(candidate.get(field_name))
                if normalized:
                    uid = normalized
                    break
            if uid:
                break

        for candidate in candidates:
            for field_name in ("tenant", "account_id"):
                normalized = normalize_optional_string(candidate.get(field_name))
                if normalized:
                    tenant = normalized
                    break
            if tenant:
                break

        if uid and "$" in uid and not tenant:
            split_tenant, split_uid = uid.split("$", 1)
            if split_tenant and split_uid:
                tenant = split_tenant
                uid = split_uid

        if not uid:
            raise ValueError("Unable to resolve RGW user identity for this access key.")
        return uid, tenant

    @staticmethod
    def mask_access_key(value: Optional[str]) -> Optional[str]:
        normalized = normalize_optional_string(value)
        if not normalized:
            return None
        if len(normalized) <= 8:
            return "***" + normalized[-2:]
        return f"{normalized[:4]}***{normalized[-4:]}"

    def _create_access_key_with_fallback(
        self,
        admin: RGWAdminClient,
        *,
        uid: str,
        tenant: Optional[str],
    ) -> tuple[dict, Optional[str]]:
        attempts: list[Optional[str]] = []
        for candidate in (normalize_optional_string(tenant), None):
            if candidate in attempts:
                continue
            attempts.append(candidate)

        last_error: Optional[Exception] = None
        for candidate in attempts:
            try:
                response = admin.create_access_key(uid, tenant=candidate)
                return response, candidate
            except RGWAdminError as exc:
                last_error = exc

        raise ValueError(
            f"Unable to create a new access key for '{uid}': {last_error}"
        ) from last_error

    def _retire_previous_key(
        self,
        *,
        admin: RGWAdminClient,
        uid: str,
        tenant: Optional[str],
        previous_access_key: str,
        deactivate_only: bool,
        new_access_key: str,
    ) -> str:
        try:
            if deactivate_only:
                admin.set_access_key_status(
                    uid,
                    previous_access_key,
                    enabled=False,
                    tenant=tenant,
                )
                return "disabled"
            admin.delete_access_key(uid, previous_access_key, tenant=tenant)
            return "deleted"
        except RGWAdminError as exc:
            self.cleanup_new_key(
                admin,
                uid=uid,
                access_key=new_access_key,
                tenant=tenant,
            )
            action = "disable" if deactivate_only else "delete"
            raise ValueError(
                f"Unable to {action} previous key for '{uid}': {exc}"
            ) from exc
