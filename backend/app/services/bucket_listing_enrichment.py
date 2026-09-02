# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from typing import Any, Callable

from app.models.bucket import (
    BucketFeatureStatus,
    BucketTag,
)
from app.models.ceph_admin import CephAdminBucketSummary
from app.services.bucket_feature_param_values import (
    dedupe_sorted_day_values,
    extract_cors_allowed_values,
    extract_lifecycle_abort_days,
    extract_lifecycle_expiration_days,
    extract_lifecycle_noncurrent_expiration_days,
    extract_lifecycle_transition_days,
    extract_notification_topic_names,
    extract_policy_statement_summary,
    extract_sse_values,
)
from app.services.bucket_notification_state import (
    account_sns_feature_enabled,
    is_bucket_notification_configuration_configured,
)
from app.services.bucket_configuration_service import BucketConfigurationService
from app.services.bucket_property_feature_enrichment import (
    BUCKET_PROPERTY_FEATURES,
    BucketPropertiesContext as _BucketPropertiesContext,
    active_feature_status as _feature_status_active,
    enrich_cors as _enrich_cors,
    enrich_lifecycle as _enrich_lifecycle,
    enrich_object_lock as _enrich_object_lock,
    enrich_public_access_block as _enrich_public_access_block,
    enrich_versioning as _enrich_versioning,
    inactive_feature_status as _feature_status_inactive,
    load_bucket_properties_context,
    unavailable_feature_status as _feature_status_unavailable,
)
from app.services.listing_progress import (
    ListingProgressEmitter,
    build_listing_progress_callback,
    invoke_cancel_check,
)
from app.services.s3_execution_context import S3ExecutionTarget

BUCKET_ENRICH_MAX_WORKERS = 6


_COLUMN_DETAIL_LIFECYCLE_KEYS = {
    "lifecycle_expiration_days",
    "lifecycle_noncurrent_expiration_days",
    "lifecycle_transition_days",
    "lifecycle_abort_multipart_days",
}
_COLUMN_DETAIL_OBJECT_LOCK_KEYS = {
    "object_lock_mode",
    "object_lock_retention_days",
    "object_lock_retention_years",
}
_COLUMN_DETAIL_BPA_KEYS = {
    "bpa_block_public_acls",
    "bpa_ignore_public_acls",
    "bpa_block_public_policy",
    "bpa_restrict_public_buckets",
}
_COLUMN_DETAIL_CORS_KEYS = {"cors_allowed_methods", "cors_allowed_origins"}
_COLUMN_DETAIL_LOGGING_KEYS = {"logging_target_bucket", "logging_target_prefix"}
_COLUMN_DETAIL_WEBSITE_KEYS = {
    "website_index_document",
    "website_error_document",
    "website_redirect_host",
    "website_routing_rule_count",
}
_COLUMN_DETAIL_POLICY_KEYS = {"policy_statement_count", "policy_has_conditions"}
_COLUMN_DETAIL_NOTIFICATION_KEYS = {"notification_topic_names"}
_COLUMN_DETAIL_SSE_KEYS = {"sse_algorithms", "sse_kms_key_ids"}
_COLUMN_DETAIL_PROPS_KEYS = _COLUMN_DETAIL_OBJECT_LOCK_KEYS | _COLUMN_DETAIL_BPA_KEYS | _COLUMN_DETAIL_CORS_KEYS
COLUMN_DETAIL_KEYS = (
    _COLUMN_DETAIL_LIFECYCLE_KEYS
    | _COLUMN_DETAIL_OBJECT_LOCK_KEYS
    | _COLUMN_DETAIL_BPA_KEYS
    | _COLUMN_DETAIL_CORS_KEYS
    | _COLUMN_DETAIL_LOGGING_KEYS
    | _COLUMN_DETAIL_WEBSITE_KEYS
    | _COLUMN_DETAIL_POLICY_KEYS
    | _COLUMN_DETAIL_NOTIFICATION_KEYS
    | _COLUMN_DETAIL_SSE_KEYS
)
BUCKET_FEATURE_INCLUDES = {
    "versioning",
    "object_lock",
    "block_public_access",
    "lifecycle_rules",
    "static_website",
    "bucket_policy",
    "cors",
    "access_logging",
    "notifications",
    "server_side_encryption",
}
BUCKET_LISTING_INCLUDES = BUCKET_FEATURE_INCLUDES | COLUMN_DETAIL_KEYS


def _mark_details_unavailable(column_details: dict[str, Any], detail_keys: set[str]) -> None:
    for key in detail_keys:
        column_details[key] = None


def _enrich_website_configuration(
    bucket: CephAdminBucketSummary,
    service: BucketConfigurationService,
    account: S3ExecutionTarget,
    *,
    wants_feature: bool,
    detail_keys: set[str],
    feature_map: dict[str, BucketFeatureStatus],
    column_details: dict[str, Any],
) -> None:
    try:
        website = service.get_bucket_website(bucket.name, account)
    except RuntimeError:
        if wants_feature:
            feature_map["static_website"] = _feature_status_unavailable()
        _mark_details_unavailable(column_details, detail_keys)
        return

    routing_rules = website.routing_rules or []
    configured = bool(
        (website.redirect_all_requests_to and (website.redirect_all_requests_to.host_name or "").strip())
        or (website.index_document or "").strip()
        or (isinstance(routing_rules, list) and len(routing_rules) > 0)
    )
    if wants_feature:
        feature_map["static_website"] = (
            _feature_status_active("Enabled") if configured else _feature_status_inactive("Disabled")
        )
    if "website_index_document" in detail_keys:
        column_details["website_index_document"] = (website.index_document or "").strip() or None
    if "website_error_document" in detail_keys:
        column_details["website_error_document"] = (website.error_document or "").strip() or None
    if "website_redirect_host" in detail_keys:
        redirect_host = (
            (website.redirect_all_requests_to.host_name or "").strip()
            if website.redirect_all_requests_to
            else ""
        )
        column_details["website_redirect_host"] = redirect_host or None
    if "website_routing_rule_count" in detail_keys:
        column_details["website_routing_rule_count"] = len(routing_rules) if isinstance(routing_rules, list) else 0


def _enrich_policy_configuration(
    bucket: CephAdminBucketSummary,
    service: BucketConfigurationService,
    account: S3ExecutionTarget,
    *,
    wants_feature: bool,
    detail_keys: set[str],
    feature_map: dict[str, BucketFeatureStatus],
    column_details: dict[str, Any],
) -> None:
    try:
        policy = service.get_policy(bucket.name, account)
    except RuntimeError:
        if wants_feature:
            feature_map["bucket_policy"] = _feature_status_unavailable()
        _mark_details_unavailable(column_details, detail_keys)
        return

    configured = bool(policy and isinstance(policy, dict) and len(policy.keys()) > 0)
    if wants_feature:
        feature_map["bucket_policy"] = (
            _feature_status_active("Configured") if configured else _feature_status_inactive("Not set")
        )
    statement_count, has_conditions = extract_policy_statement_summary(policy if isinstance(policy, dict) else None)
    if "policy_statement_count" in detail_keys:
        column_details["policy_statement_count"] = statement_count
    if "policy_has_conditions" in detail_keys:
        column_details["policy_has_conditions"] = has_conditions


def _enrich_logging_configuration(
    bucket: CephAdminBucketSummary,
    service: BucketConfigurationService,
    account: S3ExecutionTarget,
    *,
    wants_feature: bool,
    detail_keys: set[str],
    feature_map: dict[str, BucketFeatureStatus],
    column_details: dict[str, Any],
) -> None:
    try:
        logging_config = service.get_bucket_logging(bucket.name, account)
    except RuntimeError:
        if wants_feature:
            feature_map["access_logging"] = _feature_status_unavailable()
        _mark_details_unavailable(column_details, detail_keys)
        return

    enabled = bool(logging_config.enabled and (logging_config.target_bucket or "").strip())
    if wants_feature:
        feature_map["access_logging"] = (
            _feature_status_active("Enabled") if enabled else _feature_status_inactive("Disabled")
        )
    if "logging_target_bucket" in detail_keys:
        column_details["logging_target_bucket"] = (logging_config.target_bucket or "").strip() or None
    if "logging_target_prefix" in detail_keys:
        column_details["logging_target_prefix"] = (logging_config.target_prefix or "").strip() or None


def _enrich_notification_configuration(
    bucket: CephAdminBucketSummary,
    service: BucketConfigurationService,
    account: S3ExecutionTarget,
    *,
    sns_feature_enabled: bool,
    wants_feature: bool,
    detail_keys: set[str],
    feature_map: dict[str, BucketFeatureStatus],
    column_details: dict[str, Any],
) -> None:
    if not sns_feature_enabled:
        if wants_feature:
            feature_map["notifications"] = _feature_status_unavailable()
        _mark_details_unavailable(column_details, detail_keys)
        return

    try:
        notifications = service.get_bucket_notifications(bucket.name, account)
    except RuntimeError:
        if wants_feature:
            feature_map["notifications"] = _feature_status_unavailable()
        _mark_details_unavailable(column_details, detail_keys)
        return

    configuration = notifications.configuration or {}
    if wants_feature:
        configured = is_bucket_notification_configuration_configured(configuration)
        feature_map["notifications"] = (
            _feature_status_active("Configured") if configured else _feature_status_inactive("Not set")
        )
    if "notification_topic_names" in detail_keys:
        column_details["notification_topic_names"] = extract_notification_topic_names(configuration)


def _enrich_encryption_configuration(
    bucket: CephAdminBucketSummary,
    service: BucketConfigurationService,
    account: S3ExecutionTarget,
    *,
    wants_feature: bool,
    detail_keys: set[str],
    feature_map: dict[str, BucketFeatureStatus],
    column_details: dict[str, Any],
) -> None:
    try:
        encryption = service.get_bucket_encryption(bucket.name, account)
    except RuntimeError:
        if wants_feature:
            feature_map["server_side_encryption"] = _feature_status_unavailable()
        _mark_details_unavailable(column_details, detail_keys)
        return

    enabled = bool(encryption.rules and len(encryption.rules) > 0)
    if wants_feature:
        feature_map["server_side_encryption"] = (
            _feature_status_active("Enabled") if enabled else _feature_status_inactive("Disabled")
        )
    if "sse_algorithms" in detail_keys:
        column_details["sse_algorithms"] = extract_sse_values(encryption, "sse_algorithm")
    if "sse_kms_key_ids" in detail_keys:
        column_details["sse_kms_key_ids"] = extract_sse_values(encryption, "sse_kms_key_id")


def _project_lifecycle_details(
    rules: list[dict[str, Any]],
    detail_keys: set[str],
    column_details: dict[str, Any],
) -> None:
    if "lifecycle_expiration_days" in detail_keys:
        values = [extract_lifecycle_expiration_days(rule) for rule in rules]
        column_details["lifecycle_expiration_days"] = dedupe_sorted_day_values(
            [value for value in values if value is not None]
        )
    if "lifecycle_noncurrent_expiration_days" in detail_keys:
        values = [extract_lifecycle_noncurrent_expiration_days(rule) for rule in rules]
        column_details["lifecycle_noncurrent_expiration_days"] = dedupe_sorted_day_values(
            [value for value in values if value is not None]
        )
    if "lifecycle_transition_days" in detail_keys:
        values: list[float] = []
        for rule in rules:
            values.extend(extract_lifecycle_transition_days(rule))
        column_details["lifecycle_transition_days"] = dedupe_sorted_day_values(values)
    if "lifecycle_abort_multipart_days" in detail_keys:
        values = [extract_lifecycle_abort_days(rule) for rule in rules]
        column_details["lifecycle_abort_multipart_days"] = dedupe_sorted_day_values(
            [value for value in values if value is not None]
        )


def _enrich_lifecycle_configuration(
    context: _BucketPropertiesContext,
    *,
    wants_feature: bool,
    detail_keys: set[str],
    feature_map: dict[str, BucketFeatureStatus],
    column_details: dict[str, Any],
) -> None:
    if not detail_keys:
        if wants_feature:
            _enrich_lifecycle(context, feature_map)
        return

    try:
        raw_rules = context.reader.get_lifecycle(context.bucket_name, context.account).rules or []
    except RuntimeError:
        if wants_feature:
            feature_map["lifecycle_rules"] = _feature_status_unavailable()
        _mark_details_unavailable(column_details, detail_keys)
        return

    if wants_feature:
        feature_map["lifecycle_rules"] = (
            _feature_status_active("Enabled") if raw_rules else _feature_status_inactive("Disabled")
        )
    normalized_rules = [item for item in raw_rules if isinstance(item, dict)]
    _project_lifecycle_details(normalized_rules, detail_keys, column_details)


def _project_property_details(
    context: _BucketPropertiesContext,
    detail_keys: set[str],
    column_details: dict[str, Any],
) -> None:
    if context.unavailable or context.properties is None:
        _mark_details_unavailable(column_details, detail_keys)
        return

    properties = context.properties
    object_lock = properties.object_lock
    if "object_lock_mode" in detail_keys:
        column_details["object_lock_mode"] = object_lock.mode if object_lock else None
    if "object_lock_retention_days" in detail_keys:
        column_details["object_lock_retention_days"] = object_lock.days if object_lock else None
    if "object_lock_retention_years" in detail_keys:
        column_details["object_lock_retention_years"] = object_lock.years if object_lock else None

    public_access_block = properties.public_access_block
    if "bpa_block_public_acls" in detail_keys:
        column_details["bpa_block_public_acls"] = public_access_block.block_public_acls if public_access_block else None
    if "bpa_ignore_public_acls" in detail_keys:
        column_details["bpa_ignore_public_acls"] = public_access_block.ignore_public_acls if public_access_block else None
    if "bpa_block_public_policy" in detail_keys:
        column_details["bpa_block_public_policy"] = (
            public_access_block.block_public_policy if public_access_block else None
        )
    if "bpa_restrict_public_buckets" in detail_keys:
        column_details["bpa_restrict_public_buckets"] = (
            public_access_block.restrict_public_buckets if public_access_block else None
        )

    cors_rules = properties.cors_rules if isinstance(properties.cors_rules, list) else []
    if "cors_allowed_methods" in detail_keys:
        column_details["cors_allowed_methods"] = extract_cors_allowed_values(cors_rules, "cors_allowed_method")
    if "cors_allowed_origins" in detail_keys:
        column_details["cors_allowed_origins"] = extract_cors_allowed_values(cors_rules, "cors_allowed_origin")


@dataclass(frozen=True)
class _BucketEnrichmentPlan:
    requested: set[str]
    include_tags: bool
    sns_feature_enabled: bool
    lifecycle_details: set[str]
    property_details: set[str]
    logging_details: set[str]
    website_details: set[str]
    policy_details: set[str]
    notification_details: set[str]
    encryption_details: set[str]
    use_properties_bundle: bool

    @classmethod
    def build(
        cls,
        requested: set[str],
        *,
        include_tags: bool,
        account: S3ExecutionTarget,
    ) -> "_BucketEnrichmentPlan":
        selected = set(requested)
        property_details = selected & _COLUMN_DETAIL_PROPS_KEYS
        requested_property_features = selected & BUCKET_PROPERTY_FEATURES
        return cls(
            requested=selected,
            include_tags=include_tags,
            sns_feature_enabled=account_sns_feature_enabled(account),
            lifecycle_details=selected & _COLUMN_DETAIL_LIFECYCLE_KEYS,
            property_details=property_details,
            logging_details=selected & _COLUMN_DETAIL_LOGGING_KEYS,
            website_details=selected & _COLUMN_DETAIL_WEBSITE_KEYS,
            policy_details=selected & _COLUMN_DETAIL_POLICY_KEYS,
            notification_details=selected & _COLUMN_DETAIL_NOTIFICATION_KEYS,
            encryption_details=selected & _COLUMN_DETAIL_SSE_KEYS,
            use_properties_bundle=(
                len(requested_property_features) > 1 or bool(property_details)
            ),
        )

    def wants(self, feature: str) -> bool:
        return feature in self.requested


class _BucketEnricher:
    def __init__(
        self,
        *,
        plan: _BucketEnrichmentPlan,
        service: BucketConfigurationService,
        account: S3ExecutionTarget,
    ) -> None:
        self.plan = plan
        self.service = service
        self.account = account

    def enrich(self, bucket: CephAdminBucketSummary) -> CephAdminBucketSummary:
        tags = self._load_tags(bucket)
        feature_map: dict[str, BucketFeatureStatus] = {}
        column_details: dict[str, Any] = {}
        properties = load_bucket_properties_context(
            self.service,
            bucket.name,
            self.account,
            uses_bundle=self.plan.use_properties_bundle,
        )
        self._enrich_property_features(properties, feature_map, column_details)
        self._enrich_configuration_features(bucket, feature_map, column_details)
        return self._project_bucket(bucket, tags, feature_map, column_details)

    def _load_tags(
        self,
        bucket: CephAdminBucketSummary,
    ) -> list[BucketTag] | None:
        if not self.plan.include_tags:
            return None
        try:
            return self.service.get_bucket_tags(bucket.name, self.account)
        except RuntimeError:
            return []

    def _enrich_property_features(
        self,
        context: _BucketPropertiesContext,
        feature_map: dict[str, BucketFeatureStatus],
        column_details: dict[str, Any],
    ) -> None:
        if self.plan.wants("versioning"):
            _enrich_versioning(context, feature_map)
        if self.plan.wants("object_lock"):
            _enrich_object_lock(context, feature_map)
        if self.plan.wants("block_public_access"):
            _enrich_public_access_block(context, feature_map)
        if self.plan.wants("lifecycle_rules") or self.plan.lifecycle_details:
            _enrich_lifecycle_configuration(
                context,
                wants_feature=self.plan.wants("lifecycle_rules"),
                detail_keys=self.plan.lifecycle_details,
                feature_map=feature_map,
                column_details=column_details,
            )
        if self.plan.wants("cors"):
            _enrich_cors(context, feature_map)
        if self.plan.property_details:
            _project_property_details(
                context,
                self.plan.property_details,
                column_details,
            )

    def _enrich_configuration_features(
        self,
        bucket: CephAdminBucketSummary,
        feature_map: dict[str, BucketFeatureStatus],
        column_details: dict[str, Any],
    ) -> None:
        if self.plan.wants("static_website") or self.plan.website_details:
            _enrich_website_configuration(
                bucket,
                self.service,
                self.account,
                wants_feature=self.plan.wants("static_website"),
                detail_keys=self.plan.website_details,
                feature_map=feature_map,
                column_details=column_details,
            )
        if self.plan.wants("bucket_policy") or self.plan.policy_details:
            _enrich_policy_configuration(
                bucket,
                self.service,
                self.account,
                wants_feature=self.plan.wants("bucket_policy"),
                detail_keys=self.plan.policy_details,
                feature_map=feature_map,
                column_details=column_details,
            )
        if self.plan.wants("access_logging") or self.plan.logging_details:
            _enrich_logging_configuration(
                bucket,
                self.service,
                self.account,
                wants_feature=self.plan.wants("access_logging"),
                detail_keys=self.plan.logging_details,
                feature_map=feature_map,
                column_details=column_details,
            )
        if self.plan.wants("notifications") or self.plan.notification_details:
            _enrich_notification_configuration(
                bucket,
                self.service,
                self.account,
                sns_feature_enabled=self.plan.sns_feature_enabled,
                wants_feature=self.plan.wants("notifications"),
                detail_keys=self.plan.notification_details,
                feature_map=feature_map,
                column_details=column_details,
            )
        if self.plan.wants("server_side_encryption") or self.plan.encryption_details:
            _enrich_encryption_configuration(
                bucket,
                self.service,
                self.account,
                wants_feature=self.plan.wants("server_side_encryption"),
                detail_keys=self.plan.encryption_details,
                feature_map=feature_map,
                column_details=column_details,
            )

    @staticmethod
    def _project_bucket(
        bucket: CephAdminBucketSummary,
        tags: list[BucketTag] | None,
        feature_map: dict[str, BucketFeatureStatus],
        column_details: dict[str, Any],
    ) -> CephAdminBucketSummary:
        update: dict[str, Any] = {}
        if tags is not None:
            update["tags"] = tags
        if feature_map:
            update["features"] = feature_map
        if column_details:
            update["column_details"] = column_details
        if not update:
            return bucket
        return CephAdminBucketSummary(
            **{
                **bucket.model_dump(),
                **update,
            }
        )


def enrich_buckets(
    buckets: list[CephAdminBucketSummary],
    requested: set[str],
    include_tags: bool,
    service: BucketConfigurationService,
    account: S3ExecutionTarget,
    *,
    progress: ListingProgressEmitter | None = None,
    progress_stage: str = "bucket_enrichment",
    progress_message: str = "Loading bucket details",
    progress_start: int = 75,
    progress_end: int = 88,
    cancel_check: Callable[[], None] | None = None,
) -> list[CephAdminBucketSummary]:
    if not buckets or (not requested and not include_tags):
        return buckets
    plan = _BucketEnrichmentPlan.build(
        requested,
        include_tags=include_tags,
        account=account,
    )
    enricher = _BucketEnricher(
        plan=plan,
        service=service,
        account=account,
    )

    max_workers = min(BUCKET_ENRICH_MAX_WORKERS, len(buckets))
    total = len(buckets)
    emit_progress = build_listing_progress_callback(
        progress,
        stage=progress_stage,
        message=progress_message,
        start=progress_start,
        end=progress_end,
        total=total,
    )

    if max_workers <= 1:
        enriched = []
        for index, bucket in enumerate(buckets, start=1):
            invoke_cancel_check(cancel_check)
            enriched.append(enricher.enrich(bucket))
            emit_progress(index)
            invoke_cancel_check(cancel_check)
        return enriched

    # Bucket-level S3 reads are network-bound and independent; run a bounded parallel fan-out.
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {
            executor.submit(enricher.enrich, bucket): index
            for index, bucket in enumerate(buckets)
        }
        enriched: list[CephAdminBucketSummary | None] = [None] * len(buckets)
        for processed, future in enumerate(as_completed(futures), start=1):
            invoke_cancel_check(cancel_check)
            enriched[futures[future]] = future.result()
            emit_progress(processed)
            invoke_cancel_check(cancel_check)
        return [bucket for bucket in enriched if bucket is not None]
