# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import json
from typing import Any, Optional, Protocol

from app.models.bucket import BucketLoggingConfiguration, BucketProperties, BucketTag
from app.models.bucket_compare import BucketConfigDiff, BucketConfigDiffSection
from app.services.s3_execution_context import S3ExecutionTarget
from app.utils.jsonable import model_to_jsonable


class BucketConfigurationReader(Protocol):
    def get_bucket_properties(self, name: str, account: S3ExecutionTarget) -> BucketProperties: ...

    def get_policy(self, name: str, account: S3ExecutionTarget) -> Optional[dict]: ...

    def get_bucket_logging(self, name: str, account: S3ExecutionTarget) -> BucketLoggingConfiguration: ...

    def get_bucket_tags(self, name: str, account: S3ExecutionTarget) -> list[BucketTag]: ...


def compare_bucket_configuration(
    reader: BucketConfigurationReader,
    source_bucket: str,
    source_account: S3ExecutionTarget,
    target_bucket: str,
    target_account: S3ExecutionTarget,
    *,
    include_sections: Optional[set[str]] = None,
) -> BucketConfigDiff:
    allowed_section_keys = {
        "versioning_status",
        "object_lock",
        "public_access_block",
        "lifecycle_rules",
        "cors_rules",
        "bucket_policy",
        "access_logging",
        "tags",
    }
    selected_section_keys = (
        allowed_section_keys if include_sections is None else {key for key in include_sections if key in allowed_section_keys}
    )
    if not selected_section_keys:
        return BucketConfigDiff(changed=False, sections=[])

    needs_properties = bool(
        selected_section_keys & {"versioning_status", "object_lock", "public_access_block", "lifecycle_rules", "cors_rules"}
    )
    source_properties: Optional[BucketProperties] = None
    target_properties: Optional[BucketProperties] = None
    if needs_properties:
        source_properties = reader.get_bucket_properties(source_bucket, source_account)
        target_properties = reader.get_bucket_properties(target_bucket, target_account)
        assert source_properties is not None
        assert target_properties is not None

    source_policy: Optional[dict] = None
    target_policy: Optional[dict] = None
    if "bucket_policy" in selected_section_keys:
        source_policy = reader.get_policy(source_bucket, source_account)
        target_policy = reader.get_policy(target_bucket, target_account)

    source_logging: Any = None
    target_logging: Any = None
    if "access_logging" in selected_section_keys:
        source_logging = model_to_jsonable(reader.get_bucket_logging(source_bucket, source_account))
        target_logging = model_to_jsonable(reader.get_bucket_logging(target_bucket, target_account))

    source_tags: list[dict[str, str]] = []
    target_tags: list[dict[str, str]] = []
    if "tags" in selected_section_keys:
        source_tags = _normalize_tags(reader.get_bucket_tags(source_bucket, source_account))
        target_tags = _normalize_tags(reader.get_bucket_tags(target_bucket, target_account))

    sections_data: list[tuple[str, str, Any, Any]] = []
    if "versioning_status" in selected_section_keys:
        sections_data.append(
            ("versioning_status", "Versioning", source_properties.versioning_status, target_properties.versioning_status)
        )
    if "object_lock" in selected_section_keys:
        sections_data.append(
            (
                "object_lock",
                "Object lock",
                model_to_jsonable(source_properties.object_lock),
                model_to_jsonable(target_properties.object_lock),
            )
        )
    if "public_access_block" in selected_section_keys:
        sections_data.append(
            (
                "public_access_block",
                "Public access block",
                model_to_jsonable(source_properties.public_access_block),
                model_to_jsonable(target_properties.public_access_block),
            )
        )
    if "lifecycle_rules" in selected_section_keys:
        sections_data.append(
            (
                "lifecycle_rules",
                "Lifecycle rules",
                [model_to_jsonable(rule) for rule in source_properties.lifecycle_rules],
                [model_to_jsonable(rule) for rule in target_properties.lifecycle_rules],
            )
        )
    if "cors_rules" in selected_section_keys:
        sections_data.append(
            ("cors_rules", "CORS rules", source_properties.cors_rules or [], target_properties.cors_rules or [])
        )
    if "bucket_policy" in selected_section_keys:
        sections_data.append(("bucket_policy", "Bucket policy", source_policy, target_policy))
    if "access_logging" in selected_section_keys:
        sections_data.append(("access_logging", "Access logging", source_logging, target_logging))
    if "tags" in selected_section_keys:
        sections_data.append(("tags", "Tags", source_tags, target_tags))

    changed = False
    sections: list[BucketConfigDiffSection] = []
    for key, label, source_value, target_value in sections_data:
        section_changed = _stable_value(source_value) != _stable_value(target_value)
        changed = changed or section_changed
        sections.append(
            BucketConfigDiffSection(
                key=key,
                label=label,
                source=source_value,
                target=target_value,
                changed=section_changed,
            )
        )

    return BucketConfigDiff(changed=changed, sections=sections)


def _normalize_tags(tags: list[BucketTag]) -> list[dict[str, str]]:
    return sorted(
        [{"key": (tag.key or "").strip(), "value": tag.value or ""} for tag in tags if (tag.key or "").strip()],
        key=lambda item: (item["key"], item["value"]),
    )


def _stable_value(value: Any) -> str:
    try:
        return json.dumps(value, ensure_ascii=True, sort_keys=True, default=str)
    except TypeError:
        return str(value)
