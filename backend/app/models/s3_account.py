# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.pagination import PaginatedResponse
from app.models.tagging import TagDefinitionInput, TagDefinitionSummary, validate_tag_definition_list
from app.models.ui_group import UiGroupAvatar
from app.models.user import UserAvatar
from app.utils.account_roles import CanonicalAccountRole


class _CanonicalAccountLink(BaseModel):
    model_config = ConfigDict(extra="forbid")

    role: CanonicalAccountRole


class AccountUserLink(_CanonicalAccountLink):
    user_id: int
    user_email: Optional[str] = None
    user_full_name: Optional[str] = None
    user_avatar: Optional[UserAvatar] = None


class AccountGroupLink(_CanonicalAccountLink):
    group_id: int
    group_name: Optional[str] = None
    group_avatar: Optional[UiGroupAvatar] = None


class _StrictS3AccountMutation(BaseModel):
    model_config = ConfigDict(extra="forbid")


class S3Account(BaseModel):
    id: str
    db_id: Optional[int] = None
    name: str
    rgw_account_id: Optional[str] = None
    rgw_user_uid: Optional[str] = None
    is_s3_user: bool = False
    quota_max_size_gb: Optional[float] = None
    quota_max_objects: Optional[int] = None
    root_user_email: Optional[str] = None
    root_user_id: Optional[int] = None
    email: Optional[str] = None
    used_bytes: Optional[int] = None
    used_objects: Optional[int] = None
    user_ids: Optional[list[int]] = None
    user_links: Optional[list[AccountUserLink]] = None
    group_ids: Optional[list[int]] = None
    group_links: Optional[list[AccountGroupLink]] = None
    bucket_count: Optional[int] = None
    rgw_user_count: Optional[int] = None
    rgw_user_uids: Optional[list[str]] = None
    rgw_topic_count: Optional[int] = None
    rgw_topics: Optional[list[str]] = None
    storage_endpoint_id: int
    storage_endpoint_name: str
    storage_endpoint_url: str
    storage_endpoint_is_default: bool
    storage_endpoint_capabilities: dict[str, bool]
    allow_bucket_quota_management: bool = False
    tags: list[TagDefinitionSummary] = Field(default_factory=list)


class S3AccountCreate(_StrictS3AccountMutation):
    name: str
    email: Optional[str] = None
    quota_max_size_gb: Optional[float] = None
    quota_max_size_unit: Optional[str] = None
    quota_max_objects: Optional[int] = None
    storage_endpoint_id: int
    tags: list[TagDefinitionInput] = Field(default_factory=list)

    @field_validator("tags", mode="before")
    @classmethod
    def normalize_tags(cls, value: object) -> list[dict[str, str]]:
        return validate_tag_definition_list(value, allow_none=False) or []


class S3AccountImport(_StrictS3AccountMutation):
    rgw_account_id: str
    name: Optional[str] = None
    email: Optional[str] = None
    storage_endpoint_id: int


class S3AccountUpdate(_StrictS3AccountMutation):
    quota_max_size_gb: Optional[float] = None
    quota_max_size_unit: Optional[str] = None
    quota_max_objects: Optional[int] = None
    user_ids: Optional[list[int]] = None
    user_links: Optional[list[AccountUserLink]] = None
    group_ids: Optional[list[int]] = None
    group_links: Optional[list[AccountGroupLink]] = None
    name: Optional[str] = None
    email: Optional[str] = None
    storage_endpoint_id: Optional[int] = None
    tags: Optional[list[TagDefinitionInput]] = None
    allow_bucket_quota_management: Optional[bool] = None

    @field_validator("tags", mode="before")
    @classmethod
    def normalize_optional_tags(cls, value: object) -> Optional[list[dict[str, str]]]:
        return validate_tag_definition_list(value, allow_none=True)

    @field_validator("storage_endpoint_id", mode="before")
    @classmethod
    def reject_null_storage_endpoint_id(cls, value: object) -> object:
        if value is None:
            raise ValueError("storage_endpoint_id cannot be null")
        return value


class S3AccountSummary(BaseModel):
    id: str
    db_id: Optional[int] = None
    name: str
    rgw_account_id: Optional[str] = None
    is_s3_user: bool = False
    user_ids: Optional[list[int]] = None
    user_links: Optional[list[AccountUserLink]] = None
    group_ids: Optional[list[int]] = None
    group_links: Optional[list[AccountGroupLink]] = None
    storage_endpoint_id: int
    storage_endpoint_name: str
    storage_endpoint_url: str
    storage_endpoint_is_default: bool
    storage_endpoint_capabilities: dict[str, bool]
    allow_bucket_quota_management: bool = False
    tags: list[TagDefinitionSummary] = Field(default_factory=list)


class PaginatedS3AccountsResponse(PaginatedResponse):
    items: list[S3Account]
