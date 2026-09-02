# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import pytest
from pydantic import ValidationError

from app.models.bucket_filter import BucketFilterRule


def test_feature_param_rule_defaults_to_any_quantifier():
    rule = BucketFilterRule.model_validate(
        {
            "feature": "lifecycle_rules",
            "param": "lifecycle_abort_multipart_present",
            "op": "has",
        }
    )

    assert rule.quantifier == "any"


def test_feature_param_rule_preserves_none_quantifier():
    rule = BucketFilterRule.model_validate(
        {
            "feature": "notifications",
            "param": "notification_event",
            "op": "has_not",
            "value": "s3:ObjectCreated:*",
            "quantifier": "none",
        }
    )

    assert rule.quantifier == "none"


@pytest.mark.parametrize(
    ("payload", "message"),
    [
        (
            {
                "feature": "cors",
                "param": "notification_event",
                "op": "has",
                "value": "s3:ObjectCreated:*",
            },
            "Feature param 'notification_event' is invalid for feature 'cors'.",
        ),
        (
            {
                "feature": "bucket_policy",
                "param": "policy_statement_count",
                "op": "contains",
                "value": 2,
            },
            "Feature param 'policy_statement_count' does not support op 'contains'.",
        ),
        (
            {
                "feature": "server_side_encryption",
                "param": "sse_algorithm",
                "op": "eq",
            },
            "Feature param rule requires value.",
        ),
        (
            {
                "feature": "lifecycle_rules",
                "param": "lifecycle_abort_multipart_present",
                "op": "has",
                "value": True,
            },
            "Feature param rule does not accept value.",
        ),
    ],
)
def test_feature_param_rule_rejects_contract_violations(payload, message):
    with pytest.raises(ValidationError, match=message.replace(".", r"\.")):
        BucketFilterRule.model_validate(payload)
