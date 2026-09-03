# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from datetime import datetime
from typing import Any, Optional, Literal, Union

from pydantic import Field, model_validator

from app.models.base import ApiModel
from app.models.bucket_compare import (
    BucketCompareRequestBase,
    BucketConfigDiff,
    BucketContentDiff,
)
from app.models.bucket_listing import BucketListingSummary
from app.models.pagination import PaginatedResponse
from app.models.tagging import TagDefinitionSummary

class CephAdminEndpoint(ApiModel):
    id: int
    name: str
    endpoint_url: str
    admin_endpoint: Optional[str] = None
    region: Optional[str] = None
    is_default: bool = False
    capabilities: dict[str, bool] = Field(default_factory=dict)
    tags: list[TagDefinitionSummary] = Field(default_factory=list)


class CephAdminEndpointAccess(ApiModel):
    endpoint_id: int
    can_admin: bool = False
    can_accounts: bool = False
    can_metrics: bool = False
    admin_warning: Optional[str] = None
    accounts_warning: Optional[str] = None
    active_rgw_uid: Optional[str] = None
    active_rgw_tenant: Optional[str] = None
    availability_status: Literal["unknown", "available", "unavailable", "denied", "misconfigured"] = "unknown"
    availability_checked_at: Optional[str] = None


class CephAdminAdminOpsResult(ApiModel):
    operation: str
    success: bool
    rgw_status_code: Optional[int] = None
    rgw_error_code: Optional[str] = None
    message: str
    result: Any = None


class CephAdminAdminOpsConfirmation(ApiModel):
    confirmation: str = Field(min_length=1, max_length=512)


class CephAdminUserDeleteRequest(CephAdminAdminOpsConfirmation):
    purge_data: bool = False


class CephAdminBucketDeleteRequest(CephAdminAdminOpsConfirmation):
    purge_objects: bool = False
    bypass_gc: bool = False

    @model_validator(mode="after")
    def validate_bypass_gc(self):
        if self.bypass_gc and not self.purge_objects:
            raise ValueError("bypass_gc requires purge_objects.")
        return self


class CephAdminBucketLinkRequest(CephAdminAdminOpsConfirmation):
    target_type: Literal["user", "account"]
    target_id: str = Field(min_length=1, max_length=255)


class CephAdminBucketIndexCheckRequest(ApiModel):
    fix: bool = False
    check_objects: bool = False
    confirmation: Optional[str] = Field(default=None, max_length=512)

    @model_validator(mode="after")
    def validate_check_objects(self):
        if self.check_objects and not self.fix:
            raise ValueError("check_objects requires fix.")
        if self.fix and not (self.confirmation or "").strip():
            raise ValueError("confirmation is required when fix is enabled.")
        return self


class CephAdminBucketIndexCheckTarget(ApiModel):
    name: str = Field(min_length=1, max_length=255)
    tenant: Optional[str] = Field(default=None, max_length=255)

    @model_validator(mode="after")
    def normalize_target(self):
        self.name = self.name.strip()
        self.tenant = (self.tenant or "").strip() or None
        if not self.name:
            raise ValueError("name is required.")
        return self


class CephAdminBucketIndexCheckBatchRequest(ApiModel):
    targets: list[CephAdminBucketIndexCheckTarget] = Field(min_length=1, max_length=200)
    parallelism: int = Field(default=4, ge=1, le=16)

    @model_validator(mode="after")
    def deduplicate_targets(self):
        deduped: list[CephAdminBucketIndexCheckTarget] = []
        seen: set[tuple[Optional[str], str]] = set()
        for target in self.targets:
            key = (target.tenant, target.name)
            if key in seen:
                continue
            seen.add(key)
            deduped.append(target)
        self.targets = deduped
        return self


CephAdminBucketIndexCheckBatchStatus = Literal["completed", "completed_with_errors", "failed", "canceled"]


class CephAdminBucketIndexCheckBatchBucketResult(ApiModel):
    name: str
    tenant: Optional[str] = None
    status: Literal["completed", "failed"]
    duration_seconds: float = 0
    operation: str = "check_bucket_index"
    rgw_status_code: Optional[int] = None
    rgw_error_code: Optional[str] = None
    message: str
    result: Any = None


class CephAdminBucketIndexCheckBatchProgress(ApiModel):
    request_id: Optional[str] = None
    stage: Literal["prepare", "completed"] = "prepare"
    bucket_name: Optional[str] = None
    tenant: Optional[str] = None
    total_buckets: int = 0
    completed_buckets: int = 0
    failed_buckets: int = 0
    message: Optional[str] = None


class CephAdminBucketIndexCheckBatchResult(ApiModel):
    status: CephAdminBucketIndexCheckBatchStatus
    total_buckets: int = 0
    completed_buckets: int = 0
    failed_buckets: int = 0
    started_at: datetime
    finished_at: datetime
    buckets: list[CephAdminBucketIndexCheckBatchBucketResult] = Field(default_factory=list)


class CephAdminRgwAccountSummary(ApiModel):
    account_id: str
    account_name: Optional[str] = None
    email: Optional[str] = None
    max_users: Optional[int] = None
    max_buckets: Optional[int] = None
    quota_max_size_bytes: Optional[int] = None
    quota_max_objects: Optional[int] = None
    used_bytes: Optional[int] = None
    object_count: Optional[int] = None
    bucket_count: Optional[int] = None
    user_count: Optional[int] = None


class CephAdminRgwUserSummary(ApiModel):
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
    used_bytes: Optional[int] = None
    object_count: Optional[int] = None


class PaginatedCephAdminBucketsResponse(PaginatedResponse):
    items: list[BucketListingSummary]
    stats_available: bool = True
    stats_warning: Optional[str] = None


class PaginatedCephAdminAccountsResponse(PaginatedResponse):
    items: list[CephAdminRgwAccountSummary]


class PaginatedCephAdminUsersResponse(PaginatedResponse):
    items: list[CephAdminRgwUserSummary]


class CephAdminRgwQuotaConfig(ApiModel):
    enabled: Optional[bool] = None
    max_size_bytes: Optional[int] = None
    max_objects: Optional[int] = None


class CephAdminRgwAccessKey(ApiModel):
    access_key: str
    secret_key: Optional[str] = None
    status: Optional[str] = None
    is_active: Optional[bool] = None
    created_at: Optional[datetime] = None
    user: Optional[str] = None
    subuser: Optional[str] = None
    is_private_access_managed: bool = False
    managed_connection_id: Optional[int] = None


class CephAdminRgwGeneratedAccessKey(ApiModel):
    access_key: str
    secret_key: str


class CephAdminRgwAccessKeyStatusChange(ApiModel):
    active: bool


class CephAdminRgwAccountDetail(ApiModel):
    account_id: str
    account_name: Optional[str] = None
    email: Optional[str] = None
    max_users: Optional[int] = None
    max_buckets: Optional[int] = None
    max_roles: Optional[int] = None
    max_groups: Optional[int] = None
    max_access_keys: Optional[int] = None
    bucket_count: Optional[int] = None
    user_count: Optional[int] = None
    quota: Optional[CephAdminRgwQuotaConfig] = None
    bucket_quota: Optional[CephAdminRgwQuotaConfig] = None


class CephAdminRgwUserDetail(ApiModel):
    uid: str
    tenant: Optional[str] = None
    display_name: Optional[str] = None
    email: Optional[str] = None
    account_id: Optional[str] = None
    account_name: Optional[str] = None
    suspended: Optional[bool] = None
    admin: Optional[bool] = None
    system: Optional[bool] = None
    account_root: Optional[bool] = None
    max_buckets: Optional[int] = None
    op_mask: Optional[str] = None
    default_placement: Optional[str] = None
    default_storage_class: Optional[str] = None
    caps: list[str] = Field(default_factory=list)
    quota: Optional[CephAdminRgwQuotaConfig] = None
    keys: list[CephAdminRgwAccessKey] = Field(default_factory=list)


class CephAdminRgwUserCapsUpdate(ApiModel):
    mode: Literal["replace", "add", "remove"] = "replace"
    values: list[str] = Field(default_factory=list)


class CephAdminRgwAccountCreate(ApiModel):
    account_id: Optional[str] = None
    account_name: str
    email: Optional[str] = None
    max_users: Optional[int] = Field(default=None, ge=0)
    max_buckets: Optional[int] = Field(default=None, ge=0)
    max_roles: Optional[int] = Field(default=None, ge=0)
    max_groups: Optional[int] = Field(default=None, ge=0)
    max_access_keys: Optional[int] = Field(default=None, ge=0)
    quota_enabled: Optional[bool] = None
    quota_max_size_bytes: Optional[int] = Field(default=None, ge=0)
    quota_max_objects: Optional[int] = Field(default=None, ge=0)
    bucket_quota_enabled: Optional[bool] = None
    bucket_quota_max_size_bytes: Optional[int] = Field(default=None, ge=0)
    bucket_quota_max_objects: Optional[int] = Field(default=None, ge=0)
    extra_params: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def validate_name(self):
        if not isinstance(self.account_name, str) or not self.account_name.strip():
            raise ValueError("account_name is required.")
        if isinstance(self.account_id, str) and not self.account_id.strip():
            self.account_id = None
        return self


class CephAdminRgwAccountCreateResponse(ApiModel):
    account: CephAdminRgwAccountDetail


class CephAdminRgwUserCreate(ApiModel):
    uid: str
    tenant: Optional[str] = None
    account_id: Optional[str] = None
    display_name: Optional[str] = None
    email: Optional[str] = None
    suspended: Optional[bool] = None
    max_buckets: Optional[int] = Field(default=None, ge=0)
    op_mask: Optional[str] = None
    admin: Optional[bool] = None
    system: Optional[bool] = None
    account_root: Optional[bool] = None
    generate_key: bool = True
    quota_enabled: Optional[bool] = None
    quota_max_size_bytes: Optional[int] = Field(default=None, ge=0)
    quota_max_objects: Optional[int] = Field(default=None, ge=0)
    caps: Optional[CephAdminRgwUserCapsUpdate] = None
    extra_params: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def validate_scope(self):
        if self.account_id and self.tenant:
            raise ValueError("tenant cannot be combined with account_id.")
        return self


class CephAdminRgwUserCreateResponse(ApiModel):
    detail: CephAdminRgwUserDetail
    generated_key: Optional[CephAdminRgwGeneratedAccessKey] = None


class CephAdminRgwAccountConfigUpdate(ApiModel):
    account_name: Optional[str] = None
    email: Optional[str] = None
    max_users: Optional[int] = Field(default=None, ge=0)
    max_buckets: Optional[int] = Field(default=None, ge=0)
    max_roles: Optional[int] = Field(default=None, ge=0)
    max_groups: Optional[int] = Field(default=None, ge=0)
    max_access_keys: Optional[int] = Field(default=None, ge=0)
    quota_enabled: Optional[bool] = None
    quota_max_size_bytes: Optional[int] = Field(default=None, ge=0)
    quota_max_objects: Optional[int] = Field(default=None, ge=0)
    bucket_quota_enabled: Optional[bool] = None
    bucket_quota_max_size_bytes: Optional[int] = Field(default=None, ge=0)
    bucket_quota_max_objects: Optional[int] = Field(default=None, ge=0)
    extra_params: dict[str, Any] = Field(default_factory=dict)


class CephAdminRgwUserConfigUpdate(ApiModel):
    display_name: Optional[str] = None
    email: Optional[str] = None
    suspended: Optional[bool] = None
    max_buckets: Optional[int] = Field(default=None, ge=0)
    op_mask: Optional[str] = None
    admin: Optional[bool] = None
    system: Optional[bool] = None
    account_root: Optional[bool] = None
    quota_enabled: Optional[bool] = None
    quota_max_size_bytes: Optional[int] = Field(default=None, ge=0)
    quota_max_objects: Optional[int] = Field(default=None, ge=0)
    caps: Optional[CephAdminRgwUserCapsUpdate] = None
    extra_params: dict[str, Any] = Field(default_factory=dict)


class CephAdminBucketUsagePoint(ApiModel):
    name: str
    used_bytes: Optional[int] = None
    object_count: Optional[int] = None


class CephAdminEntityMetrics(ApiModel):
    total_bytes: Optional[int] = None
    total_objects: Optional[int] = None
    bucket_count: int = 0
    bucket_usage: list[CephAdminBucketUsagePoint] = Field(default_factory=list)
    generated_at: datetime



class CephAdminBucketCompareRequest(BucketCompareRequestBase):
    target_endpoint_id: int = Field(..., ge=1)


class CephAdminBucketCompareResult(ApiModel):
    source_endpoint_id: int
    target_endpoint_id: int
    source_bucket: str
    target_bucket: str
    has_differences: bool = False
    content_diff: Optional[BucketContentDiff] = None
    config_diff: Optional[BucketConfigDiff] = None


UserFilterField = Literal[
    "uid",
    "tenant",
    "account_id",
    "account_name",
    "full_name",
    "email",
    "suspended",
    "max_buckets",
    "quota_max_size_bytes",
    "quota_max_objects",
    "quota_usage_size_percent",
    "quota_usage_object_percent",
]
UserFilterOp = Literal[
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


class CephAdminUserFilterRule(ApiModel):
    field: UserFilterField
    op: UserFilterOp
    value: Optional[Union[str, int, float, bool, list[str], list[int], list[float], list[bool]]] = None

    @model_validator(mode="after")
    def validate_rule(self):
        if self.op not in ("is_null", "not_null") and self.value is None:
            raise ValueError("User filter rule requires value.")
        return self


class CephAdminUserFilterQuery(ApiModel):
    match: Literal["all", "any"] = "all"
    rules: list[CephAdminUserFilterRule] = Field(default_factory=list)


AccountFilterField = Literal[
    "account_id",
    "account_name",
    "email",
    "max_users",
    "max_buckets",
    "quota_max_size_bytes",
    "quota_max_objects",
    "quota_usage_size_percent",
    "quota_usage_object_percent",
    "bucket_count",
    "user_count",
]
AccountFilterOp = Literal[
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


class CephAdminAccountFilterRule(ApiModel):
    field: AccountFilterField
    op: AccountFilterOp
    value: Optional[Union[str, int, float, bool, list[str], list[int], list[float], list[bool]]] = None

    @model_validator(mode="after")
    def validate_rule(self):
        if self.op not in ("is_null", "not_null") and self.value is None:
            raise ValueError("Account filter rule requires value.")
        return self


class CephAdminAccountFilterQuery(ApiModel):
    match: Literal["all", "any"] = "all"
    rules: list[CephAdminAccountFilterRule] = Field(default_factory=list)
