# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from datetime import datetime
from typing import Optional

from pydantic import Field

from app.models.base import ApiModel
from app.models.pagination import PaginatedResponse
from app.models.tagging import (
    OptionalTagDefinitionList,
    RequiredTagDefinitionList,
    TagDefinitionSummary,
)
from app.models.ui_group import UiGroupAvatar
from app.models.user import UserAvatar


class _S3UserAssociationLink(ApiModel):
    allow_manager_browser_data_access: bool = False


class S3UserUserLink(_S3UserAssociationLink):
    user_id: int
    user_email: Optional[str] = None
    user_full_name: Optional[str] = None
    user_avatar: Optional[UserAvatar] = None


class S3UserGroupLink(_S3UserAssociationLink):
    group_id: int
    group_name: Optional[str] = None
    group_avatar: Optional[UiGroupAvatar] = None


class S3User(ApiModel):
    id: int
    name: str
    rgw_user_uid: str
    email: Optional[str] = None
    created_at: Optional[datetime] = None
    user_links: list[S3UserUserLink] = Field(default_factory=list)
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

class S3UserCreate(ApiModel):
    name: str
    uid: Optional[str] = None
    email: Optional[str] = None
    quota_max_size_gb: Optional[float] = None
    quota_max_size_unit: Optional[str] = None
    quota_max_objects: Optional[int] = None
    storage_endpoint_id: int
    tags: RequiredTagDefinitionList = Field(default_factory=list)


class S3UserImport(ApiModel):
    uid: str
    name: Optional[str] = None
    email: Optional[str] = None
    storage_endpoint_id: int


class S3UserUpdate(ApiModel):
    name: Optional[str] = None
    email: Optional[str] = None
    user_links: Optional[list[S3UserUserLink]] = None
    group_links: Optional[list[S3UserGroupLink]] = None
    quota_max_size_gb: Optional[float] = None
    quota_max_size_unit: Optional[str] = None
    quota_max_objects: Optional[int] = None
    tags: OptionalTagDefinitionList = None
    allow_bucket_quota_management: Optional[bool] = None
    allow_access_key_management: Optional[bool] = None
    allow_managed_private_connection_provisioning: Optional[bool] = None

class S3UserAccessKey(ApiModel):
    access_key_id: str
    status: Optional[str] = None
    created_at: Optional[datetime] = None
    is_ui_managed: bool = False
    is_active: bool = True
    is_private_access_managed: bool = False
    managed_connection_id: Optional[int] = None


class S3UserGeneratedKey(ApiModel):
    access_key_id: str
    secret_access_key: str
    created_at: Optional[datetime] = None


class S3UserAccessKeyStatusChange(ApiModel):
    active: bool


class S3UserSummary(ApiModel):
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
