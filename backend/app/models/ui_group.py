# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

from app.models.pagination import PaginatedResponse
from app.models.user import (
    AccountMembership,
    LinkedS3Connection,
    LinkedS3User,
    ManagerToolAccess,
    S3UserMembership,
    UserSummary,
)

UiGroupAvatarSource = Literal["initials", "preset", "uploaded"]
UiGroupAvatarIcon = Literal["users", "building", "shield", "briefcase", "academic"]


class UiGroupAvatar(BaseModel):
    source: UiGroupAvatarSource = "initials"
    initials: str
    icon: Optional[UiGroupAvatarIcon] = None
    url: Optional[str] = None
    updated_at: Optional[datetime] = None


class LinkedS3Account(BaseModel):
    id: int
    name: str
    rgw_account_id: Optional[str] = None


class UiGroupCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    description: Optional[str] = None
    avatar_source: UiGroupAvatarSource = "initials"
    avatar_icon: Optional[UiGroupAvatarIcon] = None
    can_access_ceph_admin: bool = False
    can_access_storage_ops: bool = False
    can_create_manual_private_connections: bool = False
    can_provision_managed_private_connections: bool = False
    manager_tool_access: Optional[ManagerToolAccess] = None
    browser_advanced_features_enabled: bool = False
    user_ids: list[int] = Field(default_factory=list)
    account_links: list[AccountMembership] = Field(default_factory=list)
    s3_user_links: list[S3UserMembership] = Field(default_factory=list)
    s3_connection_ids: list[int] = Field(default_factory=list)


class UiGroupUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Optional[str] = None
    description: Optional[str] = None
    avatar_source: Optional[UiGroupAvatarSource] = None
    avatar_icon: Optional[UiGroupAvatarIcon] = None
    can_access_ceph_admin: Optional[bool] = None
    can_access_storage_ops: Optional[bool] = None
    can_create_manual_private_connections: Optional[bool] = None
    can_provision_managed_private_connections: Optional[bool] = None
    manager_tool_access: Optional[ManagerToolAccess] = None
    browser_advanced_features_enabled: Optional[bool] = None
    user_ids: Optional[list[int]] = None
    account_links: Optional[list[AccountMembership]] = None
    s3_user_links: Optional[list[S3UserMembership]] = None
    s3_connection_ids: Optional[list[int]] = None


class UiGroupSummary(BaseModel):
    id: int
    name: str
    avatar: UiGroupAvatar


class UiGroupOut(BaseModel):
    id: int
    name: str
    description: Optional[str] = None
    avatar: UiGroupAvatar
    can_access_ceph_admin: bool = False
    can_access_storage_ops: bool = False
    can_create_manual_private_connections: bool = False
    can_provision_managed_private_connections: bool = False
    manager_tool_access: ManagerToolAccess = Field(default_factory=ManagerToolAccess)
    browser_advanced_features_enabled: bool = False
    user_ids: list[int] = Field(default_factory=list)
    user_details: list[UserSummary] = Field(default_factory=list)
    accounts: list[int] = Field(default_factory=list)
    account_details: list[LinkedS3Account] = Field(default_factory=list)
    account_links: list[AccountMembership] = Field(default_factory=list)
    s3_users: list[int] = Field(default_factory=list)
    s3_user_links: list[S3UserMembership] = Field(default_factory=list)
    s3_user_details: list[LinkedS3User] = Field(default_factory=list)
    s3_connections: list[int] = Field(default_factory=list)
    s3_connection_details: list[LinkedS3Connection] = Field(default_factory=list)
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class PaginatedUiGroupsResponse(PaginatedResponse):
    items: list[UiGroupOut]
