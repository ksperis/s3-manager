# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Callable, Optional, Sequence

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.db import S3Account, S3User, StorageEndpoint
from app.models.key_rotation import (
    KeyRotationRequest,
    KeyRotationResponse,
    KeyRotationResultItem,
    KeyRotationSummary,
    KeyRotationType,
)
from app.services.key_rotation_rgw import RgwAccessKeyRotator
from app.services.rgw_admin import RGWAdminClient
from app.services.rgw_endpoint_clients import get_endpoint_admin_rgw_client
from app.utils.normalize import (
    normalize_optional_string,
)
from app.core.sensitive_data import sanitized_error_log_detail


class KeyRotationService:
    _KEY_TYPE_ORDER: tuple[KeyRotationType, ...] = (
        KeyRotationType.ACCOUNT,
        KeyRotationType.S3_USER,
        KeyRotationType.ENDPOINT_SUPERVISION,
        KeyRotationType.CEPH_ADMIN,
        KeyRotationType.ENDPOINT_ADMIN,
    )
    _ENV_MANAGED_ENDPOINT_KEY_TYPES: frozenset[KeyRotationType] = frozenset(
        {
            KeyRotationType.ENDPOINT_ADMIN,
            KeyRotationType.ENDPOINT_SUPERVISION,
            KeyRotationType.CEPH_ADMIN,
        }
    )

    def __init__(self, db: Session) -> None:
        self.db = db
        self._rgw = RgwAccessKeyRotator(get_endpoint_admin_rgw_client)

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
        if key_type in self._ENV_MANAGED_ENDPOINT_KEY_TYPES and not endpoint.is_editable:
            return (
                [
                    self._build_result(
                        endpoint=endpoint,
                        key_type=key_type,
                        target_type="endpoint",
                        target_id=str(endpoint.id),
                        target_label=endpoint.name,
                        status="skipped",
                        message=(
                            "Endpoint credentials are managed by ENV_STORAGE_ENDPOINTS; "
                            "rotate this key externally and redeploy with the updated environment values."
                        ),
                    )
                ],
                0,
                0,
            )
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
        return self._rotate_persisted_identity_type(
            endpoint=endpoint,
            key_type=key_type,
            deactivate_only=deactivate_only,
            load_identities=self._list_accounts_for_endpoint,
            target_type="account",
            target_label=lambda account: account.name,
            preferred_tenant=lambda account: account.rgw_account_id,
            empty_message="No accounts found for this endpoint.",
            success_message="Account interface key rotated.",
        )

    def _rotate_endpoint_supervision_key(
        self,
        endpoint: StorageEndpoint,
        key_type: KeyRotationType,
        deactivate_only: bool,
    ) -> tuple[list[KeyRotationResultItem], int, int]:
        error = self._rgw.validate_ceph_admin_api(endpoint)
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

        old_access_key = normalize_optional_string(endpoint.supervision_access_key)
        old_secret_key = normalize_optional_string(endpoint.supervision_secret_key)
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

        admin_access_key = normalize_optional_string(endpoint.admin_access_key)
        admin_secret_key = normalize_optional_string(endpoint.admin_secret_key)
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
            admin_client = self._rgw.build_direct_client(
                endpoint=endpoint,
                access_key=admin_access_key,
                secret_key=admin_secret_key,
            )
            uid, tenant = self._rgw.resolve_identity_from_access_key(
                admin_client,
                old_access_key,
            )
            (
                new_access_key,
                new_secret_key,
                retired_action,
                _,
            ) = self._rgw.rotate_identity_access_key(
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
                        message=sanitized_error_log_detail(exc),
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
                    old_access_key=self._rgw.mask_access_key(old_access_key),
                    new_access_key=self._rgw.mask_access_key(
                        endpoint.supervision_access_key
                    ),
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
        return self._rotate_persisted_identity_type(
            endpoint=endpoint,
            key_type=key_type,
            deactivate_only=deactivate_only,
            load_identities=self._list_s3_users_for_endpoint,
            target_type="s3_user",
            target_label=lambda s3_user: s3_user.name or s3_user.rgw_user_uid,
            preferred_tenant=lambda _s3_user: None,
            empty_message="No S3 users found for this endpoint.",
            success_message="S3 user interface key rotated.",
        )

    def _rotate_persisted_identity_type(
        self,
        *,
        endpoint: StorageEndpoint,
        key_type: KeyRotationType,
        deactivate_only: bool,
        load_identities: Callable[
            [StorageEndpoint], Sequence[S3Account | S3User]
        ],
        target_type: str,
        target_label: Callable[[S3Account | S3User], Optional[str]],
        preferred_tenant: Callable[[S3Account | S3User], Optional[str]],
        empty_message: str,
        success_message: str,
    ) -> tuple[list[KeyRotationResultItem], int, int]:
        error = self._rgw.validate_ceph_admin_api(endpoint)
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
            admin = self._rgw.build_endpoint_admin_client(endpoint)
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
                        message=sanitized_error_log_detail(exc),
                    )
                ],
                0,
                0,
            )

        identities = load_identities(endpoint)
        if not identities:
            return (
                [
                    self._build_result(
                        endpoint=endpoint,
                        key_type=key_type,
                        target_type=target_type,
                        status="skipped",
                        message=empty_message,
                    )
                ],
                0,
                0,
            )

        return self._rotate_persisted_identity_keys(
            endpoint=endpoint,
            key_type=key_type,
            deactivate_only=deactivate_only,
            admin=admin,
            identities=identities,
            target_type=target_type,
            target_label=target_label,
            preferred_tenant=preferred_tenant,
            success_message=success_message,
        )

    def _rotate_persisted_identity_keys(
        self,
        *,
        endpoint: StorageEndpoint,
        key_type: KeyRotationType,
        deactivate_only: bool,
        admin: RGWAdminClient,
        identities: Sequence[S3Account | S3User],
        target_type: str,
        target_label: Callable[[S3Account | S3User], Optional[str]],
        preferred_tenant: Callable[[S3Account | S3User], Optional[str]],
        success_message: str,
    ) -> tuple[list[KeyRotationResultItem], int, int]:
        results: list[KeyRotationResultItem] = []
        deleted_old_keys = 0
        disabled_old_keys = 0

        for identity in identities:
            label = target_label(identity)
            old_access_key = normalize_optional_string(identity.rgw_access_key)
            new_access_key: Optional[str] = None
            active_tenant: Optional[str] = None
            try:
                active_tenant = self._rgw.detect_user_tenant(
                    admin,
                    uid=identity.rgw_user_uid,
                    preferred_tenant=preferred_tenant(identity),
                )
                (
                    new_access_key,
                    new_secret_key,
                    retired_action,
                    active_tenant,
                ) = self._rgw.rotate_identity_access_key(
                    admin,
                    uid=identity.rgw_user_uid,
                    tenant=active_tenant,
                    previous_access_key=old_access_key,
                    deactivate_only=deactivate_only,
                )
                identity.rgw_access_key = new_access_key
                identity.rgw_secret_key = new_secret_key
                self.db.add(identity)
                self.db.commit()
                self.db.refresh(identity)

                if retired_action == "deleted":
                    deleted_old_keys += 1
                elif retired_action == "disabled":
                    disabled_old_keys += 1

                results.append(
                    self._build_result(
                        endpoint=endpoint,
                        key_type=key_type,
                        target_type=target_type,
                        target_id=str(identity.id),
                        target_label=label,
                        status="rotated",
                        message=success_message,
                        old_access_key=self._rgw.mask_access_key(old_access_key),
                        new_access_key=self._rgw.mask_access_key(new_access_key),
                    )
                )
            except ValueError as exc:
                self.db.rollback()
                if new_access_key and new_access_key != old_access_key:
                    self._rgw.cleanup_new_key(
                        admin,
                        uid=identity.rgw_user_uid,
                        access_key=new_access_key,
                        tenant=active_tenant,
                    )
                results.append(
                    self._build_result(
                        endpoint=endpoint,
                        key_type=key_type,
                        target_type=target_type,
                        target_id=str(identity.id),
                        target_label=label,
                        status="failed",
                        message=sanitized_error_log_detail(exc),
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
        error = self._rgw.validate_ceph_admin_api(endpoint)
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

        old_access_key = normalize_optional_string(getattr(endpoint, access_key_field))
        old_secret_key = normalize_optional_string(getattr(endpoint, secret_key_field))
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
            direct_admin = self._rgw.build_direct_client(
                endpoint=endpoint,
                access_key=old_access_key,
                secret_key=old_secret_key,
            )
            uid, tenant = self._rgw.resolve_identity_from_access_key(
                direct_admin,
                old_access_key,
            )
            (
                new_access_key,
                new_secret_key,
                retired_action,
                _,
            ) = self._rgw.rotate_identity_access_key(
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
                        message=sanitized_error_log_detail(exc),
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
                    old_access_key=self._rgw.mask_access_key(old_access_key),
                    new_access_key=self._rgw.mask_access_key(
                        getattr(endpoint, access_key_field)
                    ),
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

def get_key_rotation_service(db: Session) -> KeyRotationService:
    return KeyRotationService(db)
