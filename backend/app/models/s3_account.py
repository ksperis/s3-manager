# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from typing import Optional

from pydantic import BaseModel, Field, field_validator, model_validator

from app.models.pagination import PaginatedResponse
from app.models.tagging import TagDefinitionInput, TagDefinitionSummary, validate_tag_definition_list
from app.models.ui_group import UiGroupAvatar
from app.models.user import UserAvatar
from app.utils.account_roles import adapt_legacy_role_payload, legacy_fields_for_role


class _CanonicalAccountLink(BaseModel):
    role: str
    account_admin: Optional[bool] = Field(default=None, deprecated=True)
    account_role: Optional[str] = Field(default=None, deprecated=True)

    @model_validator(mode="before")
    @classmethod
    def adapt_legacy_role(cls, value):
        return adapt_legacy_role_payload(value, require_explicit=True)

    @model_validator(mode="after")
    def derive_legacy_fields(self):
        if self.role:
            self.account_admin, self.account_role = legacy_fields_for_role(self.role)
        return self


class AccountUserLink(_CanonicalAccountLink):
    user_id: int
    user_email: Optional[str] = None
    user_full_name: Optional[str] = None
    user_avatar: Optional[UserAvatar] = None


class AccountGroupLink(_CanonicalAccountLink):
    group_id: int
    group_name: Optional[str] = None
    group_avatar: Optional[UiGroupAvatar] = None


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
    storage_endpoint_id: Optional[int] = None
    storage_endpoint_name: Optional[str] = None
    storage_endpoint_url: Optional[str] = None
    storage_endpoint_is_default: Optional[bool] = None
    storage_endpoint_capabilities: Optional[dict[str, bool]] = None
    allow_manager_bucket_quota: bool = False
    tags: list[TagDefinitionSummary] = Field(default_factory=list)


class S3AccountCreate(BaseModel):
    name: str
    email: Optional[str] = None
    quota_max_size_gb: Optional[float] = None
    quota_max_size_unit: Optional[str] = None
    quota_max_objects: Optional[int] = None
    storage_endpoint_id: Optional[int] = None
    storage_endpoint_name: Optional[str] = None
    storage_endpoint_url: Optional[str] = None
    tags: list[TagDefinitionInput] = Field(default_factory=list)

    @field_validator("tags", mode="before")
    @classmethod
    def normalize_tags(cls, value: object) -> list[dict[str, str]]:
        return validate_tag_definition_list(value, allow_none=False) or []


class S3AccountImport(BaseModel):
    rgw_account_id: str
    name: Optional[str] = None
    email: Optional[str] = None
    storage_endpoint_id: Optional[int] = None


class S3AccountUpdate(BaseModel):
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
    allow_manager_bucket_quota: Optional[bool] = None

    @field_validator("tags", mode="before")
    @classmethod
    def normalize_optional_tags(cls, value: object) -> Optional[list[dict[str, str]]]:
        return validate_tag_definition_list(value, allow_none=True)


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
    storage_endpoint_id: Optional[int] = None
    storage_endpoint_name: Optional[str] = None
    storage_endpoint_capabilities: Optional[dict[str, bool]] = None
    allow_manager_bucket_quota: bool = False
    tags: list[TagDefinitionSummary] = Field(default_factory=list)


class PaginatedS3AccountsResponse(PaginatedResponse):
    items: list[S3Account]
