# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from datetime import datetime
from typing import Any, List, Optional
import logging

from botocore.exceptions import BotoCoreError, ClientError

from app.services.s3_execution_context import S3ExecutionTarget
from app.services.object_listing_temp_store import TemporarySqliteStore
from app.services import bucket_compare_remediation
from app.services import bucket_configuration_comparison
from app.services import bucket_content_comparison
from app.services import bucket_feature_enrichment
from app.services import (
    s3_bucket_access,
    s3_bucket_metadata,
    s3_bucket_replication,
    s3_bucket_security,
    s3_client,
    s3_deletion,
)
from app.services.rgw_admin import RGWAdminClient, RGWAdminError, get_rgw_admin_client
from app.models.bucket import (
    Bucket,
    BucketAcl,
    BucketAclGrant,
    BucketAclGrantee,
    BucketAclUpdate,
    BucketEncryptionConfiguration,
    BucketLifecycleConfig,
    BucketLoggingConfiguration,
    BucketNotificationConfiguration,
    BucketObjectLock,
    BucketObjectLockUpdate,
    BucketReplicationConfiguration,
    BucketProperties,
    BucketPublicAccessBlock,
    BucketQuotaUpdate,
    BucketTag,
    BucketWebsiteConfiguration,
    BucketWebsiteRedirectAllRequestsTo,
    LifecycleRule,
)
from app.models.ceph_admin import (
    CephAdminBucketConfigDiff,
    CephAdminBucketContentDiff,
)
from app.services.rgw_supervision import get_supervision_credentials
from app.services.rgw_bucket_metadata import resolve_bucket_owner_identity
from app.utils.rgw_identifiers import (
    resolve_account_scope,
    resolve_admin_uid,
)
from app.utils.rgw_payloads import extract_bucket_list
from app.utils.s3_errors import format_s3_error
from app.utils.s3_etag import etag_md5
from app.utils.s3_endpoint import resolve_s3_client_options
from app.utils.storage_endpoint_features import resolve_admin_endpoint, resolve_feature_flags
from app.utils.usage_stats import extract_usage_stats
from app.utils.size_units import size_to_bytes

logger = logging.getLogger(__name__)


class BucketsService:
    def __init__(self) -> None:
        pass

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

    def _rgw_bucket_quota_admin_for_account(self, account: S3ExecutionTarget):
        endpoint = getattr(account, "storage_endpoint", None)
        if endpoint is None:
            raise RuntimeError("Storage endpoint is not configured for this context")
        flags = resolve_feature_flags(endpoint)
        if not flags.admin_enabled:
            raise RuntimeError("Admin API is disabled for this endpoint")
        access_key = (getattr(endpoint, "admin_access_key", None) or "").strip()
        secret_key = (getattr(endpoint, "admin_secret_key", None) or "").strip()
        if not access_key or not secret_key:
            raise RuntimeError("Endpoint admin credentials are not configured for this endpoint")
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
            raise RuntimeError(f"Unable to initialize bucket quota admin client: {exc}") from exc

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
        access_key, secret_key = account.effective_rgw_credentials()
        if not access_key or not secret_key:
            raise RuntimeError("S3ExecutionTarget is missing admin credentials")
        return access_key, secret_key

    def _client_kwargs(self, account: S3ExecutionTarget) -> dict:
        endpoint, region, force_path_style, verify_tls = resolve_s3_client_options(account)
        session_token = account.session_token()
        return {
            "endpoint": endpoint,
            "region": region,
            "force_path_style": force_path_style,
            "verify_tls": verify_tls,
            "session_token": session_token,
        }

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

    def _resolve_bucket_quota_scope(
        self,
        name: str,
        account: S3ExecutionTarget,
        client: RGWAdminClient,
    ) -> tuple[Optional[str], Optional[str], str]:
        account_id, tenant = resolve_account_scope(account.rgw_account_id)
        root_identifier = account_id or tenant
        root_uid = resolve_admin_uid(root_identifier, account.rgw_user_uid)
        if root_uid:
            return account_id, tenant, root_uid

        try:
            bucket_info = client.get_bucket_info(name, stats=False, allow_not_found=True)
        except RGWAdminError as exc:
            raise RuntimeError(f"Unable to resolve bucket owner for quota update: {exc}") from exc
        if not bucket_info:
            raise RuntimeError("Unable to set bucket quota: bucket not found")

        owner_account_id, owner_uid = resolve_bucket_owner_identity(bucket_info)
        account_id, tenant = resolve_account_scope(owner_account_id)
        root_identifier = account_id or tenant
        root_uid = resolve_admin_uid(root_identifier, owner_uid)
        if not root_uid:
            raise RuntimeError("Unable to set bucket quota: bucket owner uid is missing")
        return account_id, tenant, root_uid

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

        return bucket_feature_enrichment.enrich_bucket_features(self, enriched, account, include)

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

    def get_bucket_tags(self, name: str, account: S3ExecutionTarget) -> list[BucketTag]:
        access_key, secret_key = self._account_credentials(account)
        tags_raw = s3_bucket_metadata.get_bucket_tags(
            name,
            access_key=access_key,
            secret_key=secret_key,
            **self._client_kwargs(account),
        )
        tags: list[BucketTag] = []
        for entry in tags_raw or []:
            if not isinstance(entry, dict):
                continue
            key = str(entry.get("key") or "").strip()
            if not key:
                continue
            tags.append(BucketTag(key=key, value=str(entry.get("value") or "")))
        return tags

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

    def set_versioning(self, name: str, account: S3ExecutionTarget, enabled: bool) -> None:
        access_key, secret_key = self._account_credentials(account)
        s3_client.set_bucket_versioning(
            name,
            enabled=enabled,
            access_key=access_key,
            secret_key=secret_key,
            **self._client_kwargs(account),
        )
        logger.debug("S3 execution context %s set versioning on bucket %s to %s", account.rgw_account_id or account.id, name, enabled)

    def get_bucket_properties(self, name: str, account: S3ExecutionTarget) -> BucketProperties:
        access_key, secret_key = self._account_credentials(account)
        versioning_status = s3_client.get_bucket_versioning(
            name, access_key=access_key, secret_key=secret_key, **self._client_kwargs(account)
        )
        public_access_block_raw = s3_bucket_security.get_bucket_public_access_block(
            name,
            access_key=access_key,
            secret_key=secret_key,
            **self._client_kwargs(account),
        )
        object_lock_raw = s3_bucket_security.get_bucket_object_lock(
            name,
            access_key=access_key,
            secret_key=secret_key,
            **self._client_kwargs(account),
        )
        object_lock = (
            BucketObjectLock(
                enabled=object_lock_raw.get("enabled"),
                mode=object_lock_raw.get("mode"),
                days=object_lock_raw.get("days"),
                years=object_lock_raw.get("years"),
            )
            if isinstance(object_lock_raw, dict)
            else None
        )
        public_access_block = (
            BucketPublicAccessBlock(
                block_public_acls=public_access_block_raw.get("block_public_acls"),
                ignore_public_acls=public_access_block_raw.get("ignore_public_acls"),
                block_public_policy=public_access_block_raw.get("block_public_policy"),
                restrict_public_buckets=public_access_block_raw.get("restrict_public_buckets"),
            )
            if isinstance(public_access_block_raw, dict)
            else None
        )
        lifecycle_rules_raw = s3_bucket_metadata.get_bucket_lifecycle(
            name, access_key=access_key, secret_key=secret_key, **self._client_kwargs(account)
        )
        lifecycle_rules: list[LifecycleRule] = []
        for rule in lifecycle_rules_raw:
            lifecycle_rules.append(
                LifecycleRule(
                    id=rule.get("ID"),
                    status=rule.get("Status"),
                    prefix=rule.get("Prefix") or (rule.get("Filter", {}) or {}).get("Prefix"),
                )
            )
        cors_rules = s3_bucket_access.get_bucket_cors(
            name, access_key=access_key, secret_key=secret_key, **self._client_kwargs(account)
        )
        return BucketProperties(
            versioning_status=versioning_status,
            object_lock_enabled=object_lock.enabled if object_lock else None,
            object_lock=object_lock,
            public_access_block=public_access_block,
            lifecycle_rules=lifecycle_rules,
            cors_rules=cors_rules,
        )

    def get_bucket_versioning_status(self, name: str, account: S3ExecutionTarget) -> str | None:
        access_key, secret_key = self._account_credentials(account)
        return s3_client.get_bucket_versioning(
            name, access_key=access_key, secret_key=secret_key, **self._client_kwargs(account)
        )

    def get_bucket_object_lock(self, name: str, account: S3ExecutionTarget) -> BucketObjectLock | None:
        access_key, secret_key = self._account_credentials(account)
        object_lock_raw = s3_bucket_security.get_bucket_object_lock(
            name, access_key=access_key, secret_key=secret_key, **self._client_kwargs(account)
        )
        if not isinstance(object_lock_raw, dict):
            return None
        return BucketObjectLock(
            enabled=object_lock_raw.get("enabled"),
            mode=object_lock_raw.get("mode"),
            days=object_lock_raw.get("days"),
            years=object_lock_raw.get("years"),
        )

    def get_bucket_cors(self, name: str, account: S3ExecutionTarget) -> list[dict]:
        access_key, secret_key = self._account_credentials(account)
        return s3_bucket_access.get_bucket_cors(
            name, access_key=access_key, secret_key=secret_key, **self._client_kwargs(account)
        )

    def get_bucket_encryption(self, name: str, account: S3ExecutionTarget) -> BucketEncryptionConfiguration:
        access_key, secret_key = self._account_credentials(account)
        rules = s3_bucket_security.get_bucket_encryption(
            name,
            access_key=access_key,
            secret_key=secret_key,
            **self._client_kwargs(account),
        )
        return BucketEncryptionConfiguration(rules=rules)

    def set_bucket_encryption(
        self,
        name: str,
        account: S3ExecutionTarget,
        rules: list[dict],
    ) -> BucketEncryptionConfiguration:
        access_key, secret_key = self._account_credentials(account)
        if not rules:
            s3_bucket_security.delete_bucket_encryption(
                name,
                access_key=access_key,
                secret_key=secret_key,
                **self._client_kwargs(account),
            )
            return BucketEncryptionConfiguration(rules=[])
        s3_bucket_security.put_bucket_encryption(
            name,
            rules=rules,
            access_key=access_key,
            secret_key=secret_key,
            **self._client_kwargs(account),
        )
        return self.get_bucket_encryption(name, account)

    def delete_bucket_encryption(self, name: str, account: S3ExecutionTarget) -> None:
        access_key, secret_key = self._account_credentials(account)
        s3_bucket_security.delete_bucket_encryption(
            name,
            access_key=access_key,
            secret_key=secret_key,
            **self._client_kwargs(account),
        )

    def _compare_client(self, account: S3ExecutionTarget):
        access_key, secret_key = self._account_credentials(account)
        return s3_client.get_s3_client(
            access_key=access_key,
            secret_key=secret_key,
            request_profile="long_running",
            **self._client_kwargs(account),
        )

    def _list_bucket_objects_for_compare(self, bucket_name: str, account: S3ExecutionTarget):
        client = self._compare_client(account)
        continuation_token: Optional[str] = None
        while True:
            kwargs: dict[str, Any] = {"Bucket": bucket_name, "MaxKeys": 1000}
            if continuation_token:
                kwargs["ContinuationToken"] = continuation_token
            try:
                page = client.list_objects_v2(**kwargs)
            except (RuntimeError, ClientError, BotoCoreError) as exc:
                detail = format_s3_error(exc, include_operation=True)
                raise RuntimeError(f"Unable to list objects in bucket '{bucket_name}': {detail}") from exc
            for entry in page.get("Contents", []) or []:
                key = entry.get("Key")
                if not isinstance(key, str) or not key:
                    continue
                etag_raw = entry.get("ETag")
                etag = etag_raw.strip().strip('"') if isinstance(etag_raw, str) else None
                last_modified = entry.get("LastModified")
                storage_class = entry.get("StorageClass")
                yield bucket_content_comparison.BucketCompareObjectEntry(
                    key=key,
                    size=int(entry.get("Size") or 0),
                    etag=etag or None,
                    last_modified=last_modified if isinstance(last_modified, datetime) else None,
                    storage_class=storage_class if isinstance(storage_class, str) else None,
                )
            continuation_token = page.get("NextContinuationToken")
            if not continuation_token:
                break

    def compare_bucket_content(
        self,
        source_bucket: str,
        source_account: S3ExecutionTarget,
        target_bucket: str,
        target_account: S3ExecutionTarget,
        *,
        ignore_modified_after: Optional[datetime] = None,
    ) -> CephAdminBucketContentDiff:
        with TemporarySqliteStore(prefix="s3-manager-bucket-compare-") as store:
            index = bucket_content_comparison.BucketCompareObjectIndex(store.connection)
            source_indexed_count = index.add_objects(
                "source",
                self._list_bucket_objects_for_compare(source_bucket, source_account),
            )
            target_indexed_count = index.add_objects(
                "target",
                self._list_bucket_objects_for_compare(target_bucket, target_account),
            )
            diff = index.build_content_diff(
                md5_resolver=etag_md5,
                ignore_modified_after=ignore_modified_after,
            )
            logger.info(
                "Bucket compare indexed object metadata with temporary store: "
                "source_indexed_count=%s target_indexed_count=%s source_count=%s target_count=%s",
                source_indexed_count,
                target_indexed_count,
                diff.source_count,
                diff.target_count,
            )
            return diff

    def _accounts_share_storage_endpoint(self, source_account: S3ExecutionTarget, target_account: S3ExecutionTarget) -> bool:
        source_options = self._client_kwargs(source_account)
        target_options = self._client_kwargs(target_account)
        return (
            source_options.get("endpoint") == target_options.get("endpoint")
            and source_options.get("region") == target_options.get("region")
            and bool(source_options.get("force_path_style")) == bool(target_options.get("force_path_style"))
            and bool(source_options.get("verify_tls")) == bool(target_options.get("verify_tls"))
        )

    def run_compare_content_remediation(
        self,
        source_bucket: str,
        source_account: S3ExecutionTarget,
        target_bucket: str,
        target_account: S3ExecutionTarget,
        *,
        action: bucket_compare_remediation.BucketCompareRemediationAction,
        object_keys: list[str],
        parallelism: int = 4,
        failed_keys_sample_limit: int = 50,
    ) -> bucket_compare_remediation.BucketCompareRemediationResult:
        if not object_keys:
            return bucket_compare_remediation.remediate_bucket_content(
                source_client=None,
                target_client=None,
                source_bucket=source_bucket,
                target_bucket=target_bucket,
                action=action,
                object_keys=[],
                same_endpoint=False,
                parallelism=parallelism,
                failed_keys_sample_limit=failed_keys_sample_limit,
            )

        if action == "delete_target_only":
            source_client = None
            target_client = self._compare_client(target_account)
            same_endpoint = False
        else:
            source_client = self._compare_client(source_account)
            target_client = self._compare_client(target_account)
            same_endpoint = self._accounts_share_storage_endpoint(source_account, target_account)

        return bucket_compare_remediation.remediate_bucket_content(
            source_client=source_client,
            target_client=target_client,
            source_bucket=source_bucket,
            target_bucket=target_bucket,
            action=action,
            object_keys=object_keys,
            same_endpoint=same_endpoint,
            parallelism=parallelism,
            failed_keys_sample_limit=failed_keys_sample_limit,
        )

    def compare_bucket_configuration(
        self,
        source_bucket: str,
        source_account: S3ExecutionTarget,
        target_bucket: str,
        target_account: S3ExecutionTarget,
        *,
        include_sections: Optional[set[str]] = None,
    ) -> CephAdminBucketConfigDiff:
        return bucket_configuration_comparison.compare_bucket_configuration(
            self,
            source_bucket,
            source_account,
            target_bucket,
            target_account,
            include_sections=include_sections,
        )

    def get_public_access_block(self, name: str, account: S3ExecutionTarget) -> BucketPublicAccessBlock:
        access_key, secret_key = self._account_credentials(account)
        config = s3_bucket_security.get_bucket_public_access_block(
            name,
            access_key=access_key,
            secret_key=secret_key,
            **self._client_kwargs(account),
        ) or {}
        return BucketPublicAccessBlock(
            block_public_acls=config.get("block_public_acls"),
            ignore_public_acls=config.get("ignore_public_acls"),
            block_public_policy=config.get("block_public_policy"),
            restrict_public_buckets=config.get("restrict_public_buckets"),
        )

    def set_public_access_block(
        self,
        name: str,
        account: S3ExecutionTarget,
        payload: BucketPublicAccessBlock,
    ) -> BucketPublicAccessBlock:
        access_key, secret_key = self._account_credentials(account)
        config = {
            "BlockPublicAcls": bool(payload.block_public_acls) if payload.block_public_acls is not None else False,
            "IgnorePublicAcls": bool(payload.ignore_public_acls) if payload.ignore_public_acls is not None else False,
            "BlockPublicPolicy": bool(payload.block_public_policy) if payload.block_public_policy is not None else False,
            "RestrictPublicBuckets": bool(payload.restrict_public_buckets)
            if payload.restrict_public_buckets is not None
            else False,
        }
        if not any(config.values()):
            config = {}
        s3_bucket_security.set_bucket_public_access_block(
            name,
            configuration=config,
            access_key=access_key,
            secret_key=secret_key,
            **self._client_kwargs(account),
        )
        updated = s3_bucket_security.get_bucket_public_access_block(
            name,
            access_key=access_key,
            secret_key=secret_key,
            **self._client_kwargs(account),
        )
        return BucketPublicAccessBlock(
            block_public_acls=(updated or {}).get("block_public_acls"),
            ignore_public_acls=(updated or {}).get("ignore_public_acls"),
            block_public_policy=(updated or {}).get("block_public_policy"),
            restrict_public_buckets=(updated or {}).get("restrict_public_buckets"),
        )

    def set_bucket_quota(
        self,
        name: str,
        account: S3ExecutionTarget,
        payload: BucketQuotaUpdate,
        rgw_admin: Optional[RGWAdminClient] = None,
    ) -> None:
        client = rgw_admin or self._rgw_bucket_quota_admin_for_account(account)
        _account_id, tenant, root_uid = self._resolve_bucket_quota_scope(name, account, client)
        max_size_bytes = None
        if payload.max_size_gb is not None:
            try:
                max_size_bytes = size_to_bytes(payload.max_size_gb, payload.max_size_unit)
            except ValueError as exc:
                raise ValueError(str(exc)) from exc
        enabled = max_size_bytes is not None or payload.max_objects is not None
        try:
            response = client.set_bucket_quota(
                bucket=name,
                tenant=tenant,
                uid=root_uid,
                max_size_bytes=max_size_bytes,
                max_objects=payload.max_objects,
                enabled=enabled,
            )
        except RGWAdminError as exc:
            raise RuntimeError(f"Unable to set bucket quota: {exc}") from exc
        if isinstance(response, dict) and response.get("not_found"):
            raise RuntimeError("Unable to set bucket quota: bucket or owner scope not found")
        if isinstance(response, dict) and response.get("not_implemented"):
            raise RuntimeError("Unable to set bucket quota: operation not supported on this cluster")

    def get_policy(self, name: str, account: S3ExecutionTarget) -> Optional[dict]:
        access_key, secret_key = self._account_credentials(account)
        return s3_bucket_access.get_bucket_policy(
            name, access_key=access_key, secret_key=secret_key, **self._client_kwargs(account)
        )

    def put_policy(self, name: str, account: S3ExecutionTarget, policy: dict) -> None:
        access_key, secret_key = self._account_credentials(account)
        s3_bucket_access.put_bucket_policy(
            name, policy=policy, access_key=access_key, secret_key=secret_key, **self._client_kwargs(account)
        )

    def delete_policy(self, name: str, account: S3ExecutionTarget) -> None:
        access_key, secret_key = self._account_credentials(account)
        s3_bucket_access.delete_bucket_policy(
            name, access_key=access_key, secret_key=secret_key, **self._client_kwargs(account)
        )

    def set_cors(self, name: str, account: S3ExecutionTarget, rules: list[dict]) -> None:
        access_key, secret_key = self._account_credentials(account)
        s3_bucket_access.put_bucket_cors(
            name, rules=rules, access_key=access_key, secret_key=secret_key, **self._client_kwargs(account)
        )

    def delete_cors(self, name: str, account: S3ExecutionTarget) -> None:
        access_key, secret_key = self._account_credentials(account)
        s3_bucket_access.delete_bucket_cors(
            name, access_key=access_key, secret_key=secret_key, **self._client_kwargs(account)
        )

    def get_lifecycle(self, name: str, account: S3ExecutionTarget) -> BucketLifecycleConfig:
        access_key, secret_key = self._account_credentials(account)
        rules = s3_bucket_metadata.get_bucket_lifecycle(
            name,
            access_key=access_key,
            secret_key=secret_key,
            **self._client_kwargs(account),
        )
        return BucketLifecycleConfig(rules=rules)

    def set_lifecycle(self, name: str, account: S3ExecutionTarget, rules: list[dict]) -> BucketLifecycleConfig:
        if not rules:
            self.delete_lifecycle(name, account)
            return BucketLifecycleConfig(rules=[])
        access_key, secret_key = self._account_credentials(account)
        try:
            s3_bucket_metadata.put_bucket_lifecycle(
                name,
                rules=rules,
                access_key=access_key,
                secret_key=secret_key,
                **self._client_kwargs(account),
            )
        except RuntimeError as exc:
            raise RuntimeError(f"Unable to set lifecycle rules: {exc}") from exc
        return self.get_lifecycle(name, account)

    def delete_lifecycle(self, name: str, account: S3ExecutionTarget) -> None:
        access_key, secret_key = self._account_credentials(account)
        s3_bucket_metadata.delete_bucket_lifecycle(
            name, access_key=access_key, secret_key=secret_key, **self._client_kwargs(account)
        )
        # Some RGW backends may return 204 but keep lifecycle rules.
        # Double-check and overwrite with an empty configuration to purge if needed.
        remaining = s3_bucket_metadata.get_bucket_lifecycle(
            name,
            access_key=access_key,
            secret_key=secret_key,
            **self._client_kwargs(account),
        )
        if remaining:
            try:
                s3_bucket_metadata.put_bucket_lifecycle(
                    name,
                    rules=[],
                    access_key=access_key,
                    secret_key=secret_key,
                    **self._client_kwargs(account),
                )
            except RuntimeError as exc:  # noqa: BLE001
                raise RuntimeError(f"Unable to delete bucket lifecycle: {exc}") from exc

    def set_bucket_tags(self, name: str, account: S3ExecutionTarget, tags: list[dict]) -> None:
        access_key, secret_key = self._account_credentials(account)
        s3_bucket_metadata.put_bucket_tags(
            name, tags=tags, access_key=access_key, secret_key=secret_key, **self._client_kwargs(account)
        )

    def delete_bucket_tags(self, name: str, account: S3ExecutionTarget) -> None:
        access_key, secret_key = self._account_credentials(account)
        s3_bucket_metadata.delete_bucket_tags(
            name, access_key=access_key, secret_key=secret_key, **self._client_kwargs(account)
        )

    def get_bucket_notifications(self, name: str, account: S3ExecutionTarget) -> BucketNotificationConfiguration:
        access_key, secret_key = self._account_credentials(account)
        config = s3_bucket_metadata.get_bucket_notifications(
            name,
            access_key=access_key,
            secret_key=secret_key,
            **self._client_kwargs(account),
        ) or {}
        return BucketNotificationConfiguration(configuration=config)

    def get_bucket_replication(self, name: str, account: S3ExecutionTarget) -> BucketReplicationConfiguration:
        access_key, secret_key = self._account_credentials(account)
        config = s3_bucket_replication.get_bucket_replication(
            name,
            access_key=access_key,
            secret_key=secret_key,
            **self._client_kwargs(account),
        ) or {}
        return BucketReplicationConfiguration(configuration=config)

    def _validate_bucket_replication_configuration(self, configuration: Any) -> dict:
        if not isinstance(configuration, dict):
            raise ValueError("Replication configuration must be an object.")
        rules = configuration.get("Rules")
        if not isinstance(rules, list) or len(rules) == 0:
            raise ValueError("Replication configuration must include a non-empty Rules array.")
        for rule in rules:
            if not isinstance(rule, dict):
                continue
            destination = rule.get("Destination")
            if isinstance(destination, dict) and "Zone" in destination:
                raise ValueError("Destination.Zone is not supported in V1.")
        return configuration

    def set_bucket_replication(
        self,
        name: str,
        account: S3ExecutionTarget,
        payload: BucketReplicationConfiguration,
    ) -> BucketReplicationConfiguration:
        configuration = self._validate_bucket_replication_configuration(payload.configuration)
        access_key, secret_key = self._account_credentials(account)
        s3_bucket_replication.put_bucket_replication(
            name,
            configuration=configuration,
            access_key=access_key,
            secret_key=secret_key,
            **self._client_kwargs(account),
        )
        return self.get_bucket_replication(name, account)

    def delete_bucket_replication(self, name: str, account: S3ExecutionTarget) -> None:
        access_key, secret_key = self._account_credentials(account)
        s3_bucket_replication.delete_bucket_replication(
            name,
            access_key=access_key,
            secret_key=secret_key,
            **self._client_kwargs(account),
        )

    def set_bucket_notifications(
        self,
        name: str,
        account: S3ExecutionTarget,
        configuration: dict,
    ) -> BucketNotificationConfiguration:
        access_key, secret_key = self._account_credentials(account)
        s3_bucket_metadata.put_bucket_notifications(
            name,
            config=configuration or {},
            access_key=access_key,
            secret_key=secret_key,
            **self._client_kwargs(account),
        )
        return self.get_bucket_notifications(name, account)

    def delete_bucket_notifications(self, name: str, account: S3ExecutionTarget) -> None:
        access_key, secret_key = self._account_credentials(account)
        s3_bucket_metadata.put_bucket_notifications(
            name,
            config={},
            access_key=access_key,
            secret_key=secret_key,
            **self._client_kwargs(account),
        )

    def get_bucket_logging(self, name: str, account: S3ExecutionTarget) -> BucketLoggingConfiguration:
        access_key, secret_key = self._account_credentials(account)
        config = s3_bucket_metadata.get_bucket_logging(
            name,
            access_key=access_key,
            secret_key=secret_key,
            **self._client_kwargs(account),
        )
        if not config:
            return BucketLoggingConfiguration(enabled=False)
        return BucketLoggingConfiguration(
            enabled=True,
            target_bucket=config.get("target_bucket"),
            target_prefix=config.get("target_prefix"),
        )

    def set_bucket_logging(
        self,
        name: str,
        account: S3ExecutionTarget,
        payload: BucketLoggingConfiguration,
    ) -> BucketLoggingConfiguration:
        access_key, secret_key = self._account_credentials(account)
        if not payload.enabled:
            s3_bucket_metadata.put_bucket_logging(
                name,
                logging_config=None,
                access_key=access_key,
                secret_key=secret_key,
                **self._client_kwargs(account),
            )
            return BucketLoggingConfiguration(enabled=False)
        target_bucket = (payload.target_bucket or "").strip()
        if not target_bucket:
            raise ValueError("Target bucket is required when enabling access logging.")
        logging_config = {"TargetBucket": target_bucket}
        target_prefix = (payload.target_prefix or "").strip()
        logging_config["TargetPrefix"] = target_prefix
        s3_bucket_metadata.put_bucket_logging(
            name,
            logging_config=logging_config,
            access_key=access_key,
            secret_key=secret_key,
            **self._client_kwargs(account),
        )
        return self.get_bucket_logging(name, account)

    def delete_bucket_logging(self, name: str, account: S3ExecutionTarget) -> None:
        access_key, secret_key = self._account_credentials(account)
        s3_bucket_metadata.put_bucket_logging(
            name,
            logging_config=None,
            access_key=access_key,
            secret_key=secret_key,
            **self._client_kwargs(account),
        )

    def get_bucket_website(self, name: str, account: S3ExecutionTarget) -> BucketWebsiteConfiguration:
        access_key, secret_key = self._account_credentials(account)
        config = s3_bucket_access.get_bucket_website(
            name,
            access_key=access_key,
            secret_key=secret_key,
            **self._client_kwargs(account),
        )
        if not config:
            return BucketWebsiteConfiguration()
        index_document = None
        error_document = None
        redirect = None
        index_raw = config.get("IndexDocument")
        if isinstance(index_raw, dict):
            index_document = index_raw.get("Suffix")
        error_raw = config.get("ErrorDocument")
        if isinstance(error_raw, dict):
            error_document = error_raw.get("Key")
        redirect_raw = config.get("RedirectAllRequestsTo")
        if isinstance(redirect_raw, dict):
            host_name = redirect_raw.get("HostName")
            if host_name:
                redirect = BucketWebsiteRedirectAllRequestsTo(
                    host_name=host_name,
                    protocol=redirect_raw.get("Protocol"),
                )
        routing_rules = config.get("RoutingRules") or []
        if not isinstance(routing_rules, list):
            routing_rules = []
        return BucketWebsiteConfiguration(
            index_document=index_document,
            error_document=error_document,
            redirect_all_requests_to=redirect,
            routing_rules=routing_rules,
        )

    def set_bucket_website(
        self,
        name: str,
        account: S3ExecutionTarget,
        payload: BucketWebsiteConfiguration,
    ) -> BucketWebsiteConfiguration:
        access_key, secret_key = self._account_credentials(account)
        config: dict = {}
        if payload.redirect_all_requests_to:
            host_name = payload.redirect_all_requests_to.host_name.strip()
            if not host_name:
                raise ValueError("Redirect hostname is required.")
            redirect = {"HostName": host_name}
            protocol = payload.redirect_all_requests_to.protocol
            if protocol:
                redirect["Protocol"] = protocol
            config["RedirectAllRequestsTo"] = redirect
        else:
            index_document = (payload.index_document or "").strip()
            if not index_document:
                raise ValueError("Index document is required when redirect is not configured.")
            config["IndexDocument"] = {"Suffix": index_document}
            error_document = (payload.error_document or "").strip()
            if error_document:
                config["ErrorDocument"] = {"Key": error_document}
            if payload.routing_rules:
                config["RoutingRules"] = payload.routing_rules
        if not config:
            raise ValueError("Website configuration is empty.")
        s3_bucket_access.put_bucket_website(
            name,
            configuration=config,
            access_key=access_key,
            secret_key=secret_key,
            **self._client_kwargs(account),
        )
        return self.get_bucket_website(name, account)

    def delete_bucket_website(self, name: str, account: S3ExecutionTarget) -> None:
        access_key, secret_key = self._account_credentials(account)
        s3_bucket_access.delete_bucket_website(
            name,
            access_key=access_key,
            secret_key=secret_key,
            **self._client_kwargs(account),
        )

    def get_bucket_acl(self, name: str, account: S3ExecutionTarget) -> BucketAcl:
        access_key, secret_key = self._account_credentials(account)
        acl_raw = s3_bucket_security.get_bucket_acl(
            name, access_key=access_key, secret_key=secret_key, **self._client_kwargs(account)
        )
        owner = acl_raw.get("Owner") or {}
        owner_name = owner.get("DisplayName") or owner.get("ID")
        grants: list[BucketAclGrant] = []
        for grant in acl_raw.get("Grants") or []:
            grantee_raw = grant.get("Grantee") or {}
            grantee_type = grantee_raw.get("Type")
            if not grantee_type:
                continue
            grants.append(
                BucketAclGrant(
                    grantee=BucketAclGrantee(
                        type=grantee_type,
                        id=grantee_raw.get("ID"),
                        display_name=grantee_raw.get("DisplayName"),
                        uri=grantee_raw.get("URI"),
                    ),
                    permission=grant.get("Permission") or "UNKNOWN",
                )
            )
        return BucketAcl(owner=owner_name, grants=grants)

    def set_bucket_acl(self, name: str, account: S3ExecutionTarget, payload: BucketAclUpdate) -> BucketAcl:
        access_key, secret_key = self._account_credentials(account)
        s3_bucket_security.put_bucket_acl(
            name,
            acl=payload.acl,
            access_key=access_key,
            secret_key=secret_key,
            **self._client_kwargs(account),
        )
        return self.get_bucket_acl(name, account)

    def get_object_lock(self, name: str, account: S3ExecutionTarget) -> BucketObjectLock:
        access_key, secret_key = self._account_credentials(account)
        config = s3_bucket_security.get_bucket_object_lock(
            name,
            access_key=access_key,
            secret_key=secret_key,
            **self._client_kwargs(account),
        )
        if not config:
            return BucketObjectLock(enabled=None, mode=None, days=None, years=None)
        return BucketObjectLock(
            enabled=config.get("enabled"),
            mode=config.get("mode"),
            days=config.get("days"),
            years=config.get("years"),
        )

    def set_object_lock(self, name: str, account: S3ExecutionTarget, payload: BucketObjectLockUpdate) -> BucketObjectLock:
        access_key, secret_key = self._account_credentials(account)
        current_config = s3_bucket_security.get_bucket_object_lock(
            name,
            access_key=access_key,
            secret_key=secret_key,
            **self._client_kwargs(account),
        )
        enabled = payload.enabled if payload.enabled is not None else (current_config or {}).get("enabled")
        mode = payload.mode or None
        days = payload.days
        years = payload.years

        if days is not None and years is not None:
            raise ValueError("Specify either Days or Years, not both.")
        if (days is not None or years is not None) and not mode:
            raise ValueError("Mode is required to set a default retention.")
        if mode and days is None and years is None:
            raise ValueError("A duration (days or years) is required when a retention mode is set.")
        if enabled is None:
            raise RuntimeError("Object Lock not available on this bucket.")

        try:
            s3_bucket_security.put_bucket_object_lock(
                name,
                access_key=access_key,
                secret_key=secret_key,
                enabled=enabled,
                mode=mode,
                days=days,
                years=years,
                **self._client_kwargs(account),
            )
        except RuntimeError as exc:
            raise RuntimeError(f"Unable to update object lock for bucket {name}: {exc}") from exc

        return self.get_object_lock(name, account)


def get_buckets_service() -> BucketsService:
    return BucketsService()
