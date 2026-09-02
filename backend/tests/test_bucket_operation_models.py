# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

import pytest
from pydantic import ValidationError

from app.main import app
from app.models.bucket_integrity import BucketIntegrityCheckRequest
from app.models.bucket_operation import BucketOperationTarget
from app.models.bucket_purge import BucketPurgeRequest
from app.models.bucket_usage_stats import BucketUsageStatsRequest


def test_bucket_operation_target_normalization():
    target = BucketOperationTarget(context_id=" account-1 ", bucket_name=" bucket-1 ")

    assert target.context_id == "account-1"
    assert target.bucket_name == "bucket-1"


@pytest.mark.parametrize(
    "payload",
    [
        {"context_id": " ", "bucket_name": "bucket-1"},
        {"context_id": "account-1", "bucket_name": " "},
        {"context_id": "", "bucket_name": "bucket-1"},
    ],
)
def test_bucket_operation_target_requires_both_fields(payload):
    with pytest.raises(ValidationError):
        BucketOperationTarget.model_validate(payload)


@pytest.mark.parametrize(
    "request_type",
    [
        BucketIntegrityCheckRequest,
        BucketPurgeRequest,
        BucketUsageStatsRequest,
    ],
)
def test_bucket_operation_requests_share_deduplication(request_type):
    target = BucketOperationTarget(context_id="account-1", bucket_name="bucket-1")
    request = request_type(targets=[target, target.model_copy()])

    assert request.targets == [target]


@pytest.mark.parametrize(
    "request_type",
    [
        BucketIntegrityCheckRequest,
        BucketUsageStatsRequest,
    ],
)
def test_exclusive_bucket_operation_requests_require_one_target_source(request_type):
    with pytest.raises(ValidationError, match="Provide exactly one of buckets or targets"):
        request_type()

    with pytest.raises(ValidationError, match="Provide exactly one of buckets or targets"):
        request_type(
            buckets=["bucket-1"],
            targets=[BucketOperationTarget(context_id="account-1", bucket_name="bucket-1")],
        )


def test_bucket_operation_requests_share_one_openapi_target_component():
    schemas = app.openapi()["components"]["schemas"]

    for request_name in ("BucketIntegrityCheckRequest", "BucketPurgeRequest", "BucketUsageStatsRequest"):
        assert schemas[request_name]["properties"]["targets"]["items"] == {
            "$ref": "#/components/schemas/BucketOperationTarget"
        }

    assert "BucketIntegrityTarget" not in schemas
    assert "BucketPurgeTarget" not in schemas
    assert "BucketUsageStatsTarget" not in schemas
