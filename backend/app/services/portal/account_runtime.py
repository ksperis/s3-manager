# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import logging
from typing import Optional

from app.db import S3Account, StorageEndpoint
from app.services.rgw_admin import RGWAdminClient, RGWAdminError, get_rgw_admin_client
from app.services.rgw_supervision import get_supervision_rgw_client
from app.utils.quota_stats import extract_positive_limit, extract_quota_limits
from app.utils.rgw_payloads import extract_bucket_list
from app.utils.s3_endpoint import resolve_s3_client_kwargs
from app.utils.storage_endpoint_features import resolve_admin_endpoint, resolve_feature_flags


logger = logging.getLogger(__name__)


class PortalAccountRuntimeMixin:
    def _is_active_status(self, status: Optional[str], default: bool = True) -> bool:
        if status is None:
            return default
        normalized = status.strip().lower()
        if not normalized:
            return default
        if normalized == "active":
            return True
        if normalized == "inactive":
            return False
        return default

    def _account_credentials(self, account: S3Account) -> tuple[str, str]:
        access_key, secret_key = account.effective_rgw_credentials()
        if not access_key or not secret_key:
            raise RuntimeError("S3Account is missing root credentials")
        return access_key, secret_key

    def _s3_client_kwargs(self, account: S3Account) -> dict:
        return resolve_s3_client_kwargs(account)

    def _supervision_admin_for_account(self, account: S3Account) -> RGWAdminClient:
        endpoint = getattr(account, "storage_endpoint", None)
        if endpoint is None and account.storage_endpoint_id:
            endpoint = (
                self.db.query(StorageEndpoint)
                .filter(StorageEndpoint.id == account.storage_endpoint_id)
                .first()
            )
        if not endpoint:
            raise RuntimeError("Endpoint de supervision manquant pour ce compte")
        flags = resolve_feature_flags(endpoint)
        if not flags.metrics_enabled:
            raise RuntimeError("Storage metrics are disabled for this endpoint")
        try:
            return get_supervision_rgw_client(endpoint)
        except ValueError as exc:
            raise RuntimeError("Supervision credentials are missing for this endpoint.") from exc

    def _quota_admin_for_account(self, account: S3Account) -> Optional[RGWAdminClient]:
        endpoint = getattr(account, "storage_endpoint", None)
        if endpoint is None and account.storage_endpoint_id:
            endpoint = (
                self.db.query(StorageEndpoint)
                .filter(StorageEndpoint.id == account.storage_endpoint_id)
                .first()
            )
        if not endpoint:
            return None
        admin_endpoint = resolve_admin_endpoint(endpoint)
        access_key = getattr(endpoint, "admin_access_key", None)
        secret_key = getattr(endpoint, "admin_secret_key", None)
        if not admin_endpoint or not access_key or not secret_key:
            return None
        try:
            return get_rgw_admin_client(
                access_key=access_key,
                secret_key=secret_key,
                endpoint=admin_endpoint,
                region=endpoint.region,
                verify_tls=bool(getattr(endpoint, "verify_tls", True)),
            )
        except Exception as exc:
            logger.warning("Unable to build admin client for quota lookup: %s", exc)
            return None

    def _account_quota(self, account: S3Account) -> tuple[Optional[int], Optional[int]]:
        admin = self._quota_admin_for_account(account)
        if not admin:
            return None, None
        try:
            return admin.get_account_quota(account.rgw_account_id)
        except RGWAdminError as exc:
            logger.warning("Unable to fetch portal quota for %s: %s", account.rgw_account_id, exc)
            return None, None

    def _account_limits(self, account: S3Account) -> tuple[Optional[int], Optional[int], Optional[int]]:
        admin = self._quota_admin_for_account(account)
        if not admin:
            return None, None, None
        try:
            payload = admin.get_account(
                account.rgw_account_id,
                allow_not_found=True,
                allow_not_implemented=True,
            ) or {}
        except RGWAdminError as exc:
            logger.warning("Unable to fetch portal account limits for %s: %s", account.rgw_account_id, exc)
            return None, None, None
        max_size_bytes, max_objects = extract_quota_limits(payload, keys=("quota", "account_quota"))
        if max_size_bytes is None and max_objects is None:
            try:
                max_size_bytes, max_objects = admin.get_account_quota(account.rgw_account_id)
            except RGWAdminError as exc:
                logger.warning("Unable to fetch portal quota fallback for %s: %s", account.rgw_account_id, exc)
        return max_size_bytes, max_objects, extract_positive_limit(payload, "max_buckets")

    def _admin_bucket_list(self, account: S3Account, admin: Optional[RGWAdminClient] = None) -> list[dict]:
        rgw_admin = admin or self._supervision_admin_for_account(account)
        payload = rgw_admin.get_all_buckets(uid=account.rgw_user_uid, with_stats=True)
        return extract_bucket_list(payload)

    def _admin_bucket_info(
        self,
        account: S3Account,
        bucket_name: str,
        admin: Optional[RGWAdminClient] = None,
    ) -> Optional[dict]:
        rgw_admin = admin or self._supervision_admin_for_account(account)
        bucket_info = rgw_admin.get_bucket_info(
            bucket_name,
            allow_not_found=True,
            uid=account.rgw_user_uid,
        )
        if bucket_info is None:
            bucket_info = rgw_admin.get_bucket_info(bucket_name, allow_not_found=True)
        return bucket_info
