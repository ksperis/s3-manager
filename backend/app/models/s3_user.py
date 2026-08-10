# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.models.pagination import PaginatedResponse
from app.models.tagging import TagDefinitionInput, TagDefinitionSummary, validate_tag_definition_list
from app.models.ui_group import UiGroupAvatar
from app.models.user import UserAssociationDetail, UserAvatar


class S3UserGroupDetail(BaseModel):
    id: int
    name: str
    avatar: Optional[UiGroupAvatar] = None
    allow_manager_browser_data_access: bool = False


class _S3UserAssociationLink(BaseModel):
    model_config = ConfigDict(extra="forbid")

    allow_manager_browser_data_access: bool = False


class S3UserUserLink(_S3UserAssociationLink):
    user_id: int
    user_email: Optional[str] = None
    user_full_name: Optional[str] = None
    user_display_name: Optional[str] = None
    user_avatar: Optional[UserAvatar] = None


class S3UserGroupLink(_S3UserAssociationLink):
    group_id: int
    group_name: Optional[str] = None
    group_avatar: Optional[UiGroupAvatar] = None


class S3User(BaseModel):
    id: int
    name: str
    rgw_user_uid: str
    email: Optional[str] = None
    created_at: Optional[datetime] = None
    user_ids: list[int] = Field(default_factory=list)
    user_details: list[UserAssociationDetail] = Field(default_factory=list)
    user_links: list[S3UserUserLink] = Field(default_factory=list)
    group_ids: list[int] = Field(default_factory=list)
    group_details: list[S3UserGroupDetail] = Field(default_factory=list)
    group_links: list[S3UserGroupLink] = Field(default_factory=list)
    quota_max_size_gb: Optional[float] = None
    quota_max_objects: Optional[int] = None
    storage_endpoint_id: int
    storage_endpoint_name: str
    storage_endpoint_url: str
    bucket_count: Optional[int] = None
    allow_bucket_quota_management: bool = False
    allow_access_key_management: bool = False
    allow_managed_private_connection_provisioning: bool = False
    tags: list[TagDefinitionSummary] = Field(default_factory=list)

    @model_validator(mode="after")
    def populate_canonical_links(self) -> "S3User":
        if not self.user_links:
            self.user_links = [
                S3UserUserLink(
                    user_id=detail.id,
                    user_email=detail.email,
                    user_full_name=detail.full_name,
                    user_display_name=detail.display_name,
                    user_avatar=detail.avatar,
                    allow_manager_browser_data_access=detail.allow_manager_browser_data_access,
                )
                for detail in self.user_details
            ]
        if not self.group_links:
            self.group_links = [
                S3UserGroupLink(
                    group_id=detail.id,
                    group_name=detail.name,
                    group_avatar=detail.avatar,
                    allow_manager_browser_data_access=detail.allow_manager_browser_data_access,
                )
                for detail in self.group_details
            ]
        return self


class S3UserCreate(BaseModel):
    name: str
    uid: Optional[str] = None
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


class S3UserImport(BaseModel):
    uid: str
    name: Optional[str] = None
    email: Optional[str] = None
    storage_endpoint_id: int


class S3UserUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    user_ids: Optional[list[int]] = None
    user_links: Optional[list[S3UserUserLink]] = None
    group_ids: Optional[list[int]] = None
    group_links: Optional[list[S3UserGroupLink]] = None
    quota_max_size_gb: Optional[float] = None
    quota_max_size_unit: Optional[str] = None
    quota_max_objects: Optional[int] = None
    tags: Optional[list[TagDefinitionInput]] = None
    allow_bucket_quota_management: Optional[bool] = None
    allow_access_key_management: Optional[bool] = None
    allow_managed_private_connection_provisioning: Optional[bool] = None

    @field_validator("tags", mode="before")
    @classmethod
    def normalize_optional_tags(cls, value: object) -> Optional[list[dict[str, str]]]:
        return validate_tag_definition_list(value, allow_none=True)

    @model_validator(mode="after")
    def reject_ambiguous_association_links(self) -> "S3UserUpdate":
        if self.user_links is not None and self.user_ids is not None:
            raise ValueError("user_links and user_ids cannot be provided together")
        if self.group_links is not None and self.group_ids is not None:
            raise ValueError("group_links and group_ids cannot be provided together")
        return self


class S3UserAccessKey(BaseModel):
    access_key_id: str
    status: Optional[str] = None
    created_at: Optional[datetime] = None
    is_ui_managed: bool = False
    is_active: bool = True
    is_private_access_managed: bool = False
    managed_connection_id: Optional[int] = None


class S3UserGeneratedKey(BaseModel):
    access_key_id: str
    secret_access_key: str
    created_at: Optional[datetime] = None


class S3UserAccessKeyStatusChange(BaseModel):
    active: bool


class S3UserSummary(BaseModel):
    id: int
    name: str
    rgw_user_uid: str
    storage_endpoint_id: int
    storage_endpoint_name: str
    storage_endpoint_url: str
    allow_bucket_quota_management: bool = False
    allow_access_key_management: bool = False
    allow_managed_private_connection_provisioning: bool = False
    tags: list[TagDefinitionSummary] = Field(default_factory=list)


class PaginatedS3UsersResponse(PaginatedResponse):
    items: list[S3User]
