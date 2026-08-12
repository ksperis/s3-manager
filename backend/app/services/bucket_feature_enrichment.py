# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from typing import Optional, Protocol

from app.models.bucket import (
    Bucket,
    BucketFeatureStatus,
    BucketLifecycleConfig,
    BucketLoggingConfiguration,
    BucketNotificationConfiguration,
    BucketObjectLock,
    BucketProperties,
    BucketPublicAccessBlock,
    BucketTag,
    BucketWebsiteConfiguration,
)
from app.services.bucket_notification_state import (
    account_sns_feature_enabled,
    is_bucket_notification_configuration_configured,
)
from app.services.s3_execution_context import S3ExecutionTarget


ALLOWED_BUCKET_FEATURES = {
    "tags",
    "versioning",
    "object_lock",
    "block_public_access",
    "lifecycle_rules",
    "static_website",
    "bucket_policy",
    "cors",
    "access_logging",
    "notifications",
}


class BucketFeatureReader(Protocol):
    def get_bucket_tags(self, name: str, account: S3ExecutionTarget) -> list[BucketTag]: ...

    def get_bucket_properties(self, name: str, account: S3ExecutionTarget) -> BucketProperties: ...

    def get_bucket_versioning_status(self, name: str, account: S3ExecutionTarget) -> str | None: ...

    def get_bucket_object_lock(self, name: str, account: S3ExecutionTarget) -> BucketObjectLock | None: ...

    def get_public_access_block(self, name: str, account: S3ExecutionTarget) -> BucketPublicAccessBlock: ...

    def get_lifecycle(self, name: str, account: S3ExecutionTarget) -> BucketLifecycleConfig: ...

    def get_bucket_cors(self, name: str, account: S3ExecutionTarget) -> list[dict]: ...

    def get_bucket_website(self, name: str, account: S3ExecutionTarget) -> BucketWebsiteConfiguration: ...

    def get_policy(self, name: str, account: S3ExecutionTarget) -> Optional[dict]: ...

    def get_bucket_logging(self, name: str, account: S3ExecutionTarget) -> BucketLoggingConfiguration: ...

    def get_bucket_notifications(self, name: str, account: S3ExecutionTarget) -> BucketNotificationConfiguration: ...


def enrich_bucket_features(
    reader: BucketFeatureReader,
    buckets: list[Bucket],
    account: S3ExecutionTarget,
    include: set[str],
) -> list[Bucket]:
    requested = {key for key in include if key in ALLOWED_BUCKET_FEATURES}
    if not requested:
        return buckets

    wants_tags = "tags" in requested
    props_feature_keys = {"versioning", "object_lock", "block_public_access", "lifecycle_rules", "cors"}
    use_props_bundle = len(requested & props_feature_keys) > 1
    sns_feature_enabled = account_sns_feature_enabled(account)

    result: list[Bucket] = []
    for bucket in buckets:
        tags: Optional[list[BucketTag]] = None
        if wants_tags:
            try:
                tags = reader.get_bucket_tags(bucket.name, account)
            except RuntimeError:
                tags = []

        feature_map: dict[str, BucketFeatureStatus] = {}
        properties: Optional[BucketProperties] = None
        properties_error = False
        if use_props_bundle:
            try:
                properties = reader.get_bucket_properties(bucket.name, account)
            except RuntimeError:
                properties_error = True

        if "versioning" in requested:
            raw_versioning: Optional[str] = None
            if use_props_bundle:
                if properties_error:
                    feature_map["versioning"] = _unavailable()
                else:
                    raw_versioning = properties.versioning_status if properties else None
            else:
                try:
                    raw_versioning = reader.get_bucket_versioning_status(bucket.name, account)
                except RuntimeError:
                    feature_map["versioning"] = _unavailable()
            if "versioning" not in feature_map:
                raw = raw_versioning or "Disabled"
                normalized = str(raw).strip().lower()
                if normalized == "enabled":
                    feature_map["versioning"] = _active(raw)
                elif normalized == "suspended":
                    feature_map["versioning"] = BucketFeatureStatus(state=raw, tone="unknown")
                else:
                    feature_map["versioning"] = _inactive(raw)

        if "object_lock" in requested:
            if use_props_bundle:
                if properties_error:
                    feature_map["object_lock"] = _unavailable()
                else:
                    enabled = bool((properties.object_lock_enabled if properties else None) is True)
                    feature_map["object_lock"] = _active("Enabled") if enabled else _inactive("Disabled")
            else:
                try:
                    object_lock = reader.get_bucket_object_lock(bucket.name, account)
                    enabled = bool(object_lock and object_lock.enabled is True)
                    feature_map["object_lock"] = _active("Enabled") if enabled else _inactive("Disabled")
                except RuntimeError:
                    feature_map["object_lock"] = _unavailable()

        if "block_public_access" in requested:
            config = None
            if use_props_bundle:
                if properties_error:
                    feature_map["block_public_access"] = _unavailable()
                else:
                    config = properties.public_access_block if properties else None
            else:
                try:
                    config = reader.get_public_access_block(bucket.name, account)
                except RuntimeError:
                    feature_map["block_public_access"] = _unavailable()
            if "block_public_access" not in feature_map:
                if not config:
                    feature_map["block_public_access"] = _inactive("Disabled")
                else:
                    values = [
                        config.block_public_acls,
                        config.ignore_public_acls,
                        config.block_public_policy,
                        config.restrict_public_buckets,
                    ]
                    fully_enabled = all(value is True for value in values)
                    partially_enabled = not fully_enabled and any(value is True for value in values)
                    if fully_enabled:
                        feature_map["block_public_access"] = _active("Enabled")
                    elif partially_enabled:
                        feature_map["block_public_access"] = _active("Partial")
                    else:
                        feature_map["block_public_access"] = _inactive("Disabled")

        if "lifecycle_rules" in requested:
            rules = None
            if use_props_bundle:
                if properties_error:
                    feature_map["lifecycle_rules"] = _unavailable()
                else:
                    rules = properties.lifecycle_rules if properties else []
            else:
                try:
                    rules = reader.get_lifecycle(bucket.name, account).rules
                except RuntimeError:
                    feature_map["lifecycle_rules"] = _unavailable()
            if "lifecycle_rules" not in feature_map:
                feature_map["lifecycle_rules"] = _active("Enabled") if rules else _inactive("Disabled")

        if "cors" in requested:
            rules = None
            if use_props_bundle:
                if properties_error:
                    feature_map["cors"] = _unavailable()
                else:
                    rules = properties.cors_rules if properties else []
            else:
                try:
                    rules = reader.get_bucket_cors(bucket.name, account)
                except RuntimeError:
                    feature_map["cors"] = _unavailable()
            if "cors" not in feature_map:
                feature_map["cors"] = _active("Configured") if rules else _inactive("Not set")

        if "static_website" in requested:
            try:
                website = reader.get_bucket_website(bucket.name, account)
                routing_rules = website.routing_rules or []
                configured = bool(
                    (website.redirect_all_requests_to and (website.redirect_all_requests_to.host_name or "").strip())
                    or (website.index_document or "").strip()
                    or (isinstance(routing_rules, list) and len(routing_rules) > 0)
                )
                feature_map["static_website"] = _active("Enabled") if configured else _inactive("Disabled")
            except RuntimeError:
                feature_map["static_website"] = _unavailable()

        if "bucket_policy" in requested:
            try:
                policy = reader.get_policy(bucket.name, account)
                configured = bool(policy and isinstance(policy, dict) and len(policy) > 0)
                feature_map["bucket_policy"] = _active("Configured") if configured else _inactive("Not set")
            except RuntimeError:
                feature_map["bucket_policy"] = _unavailable()

        if "access_logging" in requested:
            try:
                logging_config = reader.get_bucket_logging(bucket.name, account)
                enabled = bool(logging_config.enabled and (logging_config.target_bucket or "").strip())
                feature_map["access_logging"] = _active("Enabled") if enabled else _inactive("Disabled")
            except RuntimeError:
                feature_map["access_logging"] = _unavailable()

        if "notifications" in requested:
            if not sns_feature_enabled:
                feature_map["notifications"] = _unavailable()
            else:
                try:
                    notifications = reader.get_bucket_notifications(bucket.name, account)
                    configured = is_bucket_notification_configuration_configured(notifications.configuration)
                    feature_map["notifications"] = _active("Configured") if configured else _inactive("Not set")
                except RuntimeError:
                    feature_map["notifications"] = _unavailable()

        base = bucket.model_dump(exclude={"tags", "features"})
        result.append(Bucket(**base, tags=tags, features=feature_map or None))

    return result


def _unavailable() -> BucketFeatureStatus:
    return BucketFeatureStatus(state="Unavailable", tone="unknown")


def _inactive(state: str) -> BucketFeatureStatus:
    return BucketFeatureStatus(state=state, tone="inactive")


def _active(state: str) -> BucketFeatureStatus:
    return BucketFeatureStatus(state=state, tone="active")
