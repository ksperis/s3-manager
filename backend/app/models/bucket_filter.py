# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Literal, Optional

from pydantic import Field, model_validator

from app.models.base import ApiModel
from app.models.bucket_filter_contract import validate_bucket_feature_param


BucketFilterField = Literal[
    "name",
    "tenant",
    "owner",
    "owner_name",
    "owner_suspended",
    "owner_kind",
    "context_id",
    "context_name",
    "context_kind",
    "endpoint_name",
    "bucket_identity",
    "tag",
    "used_bytes",
    "object_count",
    "quota_max_size_bytes",
    "quota_max_objects",
    "quota_usage_size_percent",
    "quota_usage_object_percent",
    "owner_used_bytes",
    "owner_object_count",
    "owner_quota_max_size_bytes",
    "owner_quota_max_objects",
    "owner_quota_usage_size_percent",
    "owner_quota_usage_object_percent",
]
BucketFilterOp = Literal[
    "eq",
    "neq",
    "contains",
    "starts_with",
    "ends_with",
    "gt",
    "gte",
    "lt",
    "lte",
    "in",
    "not_in",
    "is_null",
    "not_null",
    "has",
    "has_not",
]
BucketFeatureKey = Literal[
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
]
BucketFeatureState = Literal[
    "enabled",
    "disabled",
    "disabled_or_suspended",
    "unknown",
    "partial",
    "suspended",
    "configured",
    "not_set",
    "unavailable",
]
BucketFeatureParam = Literal[
    "lifecycle_rule_id",
    "lifecycle_rule_status",
    "lifecycle_rule_type",
    "lifecycle_expiration_days",
    "lifecycle_noncurrent_expiration_days",
    "lifecycle_transition_days",
    "lifecycle_abort_multipart_present",
    "lifecycle_abort_multipart_days",
    "object_lock_mode",
    "object_lock_retention_days",
    "object_lock_retention_years",
    "bpa_block_public_acls",
    "bpa_ignore_public_acls",
    "bpa_block_public_policy",
    "bpa_restrict_public_buckets",
    "cors_allowed_method",
    "cors_allowed_origin",
    "logging_enabled",
    "logging_target_bucket",
    "logging_target_prefix",
    "website_index_present",
    "website_index_document",
    "website_error_document",
    "website_redirect_host_present",
    "website_redirect_host",
    "website_routing_rule_count",
    "policy_statement_count",
    "policy_has_conditions",
    "notification_rule_id",
    "notification_rule_type",
    "notification_topic_name",
    "notification_event",
    "notification_filter_prefix",
    "notification_filter_suffix",
    "notification_eventbridge_present",
    "sse_algorithm",
    "sse_kms_key_id",
]
BucketFeatureParamQuantifier = Literal["any", "none"]
BucketFilterValue = (
    str
    | int
    | float
    | bool
    | list[str]
    | list[int]
    | list[float]
    | list[bool]
)


class BucketFilterRule(ApiModel):
    field: Optional[BucketFilterField] = None
    op: Optional[BucketFilterOp] = None
    value: Optional[BucketFilterValue] = None
    feature: Optional[BucketFeatureKey] = None
    state: Optional[BucketFeatureState] = None
    param: Optional[BucketFeatureParam] = None
    quantifier: Optional[BucketFeatureParamQuantifier] = None

    @model_validator(mode="after")
    def validate_rule(self):
        field = self.field
        feature = self.feature
        if bool(field) == bool(feature):
            raise ValueError("Rule must define exactly one of field or feature.")
        if field:
            op = self.op
            if op is None:
                raise ValueError("Field rule requires op.")
            if op in {"has", "has_not"}:
                raise ValueError("Field rule does not support has/has_not op.")
            if op not in ("is_null", "not_null") and self.value is None:
                raise ValueError("Field rule requires value.")
            if self.state is not None or self.param is not None:
                raise ValueError("Field rule cannot define state or param.")
            if self.quantifier not in (None, "any"):
                raise ValueError("Field rule quantifier must be omitted or 'any'.")
        if feature:
            has_state = self.state is not None
            has_param = self.param is not None
            if has_state == has_param:
                raise ValueError("Feature rule requires exactly one of state or param.")
            if has_state:
                if self.op is not None or self.value is not None:
                    raise ValueError("Feature state rule cannot define op or value.")
                if self.quantifier not in (None, "any"):
                    raise ValueError(
                        "Feature state rule quantifier must be omitted or 'any'."
                    )
            else:
                op = self.op
                if op is None:
                    raise ValueError("Feature param rule requires op.")
                assert self.param is not None
                validate_bucket_feature_param(
                    feature=feature,
                    param=self.param,
                    operation=op,
                    value=self.value,
                )
                self.quantifier = self.quantifier or "any"
        return self


class BucketFilterQuery(ApiModel):
    match: Literal["all", "any"] = "all"
    rules: list[BucketFilterRule] = Field(default_factory=list)
