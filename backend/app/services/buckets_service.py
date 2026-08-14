# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from typing import Any, List, Optional
import logging

from app.services.s3_execution_context import S3ExecutionTarget
from app.services.s3_execution_client import (
    require_s3_execution_credentials,
    s3_execution_client_kwargs,
)
from app.services.bucket_configuration_service import BucketConfigurationService
from app.services import bucket_feature_enrichment
from app.services import (
    s3_client,
    s3_deletion,
)
from app.services.rgw_admin import RGWAdminError, get_rgw_admin_client
from app.models.bucket import Bucket
from app.services.rgw_supervision import get_supervision_credentials
from app.utils.rgw_identifiers import resolve_admin_uid
from app.utils.rgw_payloads import extract_bucket_list
from app.utils.storage_endpoint_features import resolve_admin_endpoint, resolve_feature_flags
from app.utils.usage_stats import extract_usage_stats

logger = logging.getLogger(__name__)


class BucketsService:
    def __init__(self, configuration: BucketConfigurationService | None = None) -> None:
        self.configuration = configuration or BucketConfigurationService()

    def _rgw_admin_for_account(self, account: S3ExecutionTarget):
        endpoint = getattr(account, "storage_endpoint", None)
        creds = get_supervision_credentials(account)
        if not creds or not endpoint:
            raise RuntimeError("Supervision credentials are not configured for this endpoint")
        flags = resolve_feature_flags(endpoint)
        if not flags.metrics_enabled:
            raise RuntimeError("Storage metrics are disabled for this endpoint")
        access_key, secret_key = creds
        try:
            admin_endpoint = resolve_admin_endpoint(endpoint)
            if not admin_endpoint:
                raise RuntimeError("Admin endpoint is not configured for this endpoint")
            return get_rgw_admin_client(
                access_key=access_key,
                secret_key=secret_key,
                endpoint=admin_endpoint,
                region=endpoint.region,
                verify_tls=bool(getattr(endpoint, "verify_tls", True)),
            )
        except RGWAdminError as exc:
            raise RuntimeError(f"Unable to initialize admin client: {exc}") from exc

    def _admin_bucket_list(self, account: S3ExecutionTarget, with_stats: bool = True) -> list[dict]:
        uid = resolve_admin_uid(account.rgw_account_id, account.rgw_user_uid)
        if not uid:
            return []
        rgw_admin = self._rgw_admin_for_account(account)
        try:
            payload = rgw_admin.get_all_buckets(uid=uid, with_stats=with_stats)
        except RGWAdminError as exc:
            raise RuntimeError(f"Unable to list buckets via admin API: {exc}") from exc
        return extract_bucket_list(payload)

    def _account_credentials(self, account: S3ExecutionTarget) -> tuple[str, str]:
        return require_s3_execution_credentials(
            account,
            error_message="S3ExecutionTarget is missing admin credentials",
        )

    def _client_kwargs(self, account: S3ExecutionTarget) -> dict:
        return s3_execution_client_kwargs(account)

    def _extract_quota_from_admin_stats(self, stats: Any) -> tuple[Optional[int], Optional[int]]:
        quota_size: Optional[int] = None
        quota_objects: Optional[int] = None
        quota = stats.get("bucket_quota") if isinstance(stats, dict) else None
        if isinstance(quota, dict):
            try:
                # RGW may expose both max_size (bytes) and max_size_kb (KiB).
                # Prefer max_size when available to avoid double-scaling.
                if quota.get("max_size") is not None:
                    quota_size = int(quota.get("max_size"))
                elif quota.get("max_size_kb") is not None:
                    quota_size = int(quota.get("max_size_kb")) * 1024
            except (TypeError, ValueError):
                quota_size = None
            try:
                if quota.get("max_objects") is not None:
                    quota_objects = int(quota.get("max_objects"))
            except (TypeError, ValueError):
                quota_objects = None
        return quota_size, quota_objects

    def list_buckets(
        self,
        account: S3ExecutionTarget,
        include: Optional[set[str]] = None,
        with_stats: bool = True,
    ) -> List[Bucket]:
        access_key, secret_key = self._account_credentials(account)
        buckets = s3_client.list_buckets(access_key=access_key, secret_key=secret_key, **self._client_kwargs(account))
        account_uid = resolve_admin_uid(account.rgw_account_id, account.rgw_user_uid)
        admin_by_name: dict[str, dict] = {}
        if account_uid and with_stats:
            endpoint = getattr(account, "storage_endpoint", None)
            storage_metrics_enabled = bool(resolve_feature_flags(endpoint).metrics_enabled) if endpoint else True
            if not storage_metrics_enabled:
                logger.debug(
                    "S3 execution context %s skipped RGW admin stats enrichment (storage metrics feature disabled)",
                    account.rgw_account_id or account.id,
                )
            else:
                try:
                    admin_list = self._admin_bucket_list(account, with_stats=True)
                    logger.debug(
                        "S3 execution context %s fetched %s bucket stats via RGW admin",
                        account.rgw_account_id or account.id,
                        len(admin_list),
                    )
                    admin_by_name = {
                        entry.get("bucket") or entry.get("name"): entry
                        for entry in admin_list
                        if isinstance(entry, dict) and (entry.get("bucket") or entry.get("name"))
                    }
                except RuntimeError as exc:
                    logger.warning("Unable to fetch admin bucket stats for %s: %s", account.rgw_account_id or account.id, exc)
        elif account_uid and not with_stats:
            logger.debug("S3 execution context %s skipped RGW admin stats enrichment", account.rgw_account_id or account.id)
        logger.debug("S3 execution context %s listed %s buckets", account.rgw_account_id or account.id, len(buckets))
        enriched: list[Bucket] = []
        for b in buckets:
            bucket_name = None
            if isinstance(b, dict):
                bucket_name = b.get("name")
            if not bucket_name:
                continue
            usage_bytes: Optional[int] = None
            objects: Optional[int] = None
            quota_size: Optional[int] = None
            quota_objects: Optional[int] = None
            stats = admin_by_name.get(bucket_name)
            usage = stats.get("usage") if isinstance(stats, dict) else None
            usage_bytes, objects = extract_usage_stats(usage)
            quota_size, quota_objects = self._extract_quota_from_admin_stats(stats)

            enriched.append(
                Bucket(
                    name=bucket_name,
                    creation_date=b.get("creation_date"),
                    used_bytes=usage_bytes,
                    object_count=objects,
                    quota_max_size_bytes=quota_size,
                    quota_max_objects=quota_objects,
                )
            )
        if not include:
            return enriched

        return bucket_feature_enrichment.enrich_bucket_features(self.configuration, enriched, account, include)

    def get_bucket_stats(
        self,
        bucket_name: str,
        account: S3ExecutionTarget,
        with_stats: bool = True,
    ) -> Bucket:
        normalized_bucket = (bucket_name or "").strip()
        if not normalized_bucket:
            raise RuntimeError("Bucket name is required")

        access_key, secret_key = self._account_credentials(account)
        buckets = s3_client.list_buckets(access_key=access_key, secret_key=secret_key, **self._client_kwargs(account))
        creation_date = None
        for entry in buckets:
            if not isinstance(entry, dict):
                continue
            if entry.get("name") != normalized_bucket:
                continue
            creation_date = entry.get("creation_date")
            break

        usage_bytes: Optional[int] = None
        object_count: Optional[int] = None
        quota_size: Optional[int] = None
        quota_objects: Optional[int] = None

        if with_stats:
            account_uid = resolve_admin_uid(account.rgw_account_id, account.rgw_user_uid)
            if account_uid:
                endpoint = getattr(account, "storage_endpoint", None)
                storage_metrics_enabled = bool(resolve_feature_flags(endpoint).metrics_enabled) if endpoint else True
                if storage_metrics_enabled:
                    try:
                        rgw_admin = self._rgw_admin_for_account(account)
                        stats = rgw_admin.get_bucket_info(normalized_bucket, uid=account_uid, allow_not_found=True)
                        if stats is None:
                            stats = rgw_admin.get_bucket_info(normalized_bucket, allow_not_found=True)
                        usage = stats.get("usage") if isinstance(stats, dict) else None
                        usage_bytes, object_count = extract_usage_stats(usage)
                        quota_size, quota_objects = self._extract_quota_from_admin_stats(stats)
                    except (RuntimeError, RGWAdminError) as exc:
                        logger.warning(
                            "Unable to fetch bucket stats for %s on %s: %s",
                            normalized_bucket,
                            account.rgw_account_id or account.id,
                            exc,
                        )

        return Bucket(
            name=normalized_bucket,
            creation_date=creation_date,
            used_bytes=usage_bytes,
            object_count=object_count,
            quota_max_size_bytes=quota_size,
            quota_max_objects=quota_objects,
        )

    def create_bucket(
        self,
        name: str,
        account: S3ExecutionTarget,
        versioning: bool = False,
        location_constraint: Optional[str] = None,
        object_lock_enabled: bool = False,
    ) -> None:
        access_key, secret_key = self._account_credentials(account)
        s3_client.create_bucket(
            name,
            access_key=access_key,
            secret_key=secret_key,
            location_constraint=location_constraint,
            object_lock_enabled=object_lock_enabled,
            **self._client_kwargs(account),
        )
        effective_versioning = bool(versioning or object_lock_enabled)
        if effective_versioning:
            s3_client.set_bucket_versioning(
                name,
                enabled=True,
                access_key=access_key,
                secret_key=secret_key,
                **self._client_kwargs(account),
            )
        logger.debug(
            "S3 execution context %s created bucket %s (versioning=%s object_lock=%s location=%s)",
            account.rgw_account_id or account.id,
            name,
            effective_versioning,
            object_lock_enabled,
            location_constraint,
        )

    def delete_bucket(self, name: str, account: S3ExecutionTarget, force: bool = False) -> None:
        access_key, secret_key = self._account_credentials(account)
        s3_deletion.delete_bucket(
            name, force=force, access_key=access_key, secret_key=secret_key, **self._client_kwargs(account)
        )
        logger.debug("S3 execution context %s deleted bucket %s force=%s", account.rgw_account_id or account.id, name, force)


def get_buckets_service() -> BucketsService:
    return BucketsService()
