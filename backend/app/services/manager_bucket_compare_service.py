# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from app.models.manager_bucket_compare import (
    ManagerBucketCompareActionRequest,
    ManagerBucketCompareActionResult,
    ManagerBucketCompareRequest,
    ManagerBucketCompareResult,
)
from app.services.buckets_service import BucketsService
from app.services.s3_execution_context import S3ExecutionContext


class InvalidManagerBucketComparisonError(ValueError):
    pass


@dataclass(frozen=True, slots=True)
class ManagerBucketCompareActionOutcome:
    result: ManagerBucketCompareActionResult
    audit_metadata: dict[str, Any]


def _validate_distinct_buckets(
    *,
    source_account: S3ExecutionContext,
    target_account: S3ExecutionContext,
    source_bucket: str,
    target_bucket: str,
) -> None:
    if source_account.context_id == target_account.context_id and source_bucket == target_bucket:
        raise InvalidManagerBucketComparisonError(
            "When source and target contexts are the same, source_bucket and target_bucket must differ."
        )


def compare_manager_buckets(
    *,
    service: BucketsService,
    payload: ManagerBucketCompareRequest,
    source_account: S3ExecutionContext,
    target_account: S3ExecutionContext,
) -> ManagerBucketCompareResult:
    _validate_distinct_buckets(
        source_account=source_account,
        target_account=target_account,
        source_bucket=payload.source_bucket,
        target_bucket=payload.target_bucket,
    )

    content_diff = None
    config_diff = None
    if payload.include_content:
        content_diff = service.compare_bucket_content(
            payload.source_bucket,
            source_account,
            payload.target_bucket,
            target_account,
            ignore_modified_after=payload.ignore_modified_after,
        )
    if payload.include_config:
        config_diff = service.compare_bucket_configuration(
            payload.source_bucket,
            source_account,
            payload.target_bucket,
            target_account,
            include_sections=set(payload.config_features) if payload.config_features is not None else None,
        )

    has_content_differences = bool(
        content_diff
        and (
            content_diff.different_count > 0
            or content_diff.only_source_count > 0
            or content_diff.only_target_count > 0
        )
    )
    return ManagerBucketCompareResult(
        source_context_id=source_account.context_id,
        target_context_id=target_account.context_id,
        source_bucket=payload.source_bucket,
        target_bucket=payload.target_bucket,
        has_differences=has_content_differences or bool(config_diff and config_diff.changed),
        content_diff=content_diff,
        config_diff=config_diff,
    )


def _remediation_message(
    *,
    action: str,
    planned_count: int,
    succeeded_count: int,
    failed_count: int,
) -> str:
    if planned_count == 0:
        return "No object matched this remediation action."
    if failed_count <= 0:
        return (
            f"Action '{action}' completed successfully: "
            f"{succeeded_count}/{planned_count} object(s) processed."
        )
    if succeeded_count <= 0:
        return f"Action '{action}' failed for all {planned_count} object(s)."
    return (
        f"Action '{action}' partially succeeded: {succeeded_count}/{planned_count} object(s) processed, "
        f"{failed_count} failed."
    )


def remediate_manager_bucket_comparison(
    *,
    service: BucketsService,
    payload: ManagerBucketCompareActionRequest,
    source_account: S3ExecutionContext,
    target_account: S3ExecutionContext,
) -> ManagerBucketCompareActionOutcome:
    _validate_distinct_buckets(
        source_account=source_account,
        target_account=target_account,
        source_bucket=payload.source_bucket,
        target_bucket=payload.target_bucket,
    )
    action_result = service.run_compare_content_remediation(
        payload.source_bucket,
        source_account,
        payload.target_bucket,
        target_account,
        action=payload.action,
        object_keys=payload.object_keys,
        parallelism=payload.parallelism,
    )

    result = ManagerBucketCompareActionResult(
        action=action_result.action,
        source_context_id=source_account.context_id,
        target_context_id=target_account.context_id,
        source_bucket=payload.source_bucket,
        target_bucket=payload.target_bucket,
        planned_count=action_result.planned_count,
        succeeded_count=action_result.succeeded_count,
        failed_count=action_result.failed_count,
        failed_keys_sample=action_result.failed_keys_sample,
        message=_remediation_message(
            action=payload.action,
            planned_count=action_result.planned_count,
            succeeded_count=action_result.succeeded_count,
            failed_count=action_result.failed_count,
        ),
    )
    return ManagerBucketCompareActionOutcome(
        result=result,
        audit_metadata={
            "compare_action": payload.action,
            "source_context_id": source_account.context_id,
            "target_context_id": target_account.context_id,
            "source_bucket": payload.source_bucket,
            "target_bucket": payload.target_bucket,
            "object_keys_count": len(payload.object_keys),
            "object_keys_sample": payload.object_keys[:50],
            "planned_count": action_result.planned_count,
            "succeeded_count": action_result.succeeded_count,
            "failed_count": action_result.failed_count,
            "failed_keys_sample": action_result.failed_keys_sample,
        },
    )
