# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

import pytest
from pydantic import ValidationError

from app.models.bucket_integrity import BucketIntegrityCheckRequest, BucketIntegrityTarget
from app.models.bucket_purge import BucketPurgeRequest, BucketPurgeTarget
from app.models.bucket_usage_stats import BucketUsageStatsRequest, BucketUsageStatsTarget


@pytest.mark.parametrize(
    "target_type",
    [BucketIntegrityTarget, BucketPurgeTarget, BucketUsageStatsTarget],
)
def test_bucket_operation_targets_share_normalization(target_type):
    target = target_type(context_id=" account-1 ", bucket_name=" bucket-1 ")

    assert target.context_id == "account-1"
    assert target.bucket_name == "bucket-1"


@pytest.mark.parametrize(
    "target_type, payload",
    [
        (BucketIntegrityTarget, {"context_id": " ", "bucket_name": "bucket-1"}),
        (BucketPurgeTarget, {"context_id": "account-1", "bucket_name": " "}),
        (BucketUsageStatsTarget, {"context_id": "", "bucket_name": "bucket-1"}),
    ],
)
def test_bucket_operation_targets_share_required_fields(target_type, payload):
    with pytest.raises(ValidationError):
        target_type.model_validate(payload)


@pytest.mark.parametrize(
    "request_type, target_type",
    [
        (BucketIntegrityCheckRequest, BucketIntegrityTarget),
        (BucketPurgeRequest, BucketPurgeTarget),
        (BucketUsageStatsRequest, BucketUsageStatsTarget),
    ],
)
def test_bucket_operation_requests_share_deduplication(request_type, target_type):
    target = target_type(context_id="account-1", bucket_name="bucket-1")
    request = request_type(targets=[target, target.model_copy()])

    assert request.targets == [target]


@pytest.mark.parametrize(
    ("request_type", "target_type"),
    [
        (BucketIntegrityCheckRequest, BucketIntegrityTarget),
        (BucketUsageStatsRequest, BucketUsageStatsTarget),
    ],
)
def test_exclusive_bucket_operation_requests_require_one_target_source(request_type, target_type):
    with pytest.raises(ValidationError, match="Provide exactly one of buckets or targets"):
        request_type()

    with pytest.raises(ValidationError, match="Provide exactly one of buckets or targets"):
        request_type(
            buckets=["bucket-1"],
            targets=[target_type(context_id="account-1", bucket_name="bucket-1")],
        )
