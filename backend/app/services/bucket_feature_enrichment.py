# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Protocol

from app.models.bucket import (
    Bucket,
    BucketFeatureStatus,
    BucketLoggingConfiguration,
    BucketNotificationConfiguration,
    BucketTag,
    BucketWebsiteConfiguration,
)
from app.services.bucket_notification_state import (
    account_sns_feature_enabled,
    is_bucket_notification_configuration_configured,
)
from app.services.bucket_property_feature_enrichment import (
    BUCKET_PROPERTY_FEATURES,
    BucketPropertyFeatureReader,
    active_feature_status,
    enrich_cors,
    enrich_lifecycle,
    enrich_object_lock,
    enrich_public_access_block,
    enrich_versioning,
    inactive_feature_status,
    load_bucket_properties_context,
    unavailable_feature_status,
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


class BucketFeatureReader(BucketPropertyFeatureReader, Protocol):
    def get_bucket_tags(self, name: str, account: S3ExecutionTarget) -> list[BucketTag]: ...

    def get_bucket_website(self, name: str, account: S3ExecutionTarget) -> BucketWebsiteConfiguration: ...

    def get_policy(self, name: str, account: S3ExecutionTarget) -> dict | None: ...

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
    use_props_bundle = len(requested & BUCKET_PROPERTY_FEATURES) > 1
    sns_feature_enabled = account_sns_feature_enabled(account)

    result: list[Bucket] = []
    for bucket in buckets:
        tags: list[BucketTag] | None = None
        if wants_tags:
            try:
                tags = reader.get_bucket_tags(bucket.name, account)
            except RuntimeError:
                tags = []

        feature_map: dict[str, BucketFeatureStatus] = {}
        properties_context = load_bucket_properties_context(
            reader,
            bucket.name,
            account,
            uses_bundle=use_props_bundle,
        )

        if "versioning" in requested:
            enrich_versioning(properties_context, feature_map)

        if "object_lock" in requested:
            enrich_object_lock(properties_context, feature_map)

        if "block_public_access" in requested:
            enrich_public_access_block(properties_context, feature_map)

        if "lifecycle_rules" in requested:
            enrich_lifecycle(properties_context, feature_map)

        if "cors" in requested:
            enrich_cors(properties_context, feature_map)

        if "static_website" in requested:
            try:
                website = reader.get_bucket_website(bucket.name, account)
                routing_rules = website.routing_rules or []
                configured = bool(
                    (website.redirect_all_requests_to and (website.redirect_all_requests_to.host_name or "").strip())
                    or (website.index_document or "").strip()
                    or (isinstance(routing_rules, list) and len(routing_rules) > 0)
                )
                feature_map["static_website"] = (
                    active_feature_status("Enabled") if configured else inactive_feature_status("Disabled")
                )
            except RuntimeError:
                feature_map["static_website"] = unavailable_feature_status()

        if "bucket_policy" in requested:
            try:
                policy = reader.get_policy(bucket.name, account)
                configured = bool(policy and isinstance(policy, dict) and len(policy) > 0)
                feature_map["bucket_policy"] = (
                    active_feature_status("Configured") if configured else inactive_feature_status("Not set")
                )
            except RuntimeError:
                feature_map["bucket_policy"] = unavailable_feature_status()

        if "access_logging" in requested:
            try:
                logging_config = reader.get_bucket_logging(bucket.name, account)
                enabled = bool(logging_config.enabled and (logging_config.target_bucket or "").strip())
                feature_map["access_logging"] = (
                    active_feature_status("Enabled") if enabled else inactive_feature_status("Disabled")
                )
            except RuntimeError:
                feature_map["access_logging"] = unavailable_feature_status()

        if "notifications" in requested:
            if not sns_feature_enabled:
                feature_map["notifications"] = unavailable_feature_status()
            else:
                try:
                    notifications = reader.get_bucket_notifications(bucket.name, account)
                    configured = is_bucket_notification_configuration_configured(notifications.configuration)
                    feature_map["notifications"] = (
                        active_feature_status("Configured")
                        if configured
                        else inactive_feature_status("Not set")
                    )
                except RuntimeError:
                    feature_map["notifications"] = unavailable_feature_status()

        base = bucket.model_dump(exclude={"tags", "features"})
        result.append(Bucket(**base, tags=tags, features=feature_map or None))

    return result
