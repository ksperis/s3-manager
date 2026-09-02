# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from typing import Optional

from pydantic import Field, field_validator

from app.models.account_access import AccountAccessGrant
from app.models.base import ApiModel
from app.models.pagination import PaginatedResponse
from app.models.tagging import (
    OptionalTagDefinitionList,
    RequiredTagDefinitionList,
    TagDefinitionSummary,
)
from app.models.ui_group import UiGroupAvatar
from app.models.user import UserAvatar
from app.utils.rgw_identifiers import is_rgw_account_id, normalize_rgw_identifier


class AccountUserLink(AccountAccessGrant):
    user_id: int
    user_email: Optional[str] = None
    user_full_name: Optional[str] = None
    user_avatar: Optional[UserAvatar] = None


class AccountGroupLink(AccountAccessGrant):
    group_id: int
    group_name: Optional[str] = None
    group_avatar: Optional[UiGroupAvatar] = None


class S3Account(ApiModel):
    id: int
    name: str
    rgw_account_id: str
    quota_max_size_gb: Optional[float] = None
    quota_max_objects: Optional[int] = None
    email: Optional[str] = None
    used_bytes: Optional[int] = None
    used_objects: Optional[int] = None
    user_links: list[AccountUserLink] = Field(default_factory=list)
    group_links: list[AccountGroupLink] = Field(default_factory=list)
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


class S3AccountCreate(ApiModel):
    name: str
    email: Optional[str] = None
    quota_max_size_gb: Optional[float] = None
    quota_max_size_unit: Optional[str] = None
    quota_max_objects: Optional[int] = None
    storage_endpoint_id: int
    tags: RequiredTagDefinitionList = Field(default_factory=list)


class S3AccountImport(ApiModel):
    rgw_account_id: str
    name: Optional[str] = None
    email: Optional[str] = None
    storage_endpoint_id: int

    @field_validator("rgw_account_id", mode="before")
    @classmethod
    def normalize_account_id(cls, value: object) -> str:
        normalized = normalize_rgw_identifier(str(value or ""))
        if not normalized or not is_rgw_account_id(normalized):
            raise ValueError("rgw_account_id must match RGW followed by 17 digits")
        return normalized


class S3AccountUpdate(ApiModel):
    quota_max_size_gb: Optional[float] = None
    quota_max_size_unit: Optional[str] = None
    quota_max_objects: Optional[int] = None
    user_links: Optional[list[AccountUserLink]] = None
    group_links: Optional[list[AccountGroupLink]] = None
    name: Optional[str] = None
    email: Optional[str] = None
    storage_endpoint_id: Optional[int] = None
    tags: OptionalTagDefinitionList = None
    allow_bucket_quota_management: Optional[bool] = None

    @field_validator("storage_endpoint_id", mode="before")
    @classmethod
    def reject_null_storage_endpoint_id(cls, value: object) -> object:
        if value is None:
            raise ValueError("storage_endpoint_id cannot be null")
        return value

    @field_validator("user_links", "group_links", mode="before")
    @classmethod
    def reject_null_principal_links(cls, value: object) -> object:
        if value is None:
            raise ValueError("principal links cannot be null; use an empty list to clear them")
        return value


class S3AccountSummary(ApiModel):
    id: int
    name: str
    rgw_account_id: str
    user_links: list[AccountUserLink] = Field(default_factory=list)
    group_links: list[AccountGroupLink] = Field(default_factory=list)
    storage_endpoint_id: int
    storage_endpoint_name: str
    storage_endpoint_url: str
    storage_endpoint_is_default: bool
    storage_endpoint_capabilities: dict[str, bool]
    allow_bucket_quota_management: bool = False
    tags: list[TagDefinitionSummary] = Field(default_factory=list)


class PaginatedS3AccountsResponse(PaginatedResponse):
    items: list[S3Account]
