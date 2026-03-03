# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import logging
from typing import Optional

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.db import S3Account, S3User, StorageEndpoint, StorageProvider
from app.models.key_rotation import (
    KeyRotationRequest,
    KeyRotationResponse,
    KeyRotationResultItem,
    KeyRotationSummary,
    KeyRotationType,
)
from app.services.rgw_admin import RGWAdminClient, RGWAdminError, get_rgw_admin_client
from app.utils.storage_endpoint_features import resolve_admin_endpoint

logger = logging.getLogger(__name__)


class KeyRotationService:
    _KEY_TYPE_ORDER: tuple[KeyRotationType, ...] = (
        KeyRotationType.ACCOUNT,
        KeyRotationType.S3_USER,
        KeyRotationType.ENDPOINT_SUPERVISION,
        KeyRotationType.CEPH_ADMIN,
        KeyRotationType.ENDPOINT_ADMIN,
    )

    def __init__(self, db: Session) -> None:
        self.db = db

    def rotate_keys(self, payload: KeyRotationRequest) -> KeyRotationResponse:
        endpoints = (
            self.db.query(StorageEndpoint)
            .filter(StorageEndpoint.id.in_(payload.endpoint_ids))
            .order_by(StorageEndpoint.id.asc())
            .all()
        )
        by_id = {endpoint.id: endpoint for endpoint in endpoints}
        missing_ids = [endpoint_id for endpoint_id in payload.endpoint_ids if endpoint_id not in by_id]
        if missing_ids:
            missing = ", ".join(str(entry) for entry in missing_ids)
            raise ValueError(f"Storage endpoint(s) not found: {missing}")

        selected_types = self._ordered_key_types(payload.key_types)
        results: list[KeyRotationResultItem] = []
        deleted_old_keys = 0
        disabled_old_keys = 0

        for endpoint_id in payload.endpoint_ids:
            endpoint = by_id[endpoint_id]
            for key_type in selected_types:
                handler_results, deleted_count, disabled_count = self._rotate_by_type(
                    endpoint=endpoint,
                    key_type=key_type,
                    deactivate_only=payload.deactivate_only,
                )
                results.extend(handler_results)
                deleted_old_keys += deleted_count
                disabled_old_keys += disabled_count

        summary = KeyRotationSummary(
            total=len(results),
            rotated=sum(1 for item in results if item.status == "rotated"),
            failed=sum(1 for item in results if item.status == "failed"),
            skipped=sum(1 for item in results if item.status == "skipped"),
            deleted_old_keys=deleted_old_keys,
            disabled_old_keys=disabled_old_keys,
        )
        return KeyRotationResponse(
            mode="deactivate_old_keys" if payload.deactivate_only else "delete_old_keys",
            summary=summary,
            results=results,
        )

    def _ordered_key_types(self, key_types: list[KeyRotationType]) -> list[KeyRotationType]:
        selected = set(key_types)
        return [entry for entry in self._KEY_TYPE_ORDER if entry in selected]

    def _rotate_by_type(
        self,
        *,
        endpoint: StorageEndpoint,
        key_type: KeyRotationType,
        deactivate_only: bool,
    ) -> tuple[list[KeyRotationResultItem], int, int]:
        if key_type == KeyRotationType.ACCOUNT:
            return self._rotate_account_keys(endpoint, key_type, deactivate_only)
        if key_type == KeyRotationType.S3_USER:
            return self._rotate_s3_user_keys(endpoint, key_type, deactivate_only)
        if key_type == KeyRotationType.ENDPOINT_ADMIN:
            return self._rotate_endpoint_identity_key(
                endpoint,
                key_type,
                access_key_field="admin_access_key",
                secret_key_field="admin_secret_key",
                deactivate_only=deactivate_only,
            )
        if key_type == KeyRotationType.ENDPOINT_SUPERVISION:
            return self._rotate_endpoint_supervision_key(endpoint, key_type, deactivate_only)
        if key_type == KeyRotationType.CEPH_ADMIN:
            return self._rotate_endpoint_identity_key(
                endpoint,
                key_type,
                access_key_field="ceph_admin_access_key",
                secret_key_field="ceph_admin_secret_key",
                deactivate_only=deactivate_only,
            )
        return (
            [
                self._build_result(
                    endpoint=endpoint,
                    key_type=key_type,
                    target_type="endpoint",
                    target_id=str(endpoint.id),
                    target_label=endpoint.name,
                    status="failed",
                    message=f"Unsupported key type: {key_type.value}",
                )
            ],
            0,
            0,
        )

    def _rotate_account_keys(
        self,
        endpoint: StorageEndpoint,
        key_type: KeyRotationType,
        deactivate_only: bool,
    ) -> tuple[list[KeyRotationResultItem], int, int]:
        error = self._validate_ceph_admin_api(endpoint)
        if error:
            return (
                [
                    self._build_result(
                        endpoint=endpoint,
                        key_type=key_type,
                        target_type="endpoint",
                        target_id=str(endpoint.id),
                        target_label=endpoint.name,
                        status="failed",
                        message=error,
                    )
                ],
                0,
                0,
            )

        try:
            admin = self._build_endpoint_admin_client(endpoint)
        except ValueError as exc:
            return (
                [
                    self._build_result(
                        endpoint=endpoint,
                        key_type=key_type,
                        target_type="endpoint",
                        target_id=str(endpoint.id),
                        target_label=endpoint.name,
                        status="failed",
                        message=str(exc),
                    )
                ],
                0,
                0,
            )

        accounts = self._list_accounts_for_endpoint(endpoint)
        if not accounts:
            return (
                [
                    self._build_result(
                        endpoint=endpoint,
                        key_type=key_type,
                        target_type="account",
                        status="skipped",
                        message="No accounts found for this endpoint.",
                    )
                ],
                0,
                0,
            )

        results: list[KeyRotationResultItem] = []
        deleted_old_keys = 0
        disabled_old_keys = 0

        for account in accounts:
            account_label = account.name or account.rgw_account_id or f"#{account.id}"
            if not account.rgw_user_uid:
                results.append(
                    self._build_result(
                        endpoint=endpoint,
                        key_type=key_type,
                        target_type="account",
                        target_id=str(account.id),
                        target_label=account_label,
                        status="failed",
                        message="Account RGW root user is missing.",
                    )
                )
                continue

            old_access_key = self._clean_key(account.rgw_access_key)
            new_access_key: Optional[str] = None
            active_tenant: Optional[str] = None
            try:
                active_tenant = self._detect_user_tenant(
                    admin,
                    uid=account.rgw_user_uid,
                    preferred_tenant=account.rgw_account_id,
                )
                (
                    new_access_key,
                    new_secret_key,
                    retired_action,
                    active_tenant,
                ) = self._rotate_identity_access_key(
                    admin,
                    uid=account.rgw_user_uid,
                    tenant=active_tenant,
                    previous_access_key=old_access_key,
                    deactivate_only=deactivate_only,
                )
                account.rgw_access_key = new_access_key
                account.rgw_secret_key = new_secret_key
                self.db.add(account)
                self.db.commit()
                self.db.refresh(account)

                if retired_action == "deleted":
                    deleted_old_keys += 1
                elif retired_action == "disabled":
                    disabled_old_keys += 1

                results.append(
                    self._build_result(
                        endpoint=endpoint,
                        key_type=key_type,
                        target_type="account",
                        target_id=str(account.id),
                        target_label=account_label,
                        status="rotated",
                        message="Account interface key rotated.",
                        old_access_key=self._mask_access_key(old_access_key),
                        new_access_key=self._mask_access_key(new_access_key),
                    )
                )
            except ValueError as exc:
                self.db.rollback()
                if new_access_key and new_access_key != old_access_key:
                    self._cleanup_new_key(
                        admin,
                        uid=account.rgw_user_uid,
                        access_key=new_access_key,
                        tenant=active_tenant,
                    )
                results.append(
                    self._build_result(
                        endpoint=endpoint,
                        key_type=key_type,
                        target_type="account",
                        target_id=str(account.id),
                        target_label=account_label,
                        status="failed",
                        message=str(exc),
                    )
                )

        return results, deleted_old_keys, disabled_old_keys

    def _rotate_endpoint_supervision_key(
        self,
        endpoint: StorageEndpoint,
        key_type: KeyRotationType,
        deactivate_only: bool,
    ) -> tuple[list[KeyRotationResultItem], int, int]:
        error = self._validate_ceph_admin_api(endpoint)
        if error:
            return (
                [
                    self._build_result(
                        endpoint=endpoint,
                        key_type=key_type,
                        target_type="endpoint",
                        target_id=str(endpoint.id),
                        target_label=endpoint.name,
                        status="failed",
                        message=error,
                    )
                ],
                0,
                0,
            )

        old_access_key = self._clean_key(endpoint.supervision_access_key)
        old_secret_key = self._clean_key(endpoint.supervision_secret_key)
        if not old_access_key or not old_secret_key:
            return (
                [
                    self._build_result(
                        endpoint=endpoint,
                        key_type=key_type,
                        target_type="endpoint",
                        target_id=str(endpoint.id),
                        target_label=endpoint.name,
                        status="skipped",
                        message="Endpoint field 'supervision_access_key' is not configured.",
                    )
                ],
                0,
                0,
            )

        admin_access_key = self._clean_key(endpoint.admin_access_key)
        admin_secret_key = self._clean_key(endpoint.admin_secret_key)
        if not admin_access_key or not admin_secret_key:
            return (
                [
                    self._build_result(
                        endpoint=endpoint,
                        key_type=key_type,
                        target_type="endpoint",
                        target_id=str(endpoint.id),
                        target_label=endpoint.name,
                        status="skipped",
                        message="Admin Ops credentials are missing; supervision key rotation skipped.",
                    )
                ],
                0,
                0,
            )

        try:
            admin_client = self._build_direct_client(
                endpoint=endpoint,
                access_key=admin_access_key,
                secret_key=admin_secret_key,
            )
            uid, tenant = self._resolve_identity_from_access_key(admin_client, old_access_key)
            (
                new_access_key,
                new_secret_key,
                retired_action,
                _,
            ) = self._rotate_identity_access_key(
                admin_client,
                uid=uid,
                tenant=tenant,
                previous_access_key=old_access_key,
                deactivate_only=deactivate_only,
            )
            endpoint.supervision_access_key = new_access_key
            endpoint.supervision_secret_key = new_secret_key
            self.db.add(endpoint)
            self.db.commit()
            self.db.refresh(endpoint)
        except ValueError as exc:
            self.db.rollback()
            return (
                [
                    self._build_result(
                        endpoint=endpoint,
                        key_type=key_type,
                        target_type="endpoint",
                        target_id=str(endpoint.id),
                        target_label=endpoint.name,
                        status="failed",
                        message=str(exc),
                    )
                ],
                0,
                0,
            )

        deleted_old_keys = 1 if retired_action == "deleted" else 0
        disabled_old_keys = 1 if retired_action == "disabled" else 0
        return (
            [
                self._build_result(
                    endpoint=endpoint,
                    key_type=key_type,
                    target_type="endpoint",
                    target_id=str(endpoint.id),
                    target_label=endpoint.name,
                    status="rotated",
                    message="Endpoint supervision credential rotated via Admin Ops identity.",
                    old_access_key=self._mask_access_key(old_access_key),
                    new_access_key=self._mask_access_key(endpoint.supervision_access_key),
                )
            ],
            deleted_old_keys,
            disabled_old_keys,
        )

    def _rotate_s3_user_keys(
        self,
        endpoint: StorageEndpoint,
        key_type: KeyRotationType,
        deactivate_only: bool,
    ) -> tuple[list[KeyRotationResultItem], int, int]:
        error = self._validate_ceph_admin_api(endpoint)
        if error:
            return (
                [
                    self._build_result(
                        endpoint=endpoint,
                        key_type=key_type,
                        target_type="endpoint",
                        target_id=str(endpoint.id),
                        target_label=endpoint.name,
                        status="failed",
                        message=error,
                    )
                ],
                0,
                0,
            )

        try:
            admin = self._build_endpoint_admin_client(endpoint)
        except ValueError as exc:
            return (
                [
                    self._build_result(
                        endpoint=endpoint,
                        key_type=key_type,
                        target_type="endpoint",
                        target_id=str(endpoint.id),
                        target_label=endpoint.name,
                        status="failed",
                        message=str(exc),
                    )
                ],
                0,
                0,
            )

        s3_users = self._list_s3_users_for_endpoint(endpoint)
        if not s3_users:
            return (
                [
                    self._build_result(
                        endpoint=endpoint,
                        key_type=key_type,
                        target_type="s3_user",
                        status="skipped",
                        message="No S3 users found for this endpoint.",
                    )
                ],
                0,
                0,
            )

        results: list[KeyRotationResultItem] = []
        deleted_old_keys = 0
        disabled_old_keys = 0

        for s3_user in s3_users:
            user_label = s3_user.name or s3_user.rgw_user_uid
            old_access_key = self._clean_key(s3_user.rgw_access_key)
            new_access_key: Optional[str] = None
            active_tenant: Optional[str] = None
            try:
                active_tenant = self._detect_user_tenant(
                    admin,
                    uid=s3_user.rgw_user_uid,
                    preferred_tenant=None,
                )
                (
                    new_access_key,
                    new_secret_key,
                    retired_action,
                    active_tenant,
                ) = self._rotate_identity_access_key(
                    admin,
                    uid=s3_user.rgw_user_uid,
                    tenant=active_tenant,
                    previous_access_key=old_access_key,
                    deactivate_only=deactivate_only,
                )
                s3_user.rgw_access_key = new_access_key
                s3_user.rgw_secret_key = new_secret_key
                self.db.add(s3_user)
                self.db.commit()
                self.db.refresh(s3_user)

                if retired_action == "deleted":
                    deleted_old_keys += 1
                elif retired_action == "disabled":
                    disabled_old_keys += 1

                results.append(
                    self._build_result(
                        endpoint=endpoint,
                        key_type=key_type,
                        target_type="s3_user",
                        target_id=str(s3_user.id),
                        target_label=user_label,
                        status="rotated",
                        message="S3 user interface key rotated.",
                        old_access_key=self._mask_access_key(old_access_key),
                        new_access_key=self._mask_access_key(new_access_key),
                    )
                )
            except ValueError as exc:
                self.db.rollback()
                if new_access_key and new_access_key != old_access_key:
                    self._cleanup_new_key(
                        admin,
                        uid=s3_user.rgw_user_uid,
                        access_key=new_access_key,
                        tenant=active_tenant,
                    )
                results.append(
                    self._build_result(
                        endpoint=endpoint,
                        key_type=key_type,
                        target_type="s3_user",
                        target_id=str(s3_user.id),
                        target_label=user_label,
                        status="failed",
                        message=str(exc),
                    )
                )

        return results, deleted_old_keys, disabled_old_keys

    def _rotate_endpoint_identity_key(
        self,
        endpoint: StorageEndpoint,
        key_type: KeyRotationType,
        *,
        access_key_field: str,
        secret_key_field: str,
        deactivate_only: bool,
    ) -> tuple[list[KeyRotationResultItem], int, int]:
        error = self._validate_ceph_admin_api(endpoint)
        if error:
            return (
                [
                    self._build_result(
                        endpoint=endpoint,
                        key_type=key_type,
                        target_type="endpoint",
                        target_id=str(endpoint.id),
                        target_label=endpoint.name,
                        status="failed",
                        message=error,
                    )
                ],
                0,
                0,
            )

        old_access_key = self._clean_key(getattr(endpoint, access_key_field))
        old_secret_key = self._clean_key(getattr(endpoint, secret_key_field))
        if not old_access_key or not old_secret_key:
            return (
                [
                    self._build_result(
                        endpoint=endpoint,
                        key_type=key_type,
                        target_type="endpoint",
                        target_id=str(endpoint.id),
                        target_label=endpoint.name,
                        status="skipped",
                        message=f"Endpoint field '{access_key_field}' is not configured.",
                    )
                ],
                0,
                0,
            )

        try:
            direct_admin = self._build_direct_client(
                endpoint=endpoint,
                access_key=old_access_key,
                secret_key=old_secret_key,
            )
            uid, tenant = self._resolve_identity_from_access_key(direct_admin, old_access_key)
            (
                new_access_key,
                new_secret_key,
                retired_action,
                _,
            ) = self._rotate_identity_access_key(
                direct_admin,
                uid=uid,
                tenant=tenant,
                previous_access_key=old_access_key,
                deactivate_only=deactivate_only,
            )
            setattr(endpoint, access_key_field, new_access_key)
            setattr(endpoint, secret_key_field, new_secret_key)
            self.db.add(endpoint)
            self.db.commit()
            self.db.refresh(endpoint)
        except ValueError as exc:
            self.db.rollback()
            return (
                [
                    self._build_result(
                        endpoint=endpoint,
                        key_type=key_type,
                        target_type="endpoint",
                        target_id=str(endpoint.id),
                        target_label=endpoint.name,
                        status="failed",
                        message=str(exc),
                    )
                ],
                0,
                0,
            )

        deleted_old_keys = 1 if retired_action == "deleted" else 0
        disabled_old_keys = 1 if retired_action == "disabled" else 0
        message = f"Endpoint credential '{access_key_field}' rotated."
        return (
            [
                self._build_result(
                    endpoint=endpoint,
                    key_type=key_type,
                    target_type="endpoint",
                    target_id=str(endpoint.id),
                    target_label=endpoint.name,
                    status="rotated",
                    message=message,
                    old_access_key=self._mask_access_key(old_access_key),
                    new_access_key=self._mask_access_key(getattr(endpoint, access_key_field)),
                )
            ],
            deleted_old_keys,
            disabled_old_keys,
        )

    def _build_result(
        self,
        *,
        endpoint: StorageEndpoint,
        key_type: KeyRotationType,
        target_type: str,
        status: str,
        target_id: Optional[str] = None,
        target_label: Optional[str] = None,
        message: Optional[str] = None,
        old_access_key: Optional[str] = None,
        new_access_key: Optional[str] = None,
    ) -> KeyRotationResultItem:
        return KeyRotationResultItem(
            endpoint_id=int(endpoint.id),
            endpoint_name=endpoint.name or f"#{endpoint.id}",
            key_type=key_type,
            target_type=target_type,
            target_id=target_id,
            target_label=target_label,
            status=status,
            message=message,
            old_access_key=old_access_key,
            new_access_key=new_access_key,
        )

    def _validate_ceph_admin_api(self, endpoint: StorageEndpoint) -> Optional[str]:
        provider = StorageProvider(str(endpoint.provider))
        if provider != StorageProvider.CEPH:
            return "Key rotation is only supported for Ceph endpoints."
        admin_endpoint = resolve_admin_endpoint(endpoint)
        if not admin_endpoint:
            return "Admin feature is disabled or admin endpoint is not configured."
        return None

    def _build_endpoint_admin_client(self, endpoint: StorageEndpoint) -> RGWAdminClient:
        if not endpoint.admin_access_key or not endpoint.admin_secret_key:
            raise ValueError("Endpoint admin credentials are not configured.")
        return self._build_direct_client(
            endpoint=endpoint,
            access_key=endpoint.admin_access_key,
            secret_key=endpoint.admin_secret_key,
        )

    def _build_direct_client(
        self,
        *,
        endpoint: StorageEndpoint,
        access_key: str,
        secret_key: str,
    ) -> RGWAdminClient:
        admin_endpoint = resolve_admin_endpoint(endpoint)
        if not admin_endpoint:
            raise ValueError("Admin feature is disabled or admin endpoint is not configured.")
        try:
            return get_rgw_admin_client(
                access_key=access_key,
                secret_key=secret_key,
                endpoint=admin_endpoint,
                region=endpoint.region,
                verify_tls=bool(getattr(endpoint, "verify_tls", True)),
            )
        except RGWAdminError as exc:
            raise ValueError(f"Unable to build RGW admin client: {exc}") from exc

    def _list_accounts_for_endpoint(self, endpoint: StorageEndpoint) -> list[S3Account]:
        query = self.db.query(S3Account)
        if endpoint.is_default:
            query = query.filter(
                or_(S3Account.storage_endpoint_id == endpoint.id, S3Account.storage_endpoint_id.is_(None))
            )
        else:
            query = query.filter(S3Account.storage_endpoint_id == endpoint.id)
        return query.order_by(S3Account.id.asc()).all()

    def _list_s3_users_for_endpoint(self, endpoint: StorageEndpoint) -> list[S3User]:
        query = self.db.query(S3User)
        if endpoint.is_default:
            query = query.filter(
                or_(S3User.storage_endpoint_id == endpoint.id, S3User.storage_endpoint_id.is_(None))
            )
        else:
            query = query.filter(S3User.storage_endpoint_id == endpoint.id)
        return query.order_by(S3User.id.asc()).all()

    def _detect_user_tenant(
        self,
        admin: RGWAdminClient,
        *,
        uid: str,
        preferred_tenant: Optional[str],
    ) -> Optional[str]:
        attempts: list[Optional[str]] = []
        for candidate in (self._clean_key(preferred_tenant), None):
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

    def _create_access_key_with_fallback(
        self,
        admin: RGWAdminClient,
        *,
        uid: str,
        tenant: Optional[str],
    ) -> tuple[dict, Optional[str]]:
        attempts: list[Optional[str]] = []
        for candidate in (self._clean_key(tenant), None):
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

        raise ValueError(f"Unable to create a new access key for '{uid}': {last_error}") from last_error

    def _rotate_identity_access_key(
        self,
        admin: RGWAdminClient,
        *,
        uid: str,
        tenant: Optional[str],
        previous_access_key: Optional[str],
        deactivate_only: bool,
    ) -> tuple[str, str, Optional[str], Optional[str]]:
        old_access_key = self._clean_key(previous_access_key)
        response, active_tenant = self._create_access_key_with_fallback(admin, uid=uid, tenant=tenant)
        new_access_key, new_secret_key = self._extract_new_key_pair(
            admin,
            response,
            exclude_access_key=old_access_key,
        )
        if not new_access_key or not new_secret_key:
            raise ValueError(f"RGW did not return the new key pair for '{uid}'.")
        if old_access_key and new_access_key == old_access_key:
            raise ValueError(f"RGW returned the existing key for '{uid}' instead of generating a new one.")

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
                admin.set_access_key_status(uid, previous_access_key, enabled=False, tenant=tenant)
                return "disabled"
            admin.delete_access_key(uid, previous_access_key, tenant=tenant)
            return "deleted"
        except RGWAdminError as exc:
            self._cleanup_new_key(admin, uid=uid, access_key=new_access_key, tenant=tenant)
            action = "disable" if deactivate_only else "delete"
            raise ValueError(f"Unable to {action} previous key for '{uid}': {exc}") from exc

    def _cleanup_new_key(
        self,
        admin: RGWAdminClient,
        *,
        uid: str,
        access_key: Optional[str],
        tenant: Optional[str],
    ) -> None:
        candidate = self._clean_key(access_key)
        if not candidate:
            return
        try:
            admin.delete_access_key(uid, candidate, tenant=tenant)
        except RGWAdminError:
            logger.warning("Unable to clean up newly created key '%s' for '%s'", candidate, uid)

    def _extract_new_key_pair(
        self,
        admin: RGWAdminClient,
        response: Optional[dict],
        *,
        exclude_access_key: Optional[str] = None,
    ) -> tuple[Optional[str], Optional[str]]:
        if not response:
            return None, None
        entries = admin._extract_keys(response)
        if not entries:
            return None, None
        excluded = self._clean_key(exclude_access_key)

        def _access(entry: dict) -> Optional[str]:
            return self._clean_key(entry.get("access_key") or entry.get("access-key"))

        def _secret(entry: dict) -> Optional[str]:
            return self._clean_key(entry.get("secret_key") or entry.get("secret-key"))

        for require_secret in (True, False):
            for entry in entries:
                if not isinstance(entry, dict):
                    continue
                access_key = _access(entry)
                secret_key = _secret(entry)
                if not access_key:
                    continue
                if excluded and access_key == excluded:
                    continue
                if require_secret and not secret_key:
                    continue
                return access_key, secret_key

        for entry in entries:
            if not isinstance(entry, dict):
                continue
            access_key = _access(entry)
            secret_key = _secret(entry)
            if access_key and secret_key:
                return access_key, secret_key

        return None, None

    def _resolve_identity_from_access_key(
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
                field_value = candidate.get(field_name)
                normalized = self._clean_key(field_value if isinstance(field_value, str) else None)
                if normalized:
                    uid = normalized
                    break
            if uid:
                break

        for candidate in candidates:
            for field_name in ("tenant", "account_id"):
                field_value = candidate.get(field_name)
                normalized = self._clean_key(field_value if isinstance(field_value, str) else None)
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

    def _clean_key(self, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None

    def _mask_access_key(self, value: Optional[str]) -> Optional[str]:
        normalized = self._clean_key(value)
        if not normalized:
            return None
        if len(normalized) <= 8:
            return "***" + normalized[-2:]
        return f"{normalized[:4]}***{normalized[-4:]}"


def get_key_rotation_service(db: Session) -> KeyRotationService:
    return KeyRotationService(db)
