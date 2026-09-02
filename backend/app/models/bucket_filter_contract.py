# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Validation matrix for shared bucket feature parameter filters."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class _BucketFeatureParamContract:
    feature: str
    operations: frozenset[str]
    requires_value: bool = True


_EQUALITY_OPERATIONS = frozenset({"eq", "neq"})
_TEXT_OPERATIONS = frozenset({"eq", "neq", "contains", "starts_with", "ends_with"})
_NUMBER_OPERATIONS = frozenset({"eq", "neq", "gt", "gte", "lt", "lte"})
_PRESENCE_OPERATIONS = frozenset({"has", "has_not"})
_PRESENCE_OR_EQUALITY_OPERATIONS = frozenset({"has", "has_not", "eq", "neq"})


def _contract(
    feature: str,
    operations: frozenset[str],
    *,
    requires_value: bool = True,
) -> _BucketFeatureParamContract:
    return _BucketFeatureParamContract(
        feature=feature,
        operations=operations,
        requires_value=requires_value,
    )


_FEATURE_PARAM_CONTRACTS = {
    "lifecycle_rule_id": _contract("lifecycle_rules", _TEXT_OPERATIONS),
    "lifecycle_rule_status": _contract("lifecycle_rules", _EQUALITY_OPERATIONS),
    "lifecycle_rule_type": _contract("lifecycle_rules", _PRESENCE_OPERATIONS),
    "lifecycle_expiration_days": _contract("lifecycle_rules", _NUMBER_OPERATIONS),
    "lifecycle_noncurrent_expiration_days": _contract(
        "lifecycle_rules",
        _NUMBER_OPERATIONS,
    ),
    "lifecycle_transition_days": _contract("lifecycle_rules", _NUMBER_OPERATIONS),
    "lifecycle_abort_multipart_present": _contract(
        "lifecycle_rules",
        _PRESENCE_OPERATIONS,
        requires_value=False,
    ),
    "lifecycle_abort_multipart_days": _contract(
        "lifecycle_rules",
        _NUMBER_OPERATIONS,
    ),
    "object_lock_mode": _contract("object_lock", _TEXT_OPERATIONS),
    "object_lock_retention_days": _contract("object_lock", _NUMBER_OPERATIONS),
    "object_lock_retention_years": _contract("object_lock", _NUMBER_OPERATIONS),
    "bpa_block_public_acls": _contract("block_public_access", _EQUALITY_OPERATIONS),
    "bpa_ignore_public_acls": _contract("block_public_access", _EQUALITY_OPERATIONS),
    "bpa_block_public_policy": _contract("block_public_access", _EQUALITY_OPERATIONS),
    "bpa_restrict_public_buckets": _contract(
        "block_public_access",
        _EQUALITY_OPERATIONS,
    ),
    "cors_allowed_method": _contract("cors", _PRESENCE_OR_EQUALITY_OPERATIONS),
    "cors_allowed_origin": _contract("cors", _PRESENCE_OR_EQUALITY_OPERATIONS),
    "logging_enabled": _contract("access_logging", _EQUALITY_OPERATIONS),
    "logging_target_bucket": _contract("access_logging", _TEXT_OPERATIONS),
    "logging_target_prefix": _contract("access_logging", _TEXT_OPERATIONS),
    "website_index_present": _contract("static_website", _EQUALITY_OPERATIONS),
    "website_index_document": _contract("static_website", _TEXT_OPERATIONS),
    "website_error_document": _contract("static_website", _TEXT_OPERATIONS),
    "website_redirect_host_present": _contract(
        "static_website",
        _EQUALITY_OPERATIONS,
    ),
    "website_redirect_host": _contract("static_website", _TEXT_OPERATIONS),
    "website_routing_rule_count": _contract("static_website", _NUMBER_OPERATIONS),
    "policy_statement_count": _contract("bucket_policy", _NUMBER_OPERATIONS),
    "policy_has_conditions": _contract("bucket_policy", _EQUALITY_OPERATIONS),
    "notification_rule_id": _contract("notifications", _TEXT_OPERATIONS),
    "notification_rule_type": _contract("notifications", _PRESENCE_OPERATIONS),
    "notification_topic_name": _contract("notifications", _TEXT_OPERATIONS),
    "notification_event": _contract("notifications", _PRESENCE_OPERATIONS),
    "notification_filter_prefix": _contract("notifications", _PRESENCE_OPERATIONS),
    "notification_filter_suffix": _contract("notifications", _PRESENCE_OPERATIONS),
    "notification_eventbridge_present": _contract(
        "notifications",
        _EQUALITY_OPERATIONS,
    ),
    "sse_algorithm": _contract("server_side_encryption", _TEXT_OPERATIONS),
    "sse_kms_key_id": _contract("server_side_encryption", _TEXT_OPERATIONS),
}


def validate_bucket_feature_param(
    *,
    feature: str,
    param: str,
    operation: str,
    value: object,
) -> None:
    contract = _FEATURE_PARAM_CONTRACTS[param]
    if feature != contract.feature:
        raise ValueError(f"Feature param '{param}' is invalid for feature '{feature}'.")
    if operation not in contract.operations:
        raise ValueError(f"Feature param '{param}' does not support op '{operation}'.")
    if contract.requires_value and value is None:
        raise ValueError("Feature param rule requires value.")
    if not contract.requires_value and value is not None:
        raise ValueError("Feature param rule does not accept value.")
