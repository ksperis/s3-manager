# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from datetime import datetime
from typing import Optional, Literal, Union

from pydantic import BaseModel, Field, model_validator

from app.models.bucket import BucketFeatureStatus, BucketTag
from app.models.pagination import PaginatedResponse

class CephAdminEndpoint(BaseModel):
    id: int
    name: str
    endpoint_url: str
    admin_endpoint: Optional[str] = None
    region: Optional[str] = None
    is_default: bool = False
    capabilities: dict[str, bool] = Field(default_factory=dict)


class CephAdminRgwAccountSummary(BaseModel):
    account_id: str
    account_name: Optional[str] = None


class CephAdminRgwUserSummary(BaseModel):
    uid: str
    tenant: Optional[str] = None
    account_id: Optional[str] = None
    account_name: Optional[str] = None
    full_name: Optional[str] = None
    email: Optional[str] = None
    suspended: Optional[bool] = None
    max_buckets: Optional[int] = None
    quota_max_size_bytes: Optional[int] = None
    quota_max_objects: Optional[int] = None


class CephAdminAssumeUserResponse(BaseModel):
    context_id: str
    expires_at: datetime


class CephAdminBucketSummary(BaseModel):
    name: str
    tenant: Optional[str] = None
    owner: Optional[str] = None
    owner_name: Optional[str] = None
    used_bytes: Optional[int] = None
    object_count: Optional[int] = None
    quota_max_size_bytes: Optional[int] = None
    quota_max_objects: Optional[int] = None
    tags: Optional[list[BucketTag]] = None
    features: Optional[dict[str, BucketFeatureStatus]] = None


class PaginatedCephAdminBucketsResponse(PaginatedResponse):
    items: list[CephAdminBucketSummary]


class PaginatedCephAdminAccountsResponse(PaginatedResponse):
    items: list[CephAdminRgwAccountSummary]


class PaginatedCephAdminUsersResponse(PaginatedResponse):
    items: list[CephAdminRgwUserSummary]


BucketFilterField = Literal[
    "name",
    "tenant",
    "owner",
    "used_bytes",
    "object_count",
    "quota_max_size_bytes",
    "quota_max_objects",
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


class CephAdminBucketFilterRule(BaseModel):
    field: Optional[BucketFilterField] = None
    op: Optional[BucketFilterOp] = None
    value: Optional[Union[str, int, float, bool, list[str], list[int], list[float]]] = None
    feature: Optional[BucketFeatureKey] = None
    state: Optional[BucketFeatureState] = None

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
            if op not in ("is_null", "not_null") and self.value is None:
                raise ValueError("Field rule requires value.")
        if feature:
            state = self.state
            if state is None:
                raise ValueError("Feature rule requires state.")
        return self


class CephAdminBucketFilterQuery(BaseModel):
    match: Literal["all", "any"] = "all"
    rules: list[CephAdminBucketFilterRule] = Field(default_factory=list)
