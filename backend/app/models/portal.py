# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from datetime import datetime
from typing import Literal, Optional

from pydantic import Field, field_validator

from app.db import PortalAccountRole
from app.models.base import ApiModel
from app.models.app_settings import PortalSettings, PortalSettingsOverride
from app.models.user import UserAvatar


class PortalAccount(ApiModel):
    id: int
    name: str
    rgw_account_id: str
    portal_role: PortalAccountRole
    storage_endpoint_name: str
    storage_endpoint_url: str
    storage_endpoint_is_default: bool
    storage_endpoint_capabilities: dict[str, bool]


class PortalState(ApiModel):
    portal_role: Optional[PortalAccountRole] = None
    can_manage_buckets: bool = False
    can_create_private_storage_spaces: bool = False
    can_create_team_storage_spaces: bool = False
    can_manage_portal_users: bool = False
    allow_named_bucket_create: bool = False
    server_access_logging_enabled: bool = True
    storage_space_version_cleanup_enabled: bool = True


PortalStorageSpaceRole = Literal["Viewer", "Editor", "Owner", "Manager"]
PortalStorageSpaceGrantRole = Literal["Viewer", "Editor"]
PortalStorageSpaceOrigin = Literal["portal_generic", "portal_named", "imported"]
PortalStorageSpaceNamingMode = Literal["generic_uuid", "named_bucket"]
PortalStorageSpaceVisibility = Literal["private", "shared"]
PortalStorageSpaceShareScope = Literal["restricted", "account"]
PortalStorageSpaceAccountMemberRole = Literal["Viewer", "Editor"]
PortalStorageSpaceIconSource = Literal["preset", "uploaded"]
PortalStorageSpaceIconPreset = Literal["bucket", "folder", "archive", "database", "media"]
PortalAlertTone = Literal["info", "warning", "danger"]
PortalStorageObjectPreviewType = Literal["text", "image", "unavailable"]


class PortalStorageSpaceCollaboratorPreview(ApiModel):
    user_id: int
    email: str
    display_name: Optional[str] = None
    role: PortalStorageSpaceRole
    avatar: UserAvatar


class PortalStorageSpaceIcon(ApiModel):
    source: PortalStorageSpaceIconSource = "preset"
    preset: Optional[PortalStorageSpaceIconPreset] = "bucket"
    url: Optional[str] = None
    updated_at: Optional[datetime] = None


class PortalStorageSpaceIconChoice(ApiModel):
    source: PortalStorageSpaceIconSource
    preset: Optional[PortalStorageSpaceIconPreset] = None


class PortalStorageSpaceSummary(ApiModel):
    id: str
    name: str
    role: PortalStorageSpaceRole
    can_browse: bool = True
    can_take_ownership: bool = False
    can_delete: bool = False
    status: str = "Active"
    description: Optional[str] = None
    owner_label: Optional[str] = None
    owner_user_id: Optional[int] = None
    collaborators: list[PortalStorageSpaceCollaboratorPreview] = Field(default_factory=list)
    collaborator_count: int = 0
    visibility: PortalStorageSpaceVisibility = "private"
    share_scope: PortalStorageSpaceShareScope = "restricted"
    account_member_role: Optional[PortalStorageSpaceAccountMemberRole] = None
    project_key: Optional[str] = None
    dataset_label: Optional[str] = None
    region: Optional[str] = None
    created_at: Optional[datetime] = None
    used_bytes: Optional[int] = None
    object_count: Optional[int] = None
    quota_max_size_bytes: Optional[int] = None
    quota_max_objects: Optional[int] = None
    internal_bucket_name: Optional[str] = None
    archived_at: Optional[datetime] = None
    origin: PortalStorageSpaceOrigin = "imported"
    name_editable: bool = False
    icon: PortalStorageSpaceIcon = Field(default_factory=PortalStorageSpaceIcon)


class PortalStorageSpace(PortalStorageSpaceSummary):
    pass


class PortalStorageSpaceInitialShare(ApiModel):
    user_id: int
    role: PortalStorageSpaceGrantRole


class PortalStorageSpaceCreate(ApiModel):
    name: str = Field(min_length=1, max_length=120)
    naming_mode: PortalStorageSpaceNamingMode = "generic_uuid"
    description: Optional[str] = Field(default=None, max_length=2000)
    visibility: PortalStorageSpaceVisibility = "private"
    share_scope: PortalStorageSpaceShareScope = "restricted"
    account_member_role: Optional[PortalStorageSpaceAccountMemberRole] = None
    initial_shares: list[PortalStorageSpaceInitialShare] = Field(default_factory=list)
    project_key: Optional[str] = Field(default=None, max_length=80)
    dataset_label: Optional[str] = Field(default=None, max_length=120)

    @field_validator("name")
    @classmethod
    def _validate_name(cls, value: str) -> str:
        cleaned = " ".join(value.split())
        if not cleaned:
            raise ValueError("Storage Space name is required")
        return cleaned


class PortalStorageSpaceImport(ApiModel):
    bucket_name: str = Field(min_length=1, max_length=63)
    description: Optional[str] = Field(default=None, max_length=2000)
    visibility: PortalStorageSpaceVisibility = "private"
    share_scope: PortalStorageSpaceShareScope = "restricted"
    account_member_role: Optional[PortalStorageSpaceAccountMemberRole] = None
    initial_shares: list[PortalStorageSpaceInitialShare] = Field(default_factory=list)
    project_key: Optional[str] = Field(default=None, max_length=80)
    dataset_label: Optional[str] = Field(default=None, max_length=120)

    @field_validator("bucket_name")
    @classmethod
    def _validate_bucket_name(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Bucket name is required")
        return cleaned


class PortalStorageSpaceUpdate(ApiModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    description: Optional[str] = Field(default=None, max_length=2000)
    visibility: Optional[PortalStorageSpaceVisibility] = None
    share_scope: Optional[PortalStorageSpaceShareScope] = None
    account_member_role: Optional[PortalStorageSpaceAccountMemberRole] = None
    project_key: Optional[str] = Field(default=None, max_length=80)
    dataset_label: Optional[str] = Field(default=None, max_length=120)
    archived: Optional[bool] = None

    @field_validator("name")
    @classmethod
    def _validate_name(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return value
        cleaned = " ".join(value.split())
        if not cleaned:
            raise ValueError("Storage Space name is required")
        return cleaned


class PortalStorageObjectDeleteResponse(ApiModel):
    key: str
    message: str


class PortalStorageObjectDetail(ApiModel):
    key: str
    name: str
    size: Optional[int] = None
    last_modified: Optional[datetime] = None
    content_type: Optional[str] = None
    storage_class: Optional[str] = None
    encryption: Optional[str] = None
    preview_type: PortalStorageObjectPreviewType = "unavailable"
    preview_text: Optional[str] = None
    preview_unavailable_reason: Optional[str] = None


class PortalActivityItem(ApiModel):
    id: int
    created_at: datetime
    actor: str
    action: str
    target: str
    storage_space_id: Optional[str] = None
    storage_space_name: Optional[str] = None
    ip_address: Optional[str] = None
    status: str = "success"


class PortalAlert(ApiModel):
    id: str
    tone: PortalAlertTone
    title: str
    description: str
    severity_label: str
    storage_space_id: Optional[str] = None
    created_at: Optional[datetime] = None


class PortalAccountSettings(ApiModel):
    effective: PortalSettings
    admin_override: PortalSettingsOverride
    delegated_to_portal_managers: bool = False


class PortalProjectSettings(ApiModel):
    effective: PortalSettings
    project_override: PortalSettingsOverride
    delegated_to_portal_managers: bool = False
    can_update: bool = False
