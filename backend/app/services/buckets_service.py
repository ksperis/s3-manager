# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from typing import List, Optional
import logging

from app.db_models import S3Account
from app.services import s3_client
from app.services.rgw_admin import RGWAdminError, get_rgw_admin_client
from app.models.bucket import (
    Bucket,
    BucketAcl,
    BucketAclGrant,
    BucketAclGrantee,
    BucketAclUpdate,
    BucketLifecycleConfig,
    BucketLoggingConfiguration,
    BucketNotificationConfiguration,
    BucketObjectLock,
    BucketObjectLockUpdate,
    BucketProperties,
    BucketPublicAccessBlock,
    BucketQuotaUpdate,
    BucketWebsiteConfiguration,
    BucketWebsiteRedirectAllRequestsTo,
    LifecycleRule,
)
from app.utils.rgw import (
    extract_bucket_list,
    resolve_account_scope,
    resolve_admin_uid,
    get_supervision_credentials,
)
from app.utils.s3_endpoint import resolve_s3_endpoint
from app.utils.storage_endpoint_features import resolve_admin_endpoint, resolve_feature_flags
from app.utils.usage_stats import extract_usage_stats

logger = logging.getLogger(__name__)


class BucketsService:
    def __init__(self) -> None:
        pass

    def _rgw_admin_for_account(self, account: S3Account):
        endpoint = getattr(account, "storage_endpoint", None)
        creds = get_supervision_credentials(account)
        if not creds or not endpoint:
            raise RuntimeError("Supervision credentials are not configured for this endpoint")
        flags = resolve_feature_flags(endpoint)
        if not flags.usage_enabled:
            raise RuntimeError("Usage metrics are disabled for this endpoint")
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
            )
        except RGWAdminError as exc:
            raise RuntimeError(f"Unable to initialize RGW admin client: {exc}") from exc

    def _admin_bucket_list(self, account: S3Account) -> list[dict]:
        uid = resolve_admin_uid(account.rgw_account_id, account.rgw_user_uid)
        if not uid:
            return []
        rgw_admin = self._rgw_admin_for_account(account)
        try:
            payload = rgw_admin.get_all_buckets(uid=uid, with_stats=True)
        except RGWAdminError as exc:
            raise RuntimeError(f"Unable to list buckets via RGW admin: {exc}") from exc
        return extract_bucket_list(payload)

    def _account_credentials(self, account: S3Account) -> tuple[str, str]:
        access_key, secret_key = account.effective_rgw_credentials()
        if not access_key or not secret_key:
            raise RuntimeError("S3Account is missing RGW admin credentials")
        return access_key, secret_key

    def _endpoint(self, account: S3Account) -> Optional[str]:
        return resolve_s3_endpoint(account)

    def list_buckets(self, account: S3Account) -> List[Bucket]:
        access_key, secret_key = self._account_credentials(account)
        endpoint = self._endpoint(account)
        buckets = s3_client.list_buckets(access_key=access_key, secret_key=secret_key, endpoint=endpoint)
        account_uid = resolve_admin_uid(account.rgw_account_id, account.rgw_user_uid)
        admin_by_name: dict[str, dict] = {}
        if account_uid:
            try:
                admin_list = self._admin_bucket_list(account)
                logger.debug(
                    "S3Account %s fetched %s bucket stats via RGW admin",
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
        logger.debug("S3Account %s listed %s buckets", account.rgw_account_id or account.id, len(buckets))
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
            quota = stats.get("bucket_quota") if isinstance(stats, dict) else None
            if isinstance(quota, dict):
                max_size = quota.get("max_size") or quota.get("max_size_kb")
                try:
                    if max_size is not None:
                        quota_size = int(max_size) * (1024 if "max_size_kb" in quota else 1)
                except (TypeError, ValueError):
                    quota_size = None
                try:
                    if quota.get("max_objects") is not None:
                        quota_objects = int(quota.get("max_objects"))
                except (TypeError, ValueError):
                    quota_objects = None

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
        return enriched

    def create_bucket(
        self,
        name: str,
        account: S3Account,
        versioning: bool = False,
    ) -> None:
        access_key, secret_key = self._account_credentials(account)
        endpoint = self._endpoint(account)
        s3_client.create_bucket(name, access_key=access_key, secret_key=secret_key, endpoint=endpoint)
        if versioning:
            s3_client.set_bucket_versioning(
                name,
                enabled=versioning,
                access_key=access_key,
                secret_key=secret_key,
                endpoint=endpoint,
            )
        logger.debug("S3Account %s created bucket %s (versioning=%s)", account.rgw_account_id or account.id, name, versioning)

    def delete_bucket(self, name: str, account: S3Account, force: bool = False) -> None:
        access_key, secret_key = self._account_credentials(account)
        endpoint = self._endpoint(account)
        s3_client.delete_bucket(name, force=force, access_key=access_key, secret_key=secret_key, endpoint=endpoint)
        logger.debug("S3Account %s deleted bucket %s force=%s", account.rgw_account_id or account.id, name, force)

    def set_versioning(self, name: str, account: S3Account, enabled: bool) -> None:
        access_key, secret_key = self._account_credentials(account)
        endpoint = self._endpoint(account)
        s3_client.set_bucket_versioning(
            name,
            enabled=enabled,
            access_key=access_key,
            secret_key=secret_key,
            endpoint=endpoint,
        )
        logger.debug("S3Account %s set versioning on bucket %s to %s", account.rgw_account_id or account.id, name, enabled)

    def get_bucket_properties(self, name: str, account: S3Account) -> BucketProperties:
        access_key, secret_key = self._account_credentials(account)
        endpoint = self._endpoint(account)
        versioning_status = s3_client.get_bucket_versioning(
            name, access_key=access_key, secret_key=secret_key, endpoint=endpoint
        )
        public_access_block_raw = s3_client.get_bucket_public_access_block(
            name,
            access_key=access_key,
            secret_key=secret_key,
            endpoint=endpoint,
        )
        object_lock_raw = s3_client.get_bucket_object_lock(
            name,
            access_key=access_key,
            secret_key=secret_key,
            endpoint=endpoint,
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
        lifecycle_rules_raw = s3_client.get_bucket_lifecycle(
            name, access_key=access_key, secret_key=secret_key, endpoint=endpoint
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
        cors_rules = s3_client.get_bucket_cors(name, access_key=access_key, secret_key=secret_key, endpoint=endpoint)
        return BucketProperties(
            versioning_status=versioning_status,
            object_lock_enabled=object_lock.enabled if object_lock else None,
            object_lock=object_lock,
            public_access_block=public_access_block,
            lifecycle_rules=lifecycle_rules,
            cors_rules=cors_rules,
        )

    def get_public_access_block(self, name: str, account: S3Account) -> BucketPublicAccessBlock:
        access_key, secret_key = self._account_credentials(account)
        endpoint = self._endpoint(account)
        config = s3_client.get_bucket_public_access_block(
            name,
            access_key=access_key,
            secret_key=secret_key,
            endpoint=endpoint,
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
        account: S3Account,
        payload: BucketPublicAccessBlock,
    ) -> BucketPublicAccessBlock:
        access_key, secret_key = self._account_credentials(account)
        endpoint = self._endpoint(account)
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
        s3_client.set_bucket_public_access_block(
            name,
            configuration=config,
            access_key=access_key,
            secret_key=secret_key,
            endpoint=endpoint,
        )
        updated = s3_client.get_bucket_public_access_block(
            name,
            access_key=access_key,
            secret_key=secret_key,
            endpoint=endpoint,
        )
        return BucketPublicAccessBlock(
            block_public_acls=(updated or {}).get("block_public_acls"),
            ignore_public_acls=(updated or {}).get("ignore_public_acls"),
            block_public_policy=(updated or {}).get("block_public_policy"),
            restrict_public_buckets=(updated or {}).get("restrict_public_buckets"),
        )

    def set_bucket_quota(self, name: str, account: S3Account, payload: BucketQuotaUpdate) -> None:
        account_id, tenant = resolve_account_scope(account.rgw_account_id)
        root_identifier = account_id or tenant
        root_uid = f"{root_identifier}-admin" if root_identifier else None
        rgw_admin = self._rgw_admin_for_account(account)
        try:
            rgw_admin.set_bucket_quota(
                bucket=name,
                tenant=tenant,
                uid=root_uid,
                max_size_gb=payload.max_size_gb,
                max_objects=payload.max_objects,
                enabled=payload.max_size_gb is not None or payload.max_objects is not None,
                account_id=account_id,
            )
        except RGWAdminError as exc:
            raise RuntimeError(f"Unable to set bucket quota: {exc}") from exc

    def get_policy(self, name: str, account: S3Account) -> Optional[dict]:
        access_key, secret_key = self._account_credentials(account)
        endpoint = self._endpoint(account)
        return s3_client.get_bucket_policy(name, access_key=access_key, secret_key=secret_key, endpoint=endpoint)

    def put_policy(self, name: str, account: S3Account, policy: dict) -> None:
        access_key, secret_key = self._account_credentials(account)
        endpoint = self._endpoint(account)
        s3_client.put_bucket_policy(name, policy=policy, access_key=access_key, secret_key=secret_key, endpoint=endpoint)

    def delete_policy(self, name: str, account: S3Account) -> None:
        access_key, secret_key = self._account_credentials(account)
        endpoint = self._endpoint(account)
        s3_client.delete_bucket_policy(name, access_key=access_key, secret_key=secret_key, endpoint=endpoint)

    def set_cors(self, name: str, account: S3Account, rules: list[dict]) -> None:
        access_key, secret_key = self._account_credentials(account)
        endpoint = self._endpoint(account)
        s3_client.put_bucket_cors(name, rules=rules, access_key=access_key, secret_key=secret_key, endpoint=endpoint)

    def delete_cors(self, name: str, account: S3Account) -> None:
        access_key, secret_key = self._account_credentials(account)
        endpoint = self._endpoint(account)
        s3_client.delete_bucket_cors(name, access_key=access_key, secret_key=secret_key, endpoint=endpoint)

    def get_lifecycle(self, name: str, account: S3Account) -> BucketLifecycleConfig:
        access_key, secret_key = self._account_credentials(account)
        endpoint = self._endpoint(account)
        rules = s3_client.get_bucket_lifecycle(
            name,
            access_key=access_key,
            secret_key=secret_key,
            endpoint=endpoint,
        )
        return BucketLifecycleConfig(rules=rules)

    def set_lifecycle(self, name: str, account: S3Account, rules: list[dict]) -> BucketLifecycleConfig:
        if not rules:
            self.delete_lifecycle(name, account)
            return BucketLifecycleConfig(rules=[])
        access_key, secret_key = self._account_credentials(account)
        endpoint = self._endpoint(account)
        try:
            s3_client.put_bucket_lifecycle(
                name,
                rules=rules,
                access_key=access_key,
                secret_key=secret_key,
                endpoint=endpoint,
            )
        except RuntimeError as exc:
            raise RuntimeError(f"Unable to set lifecycle rules: {exc}") from exc
        return self.get_lifecycle(name, account)

    def delete_lifecycle(self, name: str, account: S3Account) -> None:
        access_key, secret_key = self._account_credentials(account)
        endpoint = self._endpoint(account)
        s3_client.delete_bucket_lifecycle(name, access_key=access_key, secret_key=secret_key, endpoint=endpoint)
        # Some RGW backends may return 204 but keep lifecycle rules.
        # Double-check and overwrite with an empty configuration to purge if needed.
        remaining = s3_client.get_bucket_lifecycle(
            name,
            access_key=access_key,
            secret_key=secret_key,
            endpoint=endpoint,
        )
        if remaining:
            try:
                s3_client.put_bucket_lifecycle(
                    name,
                    rules=[],
                    access_key=access_key,
                    secret_key=secret_key,
                    endpoint=endpoint,
                )
            except RuntimeError as exc:  # noqa: BLE001
                raise RuntimeError(f"Unable to delete bucket lifecycle: {exc}") from exc

    def set_bucket_tags(self, name: str, account: S3Account, tags: list[dict]) -> None:
        access_key, secret_key = self._account_credentials(account)
        endpoint = self._endpoint(account)
        s3_client.put_bucket_tags(name, tags=tags, access_key=access_key, secret_key=secret_key, endpoint=endpoint)

    def delete_bucket_tags(self, name: str, account: S3Account) -> None:
        access_key, secret_key = self._account_credentials(account)
        endpoint = self._endpoint(account)
        s3_client.delete_bucket_tags(name, access_key=access_key, secret_key=secret_key, endpoint=endpoint)

    def get_bucket_notifications(self, name: str, account: S3Account) -> BucketNotificationConfiguration:
        access_key, secret_key = self._account_credentials(account)
        endpoint = self._endpoint(account)
        config = s3_client.get_bucket_notifications(
            name,
            access_key=access_key,
            secret_key=secret_key,
            endpoint=endpoint,
        ) or {}
        return BucketNotificationConfiguration(configuration=config)

    def set_bucket_notifications(
        self,
        name: str,
        account: S3Account,
        configuration: dict,
    ) -> BucketNotificationConfiguration:
        access_key, secret_key = self._account_credentials(account)
        endpoint = self._endpoint(account)
        s3_client.put_bucket_notifications(
            name,
            config=configuration or {},
            access_key=access_key,
            secret_key=secret_key,
            endpoint=endpoint,
        )
        return self.get_bucket_notifications(name, account)

    def delete_bucket_notifications(self, name: str, account: S3Account) -> None:
        access_key, secret_key = self._account_credentials(account)
        endpoint = self._endpoint(account)
        s3_client.put_bucket_notifications(
            name,
            config={},
            access_key=access_key,
            secret_key=secret_key,
            endpoint=endpoint,
        )

    def get_bucket_logging(self, name: str, account: S3Account) -> BucketLoggingConfiguration:
        access_key, secret_key = self._account_credentials(account)
        endpoint = self._endpoint(account)
        config = s3_client.get_bucket_logging(
            name,
            access_key=access_key,
            secret_key=secret_key,
            endpoint=endpoint,
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
        account: S3Account,
        payload: BucketLoggingConfiguration,
    ) -> BucketLoggingConfiguration:
        access_key, secret_key = self._account_credentials(account)
        endpoint = self._endpoint(account)
        if not payload.enabled:
            s3_client.put_bucket_logging(
                name,
                logging_config=None,
                access_key=access_key,
                secret_key=secret_key,
                endpoint=endpoint,
            )
            return BucketLoggingConfiguration(enabled=False)
        target_bucket = (payload.target_bucket or "").strip()
        if not target_bucket:
            raise ValueError("Target bucket is required when enabling access logging.")
        logging_config = {"TargetBucket": target_bucket}
        target_prefix = (payload.target_prefix or "").strip()
        logging_config["TargetPrefix"] = target_prefix
        s3_client.put_bucket_logging(
            name,
            logging_config=logging_config,
            access_key=access_key,
            secret_key=secret_key,
            endpoint=endpoint,
        )
        return self.get_bucket_logging(name, account)

    def delete_bucket_logging(self, name: str, account: S3Account) -> None:
        access_key, secret_key = self._account_credentials(account)
        endpoint = self._endpoint(account)
        s3_client.put_bucket_logging(
            name,
            logging_config=None,
            access_key=access_key,
            secret_key=secret_key,
            endpoint=endpoint,
        )

    def get_bucket_website(self, name: str, account: S3Account) -> BucketWebsiteConfiguration:
        access_key, secret_key = self._account_credentials(account)
        endpoint = self._endpoint(account)
        config = s3_client.get_bucket_website(
            name,
            access_key=access_key,
            secret_key=secret_key,
            endpoint=endpoint,
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
        account: S3Account,
        payload: BucketWebsiteConfiguration,
    ) -> BucketWebsiteConfiguration:
        access_key, secret_key = self._account_credentials(account)
        endpoint = self._endpoint(account)
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
        s3_client.put_bucket_website(
            name,
            configuration=config,
            access_key=access_key,
            secret_key=secret_key,
            endpoint=endpoint,
        )
        return self.get_bucket_website(name, account)

    def delete_bucket_website(self, name: str, account: S3Account) -> None:
        access_key, secret_key = self._account_credentials(account)
        endpoint = self._endpoint(account)
        s3_client.delete_bucket_website(
            name,
            access_key=access_key,
            secret_key=secret_key,
            endpoint=endpoint,
        )

    def get_bucket_acl(self, name: str, account: S3Account) -> BucketAcl:
        access_key, secret_key = self._account_credentials(account)
        endpoint = self._endpoint(account)
        acl_raw = s3_client.get_bucket_acl(name, access_key=access_key, secret_key=secret_key, endpoint=endpoint)
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

    def set_bucket_acl(self, name: str, account: S3Account, payload: BucketAclUpdate) -> BucketAcl:
        access_key, secret_key = self._account_credentials(account)
        endpoint = self._endpoint(account)
        s3_client.put_bucket_acl(
            name,
            acl=payload.acl,
            access_key=access_key,
            secret_key=secret_key,
            endpoint=endpoint,
        )
        return self.get_bucket_acl(name, account)

    def get_object_lock(self, name: str, account: S3Account) -> BucketObjectLock:
        access_key, secret_key = self._account_credentials(account)
        endpoint = self._endpoint(account)
        config = s3_client.get_bucket_object_lock(
            name,
            access_key=access_key,
            secret_key=secret_key,
            endpoint=endpoint,
        )
        if not config:
            return BucketObjectLock(enabled=None, mode=None, days=None, years=None)
        return BucketObjectLock(
            enabled=config.get("enabled"),
            mode=config.get("mode"),
            days=config.get("days"),
            years=config.get("years"),
        )

    def set_object_lock(self, name: str, account: S3Account, payload: BucketObjectLockUpdate) -> BucketObjectLock:
        access_key, secret_key = self._account_credentials(account)
        endpoint = self._endpoint(account)
        current_config = s3_client.get_bucket_object_lock(
            name,
            access_key=access_key,
            secret_key=secret_key,
            endpoint=endpoint,
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
            s3_client.put_bucket_object_lock(
                name,
                access_key=access_key,
                secret_key=secret_key,
                enabled=enabled,
                mode=mode,
                days=days,
                years=years,
                endpoint=endpoint,
            )
        except RuntimeError as exc:
            raise RuntimeError(f"Unable to update object lock for bucket {name}: {exc}") from exc

        return self.get_object_lock(name, account)


def get_buckets_service() -> BucketsService:
    return BucketsService()
