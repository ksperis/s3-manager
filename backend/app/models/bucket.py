# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from datetime import datetime
from typing import Any, Optional, List, Literal

from pydantic import Field, field_validator, model_validator

from app.models.base import ApiModel


class BucketTag(ApiModel):
    key: str
    value: str


class BucketFeatureStatus(ApiModel):
    state: str
    tone: Literal["active", "inactive", "unknown"]


class Bucket(ApiModel):
    name: str
    creation_date: Optional[datetime] = None
    used_bytes: Optional[int] = None
    object_count: Optional[int] = None
    quota_max_size_bytes: Optional[int] = None
    quota_max_objects: Optional[int] = None
    tags: Optional[List[BucketTag]] = None
    features: Optional[dict[str, BucketFeatureStatus]] = None


class BucketPublicAccessBlock(ApiModel):
    block_public_acls: Optional[bool] = None
    ignore_public_acls: Optional[bool] = None
    block_public_policy: Optional[bool] = None
    restrict_public_buckets: Optional[bool] = None


class BucketCreate(ApiModel):
    name: str
    versioning: Optional[bool] = None
    location_constraint: Optional[str] = None

    @field_validator("location_constraint", mode="before")
    @classmethod
    def normalize_location_constraint(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        normalized = str(value).strip()
        return normalized or None


class BucketVersioningUpdate(ApiModel):
    enabled: bool


class BucketVersioningStatus(ApiModel):
    status: Optional[str] = None
    enabled: bool = False


class BucketPolicyIn(ApiModel):
    policy: dict


class BucketPolicyOut(ApiModel):
    policy: Optional[dict] = None


class LifecycleRule(ApiModel):
    id: Optional[str] = None
    status: Optional[str] = None
    prefix: Optional[str] = None


class BucketLifecycleConfig(ApiModel):
    rules: List[dict] = Field(default_factory=list)


class BucketTagsUpdate(ApiModel):
    tags: List[BucketTag] = Field(default_factory=list)


class BucketObjectLock(ApiModel):
    enabled: Optional[bool] = None
    mode: Optional[str] = None
    days: Optional[int] = None
    years: Optional[int] = None


class BucketObjectLockUpdate(ApiModel):
    enabled: Optional[bool] = None
    mode: Optional[str] = None
    days: Optional[int] = None
    years: Optional[int] = None

    @field_validator("days", "years")
    @classmethod
    def validate_positive(cls, value: Optional[int]) -> Optional[int]:
        if value is not None and value < 0:
            raise ValueError("Retention must be positive.")
        return value

    @model_validator(mode="after")
    def validate_retention(self) -> "BucketObjectLockUpdate":
        days = self.days
        years = self.years
        mode = self.mode
        if days is not None and years is not None:
            raise ValueError("Specify either Days or Years, not both.")
        if (days is not None or years is not None) and not mode:
            raise ValueError("Mode is required to set a default retention.")
        return self


class BucketProperties(ApiModel):
    versioning_status: Optional[str] = None
    object_lock_enabled: Optional[bool] = None
    object_lock: Optional[BucketObjectLock] = None
    public_access_block: Optional[BucketPublicAccessBlock] = None
    lifecycle_rules: List[LifecycleRule] = Field(default_factory=list)
    cors_rules: Optional[list[dict]] = None


class BucketAclGrantee(ApiModel):
    type: str
    id: Optional[str] = None
    display_name: Optional[str] = None
    uri: Optional[str] = None


class BucketAclGrant(ApiModel):
    grantee: BucketAclGrantee
    permission: str


class BucketAcl(ApiModel):
    owner: Optional[str] = None
    grants: List[BucketAclGrant] = Field(default_factory=list)


class BucketAclUpdate(ApiModel):
    acl: str


class BucketQuotaUpdate(ApiModel):
    max_size_gb: Optional[float] = None
    max_size_unit: Optional[str] = None
    max_objects: Optional[int] = None


class BucketCorsUpdate(ApiModel):
    rules: list[dict]


class BucketEncryptionConfiguration(ApiModel):
    rules: list[dict] = Field(default_factory=list)


class BucketNotificationConfiguration(ApiModel):
    configuration: dict = Field(default_factory=dict)


FeatureRuleInventoryFeature = Literal["lifecycle", "policy", "cors", "notifications", "tags"]
FeatureRuleInventoryStatus = Literal["configured", "empty", "unavailable"]


class FeatureRuleInventoryRule(ApiModel):
    id: str
    type: str
    title: str
    summary: str
    chips: list[str] = Field(default_factory=list)
    raw: dict[str, Any] = Field(default_factory=dict)


class FeatureRuleInventoryBucket(ApiModel):
    bucket_name: str
    feature: FeatureRuleInventoryFeature
    status: FeatureRuleInventoryStatus
    rules: list[FeatureRuleInventoryRule] = Field(default_factory=list)
    error: Optional[str] = None


class BucketReplicationConfiguration(ApiModel):
    configuration: dict = Field(default_factory=dict)


class BucketLoggingConfiguration(ApiModel):
    enabled: Optional[bool] = None
    target_bucket: Optional[str] = None
    target_prefix: Optional[str] = None


class BucketWebsiteRedirectAllRequestsTo(ApiModel):
    host_name: str
    protocol: Optional[str] = None


class BucketWebsiteConfiguration(ApiModel):
    index_document: Optional[str] = None
    error_document: Optional[str] = None
    redirect_all_requests_to: Optional[BucketWebsiteRedirectAllRequestsTo] = None
    routing_rules: List[dict] = Field(default_factory=list)
