# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from datetime import datetime
from typing import Optional, List, Literal

from pydantic import BaseModel, Field, root_validator, validator


class BucketTag(BaseModel):
    key: str
    value: str


class BucketFeatureStatus(BaseModel):
    state: str
    tone: Literal["active", "inactive", "unknown"]


class Bucket(BaseModel):
    name: str
    creation_date: Optional[datetime] = None
    used_bytes: Optional[int] = None
    object_count: Optional[int] = None
    quota_max_size_bytes: Optional[int] = None
    quota_max_objects: Optional[int] = None
    tags: Optional[List[BucketTag]] = None
    features: Optional[dict[str, BucketFeatureStatus]] = None


class BucketPublicAccessBlock(BaseModel):
    block_public_acls: Optional[bool] = None
    ignore_public_acls: Optional[bool] = None
    block_public_policy: Optional[bool] = None
    restrict_public_buckets: Optional[bool] = None


class BucketCreate(BaseModel):
    name: str
    versioning: Optional[bool] = None


class BucketVersioningUpdate(BaseModel):
    enabled: bool


class BucketPolicyIn(BaseModel):
    policy: dict


class BucketPolicyOut(BaseModel):
    policy: Optional[dict] = None


class LifecycleRule(BaseModel):
    id: Optional[str] = None
    status: Optional[str] = None
    prefix: Optional[str] = None


class BucketLifecycleConfig(BaseModel):
    rules: List[dict] = Field(default_factory=list)


class BucketTagsUpdate(BaseModel):
    tags: List[BucketTag] = Field(default_factory=list)


class BucketObjectLock(BaseModel):
    enabled: Optional[bool] = None
    mode: Optional[str] = None
    days: Optional[int] = None
    years: Optional[int] = None


class BucketObjectLockUpdate(BaseModel):
    enabled: Optional[bool] = None
    mode: Optional[str] = None
    days: Optional[int] = None
    years: Optional[int] = None

    @validator("days", "years")
    def validate_positive(cls, value: Optional[int]) -> Optional[int]:
        if value is not None and value < 0:
            raise ValueError("Retention must be positive.")
        return value

    @root_validator(skip_on_failure=True)
    def validate_retention(cls, values: dict) -> dict:
        days = values.get("days")
        years = values.get("years")
        mode = values.get("mode")
        if days is not None and years is not None:
            raise ValueError("Specify either Days or Years, not both.")
        if (days is not None or years is not None) and not mode:
            raise ValueError("Mode is required to set a default retention.")
        return values


class BucketProperties(BaseModel):
    versioning_status: Optional[str] = None
    object_lock_enabled: Optional[bool] = None
    object_lock: Optional[BucketObjectLock] = None
    public_access_block: Optional[BucketPublicAccessBlock] = None
    lifecycle_rules: List[LifecycleRule] = Field(default_factory=list)
    cors_rules: Optional[list[dict]] = None


class BucketAclGrantee(BaseModel):
    type: str
    id: Optional[str] = None
    display_name: Optional[str] = None
    uri: Optional[str] = None


class BucketAclGrant(BaseModel):
    grantee: BucketAclGrantee
    permission: str


class BucketAcl(BaseModel):
    owner: Optional[str] = None
    grants: List[BucketAclGrant] = Field(default_factory=list)


class BucketAclUpdate(BaseModel):
    acl: str


class BucketQuotaUpdate(BaseModel):
    max_size_gb: Optional[float] = None
    max_size_unit: Optional[str] = None
    max_objects: Optional[int] = None


class BucketCorsUpdate(BaseModel):
    rules: list[dict]


class BucketEncryptionConfiguration(BaseModel):
    rules: list[dict] = Field(default_factory=list)


class BucketNotificationConfiguration(BaseModel):
    configuration: dict = Field(default_factory=dict)


class BucketLoggingConfiguration(BaseModel):
    enabled: Optional[bool] = None
    target_bucket: Optional[str] = None
    target_prefix: Optional[str] = None


class BucketWebsiteRedirectAllRequestsTo(BaseModel):
    host_name: str
    protocol: Optional[str] = None


class BucketWebsiteConfiguration(BaseModel):
    index_document: Optional[str] = None
    error_document: Optional[str] = None
    redirect_all_requests_to: Optional[BucketWebsiteRedirectAllRequestsTo] = None
    routing_rules: List[dict] = Field(default_factory=list)
