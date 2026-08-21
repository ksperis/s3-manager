# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from app.models.bucket import (
    BucketFeatureStatus,
    BucketLifecycleConfig,
    BucketObjectLock,
    BucketProperties,
    BucketPublicAccessBlock,
)
from app.services.s3_execution_context import S3ExecutionTarget

BUCKET_PROPERTY_FEATURES = frozenset(
    {"versioning", "object_lock", "block_public_access", "lifecycle_rules", "cors"}
)


class BucketPropertyFeatureReader(Protocol):
    def get_bucket_properties(self, name: str, account: S3ExecutionTarget) -> BucketProperties: ...

    def get_bucket_versioning_status(self, name: str, account: S3ExecutionTarget) -> str | None: ...

    def get_bucket_object_lock(self, name: str, account: S3ExecutionTarget) -> BucketObjectLock | None: ...

    def get_public_access_block(self, name: str, account: S3ExecutionTarget) -> BucketPublicAccessBlock: ...

    def get_lifecycle(self, name: str, account: S3ExecutionTarget) -> BucketLifecycleConfig: ...

    def get_bucket_cors(self, name: str, account: S3ExecutionTarget) -> list[dict]: ...


@dataclass(frozen=True)
class BucketPropertiesContext:
    bucket_name: str
    reader: BucketPropertyFeatureReader
    account: S3ExecutionTarget
    uses_bundle: bool
    properties: BucketProperties | None
    unavailable: bool


def load_bucket_properties_context(
    reader: BucketPropertyFeatureReader,
    bucket_name: str,
    account: S3ExecutionTarget,
    *,
    uses_bundle: bool,
) -> BucketPropertiesContext:
    properties: BucketProperties | None = None
    unavailable = False
    if uses_bundle:
        try:
            properties = reader.get_bucket_properties(bucket_name, account)
        except RuntimeError:
            unavailable = True
    return BucketPropertiesContext(
        bucket_name=bucket_name,
        reader=reader,
        account=account,
        uses_bundle=uses_bundle,
        properties=properties,
        unavailable=unavailable,
    )


def enrich_versioning(
    context: BucketPropertiesContext,
    feature_map: dict[str, BucketFeatureStatus],
) -> None:
    raw_versioning: str | None = None
    if context.uses_bundle:
        if context.unavailable:
            feature_map["versioning"] = unavailable_feature_status()
            return
        raw_versioning = context.properties.versioning_status if context.properties else None
    else:
        try:
            raw_versioning = context.reader.get_bucket_versioning_status(context.bucket_name, context.account)
        except RuntimeError:
            feature_map["versioning"] = unavailable_feature_status()
            return

    raw = raw_versioning or "Disabled"
    normalized = str(raw).strip().lower()
    if normalized == "enabled":
        feature_map["versioning"] = active_feature_status(raw)
    elif normalized == "suspended":
        feature_map["versioning"] = BucketFeatureStatus(state=raw, tone="unknown")
    else:
        feature_map["versioning"] = inactive_feature_status(raw)


def enrich_object_lock(
    context: BucketPropertiesContext,
    feature_map: dict[str, BucketFeatureStatus],
) -> None:
    if context.uses_bundle:
        if context.unavailable:
            feature_map["object_lock"] = unavailable_feature_status()
            return
        enabled = bool((context.properties.object_lock_enabled if context.properties else None) is True)
    else:
        try:
            object_lock = context.reader.get_bucket_object_lock(context.bucket_name, context.account)
        except RuntimeError:
            feature_map["object_lock"] = unavailable_feature_status()
            return
        enabled = bool(object_lock and object_lock.enabled is True)

    feature_map["object_lock"] = (
        active_feature_status("Enabled") if enabled else inactive_feature_status("Disabled")
    )


def enrich_public_access_block(
    context: BucketPropertiesContext,
    feature_map: dict[str, BucketFeatureStatus],
) -> None:
    if context.uses_bundle:
        if context.unavailable:
            feature_map["block_public_access"] = unavailable_feature_status()
            return
        config = context.properties.public_access_block if context.properties else None
    else:
        try:
            config = context.reader.get_public_access_block(context.bucket_name, context.account)
        except RuntimeError:
            feature_map["block_public_access"] = unavailable_feature_status()
            return

    if not config:
        feature_map["block_public_access"] = inactive_feature_status("Disabled")
        return

    values = (
        config.block_public_acls,
        config.ignore_public_acls,
        config.block_public_policy,
        config.restrict_public_buckets,
    )
    if all(value is True for value in values):
        feature_map["block_public_access"] = active_feature_status("Enabled")
    elif any(value is True for value in values):
        feature_map["block_public_access"] = active_feature_status("Partial")
    else:
        feature_map["block_public_access"] = inactive_feature_status("Disabled")


def enrich_lifecycle(
    context: BucketPropertiesContext,
    feature_map: dict[str, BucketFeatureStatus],
) -> None:
    if context.uses_bundle:
        if context.unavailable:
            feature_map["lifecycle_rules"] = unavailable_feature_status()
            return
        rules = context.properties.lifecycle_rules if context.properties else []
    else:
        try:
            rules = context.reader.get_lifecycle(context.bucket_name, context.account).rules or []
        except RuntimeError:
            feature_map["lifecycle_rules"] = unavailable_feature_status()
            return

    feature_map["lifecycle_rules"] = (
        active_feature_status("Enabled") if rules else inactive_feature_status("Disabled")
    )


def enrich_cors(
    context: BucketPropertiesContext,
    feature_map: dict[str, BucketFeatureStatus],
) -> None:
    if context.uses_bundle:
        if context.unavailable:
            feature_map["cors"] = unavailable_feature_status()
            return
        rules = context.properties.cors_rules if context.properties else []
    else:
        try:
            rules = context.reader.get_bucket_cors(context.bucket_name, context.account) or []
        except RuntimeError:
            feature_map["cors"] = unavailable_feature_status()
            return

    feature_map["cors"] = active_feature_status("Configured") if rules else inactive_feature_status("Not set")


def unavailable_feature_status() -> BucketFeatureStatus:
    return BucketFeatureStatus(state="Unavailable", tone="unknown")


def inactive_feature_status(state: str) -> BucketFeatureStatus:
    return BucketFeatureStatus(state=state, tone="inactive")


def active_feature_status(state: str) -> BucketFeatureStatus:
    return BucketFeatureStatus(state=state, tone="active")
