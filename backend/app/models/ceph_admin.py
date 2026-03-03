# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from datetime import datetime
from typing import Any, Optional, Literal, Union

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


class CephAdminEndpointAccess(BaseModel):
    endpoint_id: int
    can_admin: bool = False
    can_accounts: bool = False
    can_metrics: bool = False
    admin_warning: Optional[str] = None


class CephAdminRgwAccountSummary(BaseModel):
    account_id: str
    account_name: Optional[str] = None
    email: Optional[str] = None
    max_users: Optional[int] = None
    max_buckets: Optional[int] = None
    quota_max_size_bytes: Optional[int] = None
    quota_max_objects: Optional[int] = None
    bucket_count: Optional[int] = None
    user_count: Optional[int] = None


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


class CephAdminRgwQuotaConfig(BaseModel):
    enabled: Optional[bool] = None
    max_size_bytes: Optional[int] = None
    max_objects: Optional[int] = None


class CephAdminRgwAccessKey(BaseModel):
    access_key: str
    secret_key: Optional[str] = None
    status: Optional[str] = None
    is_active: Optional[bool] = None
    created_at: Optional[datetime] = None
    user: Optional[str] = None
    subuser: Optional[str] = None


class CephAdminRgwGeneratedAccessKey(BaseModel):
    access_key: str
    secret_key: str


class CephAdminRgwAccessKeyStatusChange(BaseModel):
    active: bool


class CephAdminRgwAccountDetail(BaseModel):
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


class CephAdminRgwUserDetail(BaseModel):
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


class CephAdminRgwUserCapsUpdate(BaseModel):
    mode: Literal["replace", "add", "remove"] = "replace"
    values: list[str] = Field(default_factory=list)


class CephAdminRgwAccountCreate(BaseModel):
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


class CephAdminRgwAccountCreateResponse(BaseModel):
    account: CephAdminRgwAccountDetail


class CephAdminRgwUserCreate(BaseModel):
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


class CephAdminRgwUserCreateResponse(BaseModel):
    detail: CephAdminRgwUserDetail
    generated_key: Optional[CephAdminRgwGeneratedAccessKey] = None


class CephAdminRgwPlacementTarget(BaseModel):
    name: str
    storage_classes: list[str] = Field(default_factory=list)


class CephAdminRgwInfoSummary(BaseModel):
    default_placement: Optional[str] = None
    zonegroup: Optional[str] = None
    realm: Optional[str] = None
    placement_targets: list[CephAdminRgwPlacementTarget] = Field(default_factory=list)
    storage_classes: list[str] = Field(default_factory=list)


class CephAdminRgwAccountConfigUpdate(BaseModel):
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


class CephAdminRgwUserConfigUpdate(BaseModel):
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


class CephAdminBucketUsagePoint(BaseModel):
    name: str
    used_bytes: Optional[int] = None
    object_count: Optional[int] = None


class CephAdminEntityMetrics(BaseModel):
    total_bytes: Optional[int] = None
    total_objects: Optional[int] = None
    bucket_count: int = 0
    bucket_usage: list[CephAdminBucketUsagePoint] = Field(default_factory=list)
    generated_at: datetime


BucketFilterField = Literal[
    "name",
    "tenant",
    "owner",
    "owner_name",
    "owner_kind",
    "tag",
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


class CephAdminBucketCompareRequest(BaseModel):
    target_endpoint_id: int = Field(..., ge=1)
    source_bucket: str
    target_bucket: str
    include_content: bool = True
    include_config: bool = False
    size_only: bool = False
    diff_sample_limit: int = Field(default=200, ge=1, le=2000)

    @model_validator(mode="after")
    def validate_names(self):
        self.source_bucket = (self.source_bucket or "").strip()
        self.target_bucket = (self.target_bucket or "").strip()
        if not self.source_bucket:
            raise ValueError("source_bucket is required.")
        if not self.target_bucket:
            raise ValueError("target_bucket is required.")
        if not self.include_content and not self.include_config:
            raise ValueError("At least one comparison scope must be enabled.")
        return self


class CephAdminBucketObjectDiffEntry(BaseModel):
    key: str
    source_size: Optional[int] = None
    target_size: Optional[int] = None
    source_etag: Optional[str] = None
    target_etag: Optional[str] = None
    compare_by: Literal["md5", "size"]


class CephAdminBucketContentDiff(BaseModel):
    compare_mode: Literal["size_only", "md5_or_size"]
    source_count: int = 0
    target_count: int = 0
    matched_count: int = 0
    different_count: int = 0
    only_source_count: int = 0
    only_target_count: int = 0
    only_source_sample: list[str] = Field(default_factory=list)
    only_target_sample: list[str] = Field(default_factory=list)
    different_sample: list[CephAdminBucketObjectDiffEntry] = Field(default_factory=list)


class CephAdminBucketConfigDiffSection(BaseModel):
    key: str
    label: str
    source: Any = None
    target: Any = None
    changed: bool = False


class CephAdminBucketConfigDiff(BaseModel):
    changed: bool = False
    sections: list[CephAdminBucketConfigDiffSection] = Field(default_factory=list)


class CephAdminBucketCompareResult(BaseModel):
    source_endpoint_id: int
    target_endpoint_id: int
    source_bucket: str
    target_bucket: str
    compare_mode: Optional[Literal["size_only", "md5_or_size"]] = None
    has_differences: bool = False
    content_diff: Optional[CephAdminBucketContentDiff] = None
    config_diff: Optional[CephAdminBucketConfigDiff] = None


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


class CephAdminUserFilterRule(BaseModel):
    field: UserFilterField
    op: UserFilterOp
    value: Optional[Union[str, int, float, bool, list[str], list[int], list[float], list[bool]]] = None

    @model_validator(mode="after")
    def validate_rule(self):
        if self.op not in ("is_null", "not_null") and self.value is None:
            raise ValueError("User filter rule requires value.")
        return self


class CephAdminUserFilterQuery(BaseModel):
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


class CephAdminAccountFilterRule(BaseModel):
    field: AccountFilterField
    op: AccountFilterOp
    value: Optional[Union[str, int, float, bool, list[str], list[int], list[float], list[bool]]] = None

    @model_validator(mode="after")
    def validate_rule(self):
        if self.op not in ("is_null", "not_null") and self.value is None:
            raise ValueError("Account filter rule requires value.")
        return self


class CephAdminAccountFilterQuery(BaseModel):
    match: Literal["all", "any"] = "all"
    rules: list[CephAdminAccountFilterRule] = Field(default_factory=list)
