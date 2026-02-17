# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from typing import List, Optional, Set
import logging

from app.db import S3Account
from app.services import s3_client
from app.services.rgw_admin import RGWAdminClient, RGWAdminError, get_rgw_admin_client
from app.models.bucket import (
    Bucket,
    BucketAcl,
    BucketAclGrant,
    BucketAclGrantee,
    BucketAclUpdate,
    BucketFeatureStatus,
    BucketLifecycleConfig,
    BucketLoggingConfiguration,
    BucketNotificationConfiguration,
    BucketObjectLock,
    BucketObjectLockUpdate,
    BucketProperties,
    BucketPublicAccessBlock,
    BucketQuotaUpdate,
    BucketTag,
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
from app.utils.s3_endpoint import resolve_s3_client_options
from app.utils.storage_endpoint_features import resolve_admin_endpoint, resolve_feature_flags
from app.utils.usage_stats import extract_usage_stats
from app.utils.size_units import size_to_bytes

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

    def _admin_bucket_list(self, account: S3Account, with_stats: bool = True) -> list[dict]:
        uid = resolve_admin_uid(account.rgw_account_id, account.rgw_user_uid)
        if not uid:
            return []
        rgw_admin = self._rgw_admin_for_account(account)
        try:
            payload = rgw_admin.get_all_buckets(uid=uid, with_stats=with_stats)
        except RGWAdminError as exc:
            raise RuntimeError(f"Unable to list buckets via RGW admin: {exc}") from exc
        return extract_bucket_list(payload)

    def _account_credentials(self, account: S3Account) -> tuple[str, str]:
        access_key, secret_key = account.effective_rgw_credentials()
        if not access_key or not secret_key:
            raise RuntimeError("S3Account is missing RGW admin credentials")
        return access_key, secret_key

    def _client_kwargs(self, account: S3Account) -> dict:
        endpoint, region, force_path_style, verify_tls = resolve_s3_client_options(account)
        session_token = account.session_token() if hasattr(account, "session_token") else getattr(account, "_session_token", None)
        return {
            "endpoint": endpoint,
            "region": region,
            "force_path_style": force_path_style,
            "verify_tls": verify_tls,
            "session_token": session_token,
        }

    def list_buckets(
        self,
        account: S3Account,
        include: Optional[Set[str]] = None,
        with_stats: bool = True,
    ) -> List[Bucket]:
        access_key, secret_key = self._account_credentials(account)
        buckets = s3_client.list_buckets(access_key=access_key, secret_key=secret_key, **self._client_kwargs(account))
        account_uid = resolve_admin_uid(account.rgw_account_id, account.rgw_user_uid)
        admin_by_name: dict[str, dict] = {}
        if account_uid and with_stats:
            endpoint = getattr(account, "storage_endpoint", None)
            usage_enabled = bool(resolve_feature_flags(endpoint).usage_enabled) if endpoint else True
            if not usage_enabled:
                logger.debug(
                    "S3Account %s skipped RGW admin stats enrichment (usage feature disabled)",
                    account.rgw_account_id or account.id,
                )
            else:
                try:
                    admin_list = self._admin_bucket_list(account, with_stats=True)
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
        elif account_uid and not with_stats:
            logger.debug("S3Account %s skipped RGW admin stats enrichment", account.rgw_account_id or account.id)
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

        allowed = {
            "tags",
            "versioning",
            "object_lock",
            "block_public_access",
            "lifecycle_rules",
            "static_website",
            "bucket_policy",
            "cors",
            "access_logging",
        }
        requested = {key for key in include if key in allowed}
        if not requested:
            return enriched

        wants_tags = "tags" in requested
        props_feature_keys = {"versioning", "object_lock", "block_public_access", "lifecycle_rules", "cors"}
        requested_props_features = requested & props_feature_keys
        use_props_bundle = len(requested_props_features) > 1
        wants_website = "static_website" in requested
        wants_policy = "bucket_policy" in requested
        wants_logging = "access_logging" in requested

        def unavailable() -> BucketFeatureStatus:
            return BucketFeatureStatus(state="Unavailable", tone="unknown")

        def inactive(state: str) -> BucketFeatureStatus:
            return BucketFeatureStatus(state=state, tone="inactive")

        def active(state: str) -> BucketFeatureStatus:
            return BucketFeatureStatus(state=state, tone="active")

        result: list[Bucket] = []
        for bucket in enriched:
            tags: Optional[list[BucketTag]] = None
            features: Optional[dict[str, BucketFeatureStatus]] = None
            if wants_tags:
                try:
                    tags = self.get_bucket_tags(bucket.name, account)
                except RuntimeError:
                    tags = []

            feature_map: dict[str, BucketFeatureStatus] = {}
            props: Optional[BucketProperties] = None
            props_error = False
            if use_props_bundle:
                try:
                    props = self.get_bucket_properties(bucket.name, account)
                except RuntimeError:
                    props_error = True

            if "versioning" in requested:
                raw_versioning: Optional[str] = None
                if use_props_bundle:
                    if props_error:
                        feature_map["versioning"] = unavailable()
                    else:
                        raw_versioning = props.versioning_status if props else None
                else:
                    try:
                        raw_versioning = self.get_bucket_versioning_status(bucket.name, account)
                    except RuntimeError:
                        feature_map["versioning"] = unavailable()
                if "versioning" not in feature_map:
                    raw = raw_versioning or "Disabled"
                    normalized = str(raw).strip().lower()
                    if normalized == "enabled":
                        feature_map["versioning"] = active(raw)
                    elif normalized == "suspended":
                        feature_map["versioning"] = BucketFeatureStatus(state=raw, tone="unknown")
                    else:
                        feature_map["versioning"] = inactive(raw)

            if "object_lock" in requested:
                if use_props_bundle:
                    if props_error:
                        feature_map["object_lock"] = unavailable()
                    else:
                        enabled = bool((props.object_lock_enabled if props else None) is True)
                        feature_map["object_lock"] = active("Enabled") if enabled else inactive("Disabled")
                else:
                    try:
                        object_lock = self.get_bucket_object_lock(bucket.name, account)
                        enabled = bool(object_lock and object_lock.enabled is True)
                        feature_map["object_lock"] = active("Enabled") if enabled else inactive("Disabled")
                    except RuntimeError:
                        feature_map["object_lock"] = unavailable()

            if "block_public_access" in requested:
                cfg = None
                if use_props_bundle:
                    if props_error:
                        feature_map["block_public_access"] = unavailable()
                    else:
                        cfg = props.public_access_block if props else None
                else:
                    try:
                        cfg = self.get_public_access_block(bucket.name, account)
                    except RuntimeError:
                        feature_map["block_public_access"] = unavailable()
                if "block_public_access" not in feature_map:
                    if not cfg:
                        feature_map["block_public_access"] = inactive("Disabled")
                    else:
                        keys = [cfg.block_public_acls, cfg.ignore_public_acls, cfg.block_public_policy, cfg.restrict_public_buckets]
                        fully_enabled = all(val is True for val in keys)
                        partially_enabled = not fully_enabled and any(val is True for val in keys)
                        if fully_enabled:
                            feature_map["block_public_access"] = active("Enabled")
                        elif partially_enabled:
                            feature_map["block_public_access"] = active("Partial")
                        else:
                            feature_map["block_public_access"] = inactive("Disabled")

            if "lifecycle_rules" in requested:
                rules = None
                if use_props_bundle:
                    if props_error:
                        feature_map["lifecycle_rules"] = unavailable()
                    else:
                        rules = props.lifecycle_rules if props else []
                else:
                    try:
                        lifecycle = self.get_lifecycle(bucket.name, account)
                        rules = lifecycle.rules
                    except RuntimeError:
                        feature_map["lifecycle_rules"] = unavailable()
                if "lifecycle_rules" not in feature_map:
                    has_rules = bool(rules and len(rules) > 0)
                    feature_map["lifecycle_rules"] = active("Enabled") if has_rules else inactive("Disabled")

            if "cors" in requested:
                rules = None
                if use_props_bundle:
                    if props_error:
                        feature_map["cors"] = unavailable()
                    else:
                        rules = props.cors_rules if props else []
                else:
                    try:
                        rules = self.get_bucket_cors(bucket.name, account)
                    except RuntimeError:
                        feature_map["cors"] = unavailable()
                if "cors" not in feature_map:
                    has_rules = bool(rules and len(rules) > 0)
                    feature_map["cors"] = active("Configured") if has_rules else inactive("Not set")

            if wants_website and "static_website" in requested:
                try:
                    website = self.get_bucket_website(bucket.name, account)
                    routing_rules = website.routing_rules or []
                    configured = bool(
                        (website.redirect_all_requests_to and (website.redirect_all_requests_to.host_name or "").strip())
                        or (website.index_document or "").strip()
                        or (isinstance(routing_rules, list) and len(routing_rules) > 0)
                    )
                    feature_map["static_website"] = active("Enabled") if configured else inactive("Disabled")
                except RuntimeError:
                    feature_map["static_website"] = unavailable()

            if wants_policy and "bucket_policy" in requested:
                try:
                    policy = self.get_policy(bucket.name, account)
                    configured = bool(policy and isinstance(policy, dict) and len(policy.keys()) > 0)
                    feature_map["bucket_policy"] = active("Configured") if configured else inactive("Not set")
                except RuntimeError:
                    feature_map["bucket_policy"] = unavailable()

            if wants_logging and "access_logging" in requested:
                try:
                    logging_config = self.get_bucket_logging(bucket.name, account)
                    enabled = bool(logging_config.enabled and (logging_config.target_bucket or "").strip())
                    feature_map["access_logging"] = active("Enabled") if enabled else inactive("Disabled")
                except RuntimeError:
                    feature_map["access_logging"] = unavailable()

            if feature_map:
                features = feature_map

            if hasattr(bucket, "model_dump"):
                base = bucket.model_dump(exclude={"tags", "features"})
            else:
                base = bucket.dict(exclude={"tags", "features"})
            result.append(
                Bucket(
                    **base,
                    tags=tags,
                    features=features,
                )
            )

        return result

    def get_bucket_tags(self, name: str, account: S3Account) -> list[BucketTag]:
        access_key, secret_key = self._account_credentials(account)
        tags_raw = s3_client.get_bucket_tags(
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
        account: S3Account,
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
            "S3Account %s created bucket %s (versioning=%s object_lock=%s location=%s)",
            account.rgw_account_id or account.id,
            name,
            effective_versioning,
            object_lock_enabled,
            location_constraint,
        )

    def delete_bucket(self, name: str, account: S3Account, force: bool = False) -> None:
        access_key, secret_key = self._account_credentials(account)
        s3_client.delete_bucket(
            name, force=force, access_key=access_key, secret_key=secret_key, **self._client_kwargs(account)
        )
        logger.debug("S3Account %s deleted bucket %s force=%s", account.rgw_account_id or account.id, name, force)

    def set_versioning(self, name: str, account: S3Account, enabled: bool) -> None:
        access_key, secret_key = self._account_credentials(account)
        s3_client.set_bucket_versioning(
            name,
            enabled=enabled,
            access_key=access_key,
            secret_key=secret_key,
            **self._client_kwargs(account),
        )
        logger.debug("S3Account %s set versioning on bucket %s to %s", account.rgw_account_id or account.id, name, enabled)

    def get_bucket_properties(self, name: str, account: S3Account) -> BucketProperties:
        access_key, secret_key = self._account_credentials(account)
        versioning_status = s3_client.get_bucket_versioning(
            name, access_key=access_key, secret_key=secret_key, **self._client_kwargs(account)
        )
        public_access_block_raw = s3_client.get_bucket_public_access_block(
            name,
            access_key=access_key,
            secret_key=secret_key,
            **self._client_kwargs(account),
        )
        object_lock_raw = s3_client.get_bucket_object_lock(
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
        lifecycle_rules_raw = s3_client.get_bucket_lifecycle(
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
        cors_rules = s3_client.get_bucket_cors(
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

    def get_bucket_versioning_status(self, name: str, account: S3Account) -> str | None:
        access_key, secret_key = self._account_credentials(account)
        return s3_client.get_bucket_versioning(
            name, access_key=access_key, secret_key=secret_key, **self._client_kwargs(account)
        )

    def get_bucket_object_lock(self, name: str, account: S3Account) -> BucketObjectLock | None:
        access_key, secret_key = self._account_credentials(account)
        object_lock_raw = s3_client.get_bucket_object_lock(
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

    def get_bucket_cors(self, name: str, account: S3Account) -> list[dict]:
        access_key, secret_key = self._account_credentials(account)
        return s3_client.get_bucket_cors(
            name, access_key=access_key, secret_key=secret_key, **self._client_kwargs(account)
        )

    def get_public_access_block(self, name: str, account: S3Account) -> BucketPublicAccessBlock:
        access_key, secret_key = self._account_credentials(account)
        config = s3_client.get_bucket_public_access_block(
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
        account: S3Account,
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
        s3_client.set_bucket_public_access_block(
            name,
            configuration=config,
            access_key=access_key,
            secret_key=secret_key,
            **self._client_kwargs(account),
        )
        updated = s3_client.get_bucket_public_access_block(
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
        account: S3Account,
        payload: BucketQuotaUpdate,
        rgw_admin: Optional[RGWAdminClient] = None,
    ) -> None:
        account_id, tenant = resolve_account_scope(account.rgw_account_id)
        root_identifier = account_id or tenant
        root_uid = resolve_admin_uid(root_identifier, account.rgw_user_uid)
        if not root_uid:
            raise RuntimeError("Unable to set bucket quota: bucket owner uid is missing")
        client = rgw_admin or self._rgw_admin_for_account(account)
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

    def get_policy(self, name: str, account: S3Account) -> Optional[dict]:
        access_key, secret_key = self._account_credentials(account)
        return s3_client.get_bucket_policy(
            name, access_key=access_key, secret_key=secret_key, **self._client_kwargs(account)
        )

    def put_policy(self, name: str, account: S3Account, policy: dict) -> None:
        access_key, secret_key = self._account_credentials(account)
        s3_client.put_bucket_policy(
            name, policy=policy, access_key=access_key, secret_key=secret_key, **self._client_kwargs(account)
        )

    def delete_policy(self, name: str, account: S3Account) -> None:
        access_key, secret_key = self._account_credentials(account)
        s3_client.delete_bucket_policy(
            name, access_key=access_key, secret_key=secret_key, **self._client_kwargs(account)
        )

    def set_cors(self, name: str, account: S3Account, rules: list[dict]) -> None:
        access_key, secret_key = self._account_credentials(account)
        s3_client.put_bucket_cors(
            name, rules=rules, access_key=access_key, secret_key=secret_key, **self._client_kwargs(account)
        )

    def delete_cors(self, name: str, account: S3Account) -> None:
        access_key, secret_key = self._account_credentials(account)
        s3_client.delete_bucket_cors(
            name, access_key=access_key, secret_key=secret_key, **self._client_kwargs(account)
        )

    def get_lifecycle(self, name: str, account: S3Account) -> BucketLifecycleConfig:
        access_key, secret_key = self._account_credentials(account)
        rules = s3_client.get_bucket_lifecycle(
            name,
            access_key=access_key,
            secret_key=secret_key,
            **self._client_kwargs(account),
        )
        return BucketLifecycleConfig(rules=rules)

    def set_lifecycle(self, name: str, account: S3Account, rules: list[dict]) -> BucketLifecycleConfig:
        if not rules:
            self.delete_lifecycle(name, account)
            return BucketLifecycleConfig(rules=[])
        access_key, secret_key = self._account_credentials(account)
        try:
            s3_client.put_bucket_lifecycle(
                name,
                rules=rules,
                access_key=access_key,
                secret_key=secret_key,
                **self._client_kwargs(account),
            )
        except RuntimeError as exc:
            raise RuntimeError(f"Unable to set lifecycle rules: {exc}") from exc
        return self.get_lifecycle(name, account)

    def delete_lifecycle(self, name: str, account: S3Account) -> None:
        access_key, secret_key = self._account_credentials(account)
        s3_client.delete_bucket_lifecycle(
            name, access_key=access_key, secret_key=secret_key, **self._client_kwargs(account)
        )
        # Some RGW backends may return 204 but keep lifecycle rules.
        # Double-check and overwrite with an empty configuration to purge if needed.
        remaining = s3_client.get_bucket_lifecycle(
            name,
            access_key=access_key,
            secret_key=secret_key,
            **self._client_kwargs(account),
        )
        if remaining:
            try:
                s3_client.put_bucket_lifecycle(
                    name,
                    rules=[],
                    access_key=access_key,
                    secret_key=secret_key,
                    **self._client_kwargs(account),
                )
            except RuntimeError as exc:  # noqa: BLE001
                raise RuntimeError(f"Unable to delete bucket lifecycle: {exc}") from exc

    def set_bucket_tags(self, name: str, account: S3Account, tags: list[dict]) -> None:
        access_key, secret_key = self._account_credentials(account)
        s3_client.put_bucket_tags(
            name, tags=tags, access_key=access_key, secret_key=secret_key, **self._client_kwargs(account)
        )

    def delete_bucket_tags(self, name: str, account: S3Account) -> None:
        access_key, secret_key = self._account_credentials(account)
        s3_client.delete_bucket_tags(
            name, access_key=access_key, secret_key=secret_key, **self._client_kwargs(account)
        )

    def get_bucket_notifications(self, name: str, account: S3Account) -> BucketNotificationConfiguration:
        access_key, secret_key = self._account_credentials(account)
        config = s3_client.get_bucket_notifications(
            name,
            access_key=access_key,
            secret_key=secret_key,
            **self._client_kwargs(account),
        ) or {}
        return BucketNotificationConfiguration(configuration=config)

    def set_bucket_notifications(
        self,
        name: str,
        account: S3Account,
        configuration: dict,
    ) -> BucketNotificationConfiguration:
        access_key, secret_key = self._account_credentials(account)
        s3_client.put_bucket_notifications(
            name,
            config=configuration or {},
            access_key=access_key,
            secret_key=secret_key,
            **self._client_kwargs(account),
        )
        return self.get_bucket_notifications(name, account)

    def delete_bucket_notifications(self, name: str, account: S3Account) -> None:
        access_key, secret_key = self._account_credentials(account)
        s3_client.put_bucket_notifications(
            name,
            config={},
            access_key=access_key,
            secret_key=secret_key,
            **self._client_kwargs(account),
        )

    def get_bucket_logging(self, name: str, account: S3Account) -> BucketLoggingConfiguration:
        access_key, secret_key = self._account_credentials(account)
        config = s3_client.get_bucket_logging(
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
        account: S3Account,
        payload: BucketLoggingConfiguration,
    ) -> BucketLoggingConfiguration:
        access_key, secret_key = self._account_credentials(account)
        if not payload.enabled:
            s3_client.put_bucket_logging(
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
        s3_client.put_bucket_logging(
            name,
            logging_config=logging_config,
            access_key=access_key,
            secret_key=secret_key,
            **self._client_kwargs(account),
        )
        return self.get_bucket_logging(name, account)

    def delete_bucket_logging(self, name: str, account: S3Account) -> None:
        access_key, secret_key = self._account_credentials(account)
        s3_client.put_bucket_logging(
            name,
            logging_config=None,
            access_key=access_key,
            secret_key=secret_key,
            **self._client_kwargs(account),
        )

    def get_bucket_website(self, name: str, account: S3Account) -> BucketWebsiteConfiguration:
        access_key, secret_key = self._account_credentials(account)
        config = s3_client.get_bucket_website(
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
        account: S3Account,
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
        s3_client.put_bucket_website(
            name,
            configuration=config,
            access_key=access_key,
            secret_key=secret_key,
            **self._client_kwargs(account),
        )
        return self.get_bucket_website(name, account)

    def delete_bucket_website(self, name: str, account: S3Account) -> None:
        access_key, secret_key = self._account_credentials(account)
        s3_client.delete_bucket_website(
            name,
            access_key=access_key,
            secret_key=secret_key,
            **self._client_kwargs(account),
        )

    def get_bucket_acl(self, name: str, account: S3Account) -> BucketAcl:
        access_key, secret_key = self._account_credentials(account)
        acl_raw = s3_client.get_bucket_acl(
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

    def set_bucket_acl(self, name: str, account: S3Account, payload: BucketAclUpdate) -> BucketAcl:
        access_key, secret_key = self._account_credentials(account)
        s3_client.put_bucket_acl(
            name,
            acl=payload.acl,
            access_key=access_key,
            secret_key=secret_key,
            **self._client_kwargs(account),
        )
        return self.get_bucket_acl(name, account)

    def get_object_lock(self, name: str, account: S3Account) -> BucketObjectLock:
        access_key, secret_key = self._account_credentials(account)
        config = s3_client.get_bucket_object_lock(
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

    def set_object_lock(self, name: str, account: S3Account, payload: BucketObjectLockUpdate) -> BucketObjectLock:
        access_key, secret_key = self._account_credentials(account)
        current_config = s3_client.get_bucket_object_lock(
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
            s3_client.put_bucket_object_lock(
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
