# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field

from app.models.app_settings import PortalSettings, PortalSettingsOverride, PortalSettingsOverridePolicy

from app.models.bucket import Bucket


class PortalAccessKey(BaseModel):
    access_key_id: str
    status: Optional[str] = None
    created_at: Optional[str] = None
    is_active: bool = False
    is_portal: bool = False
    deletable: bool = True
    secret_access_key: Optional[str] = None
    expires_at: Optional[datetime] = None
    session_token: Optional[str] = None


class PortalAccessKeyStatusChange(BaseModel):
    active: bool


class PortalIAMUser(BaseModel):
    iam_user_id: Optional[str] = None
    iam_username: Optional[str] = None
    arn: Optional[str] = None
    created_at: Optional[datetime] = None


class PortalState(BaseModel):
    account_id: int
    iam_user: PortalIAMUser
    access_keys: list[PortalAccessKey]
    iam_provisioned: bool = False
    buckets: list[Bucket]
    total_buckets: Optional[int] = None
    s3_endpoint: Optional[str] = None
    used_bytes: Optional[int] = None
    used_objects: Optional[int] = None
    quota_max_size_bytes: Optional[int] = None
    quota_max_objects: Optional[int] = None
    just_created: bool = False
    account_role: Optional[str] = None
    can_manage_buckets: bool = False
    can_manage_portal_users: bool = False


class PortalUsage(BaseModel):
    used_bytes: Optional[int] = None
    used_objects: Optional[int] = None


PortalStorageSpaceRole = Literal["Viewer", "Editor", "Owner"]
PortalStorageSpaceShareDirection = Literal["with_me", "by_me"]
PortalTransferDirection = Literal["Upload", "Download"]
PortalTransferStatus = Literal["Completed", "Uploading", "Queued", "Failed"]
PortalAlertTone = Literal["info", "warning", "danger"]


class PortalStorageSpaceSummary(BaseModel):
    id: str
    name: str
    role: PortalStorageSpaceRole
    status: str = "Active"
    region: Optional[str] = None
    created_at: Optional[datetime] = None
    used_bytes: Optional[int] = None
    object_count: Optional[int] = None
    quota_max_size_bytes: Optional[int] = None
    quota_max_objects: Optional[int] = None
    internal_bucket_name: Optional[str] = None


class PortalStorageSpace(PortalStorageSpaceSummary):
    description: Optional[str] = None


class PortalStorageObject(BaseModel):
    key: str
    name: str
    size: Optional[int] = None
    last_modified: Optional[datetime] = None


class PortalStorageObjectListing(BaseModel):
    prefix: str = ""
    objects: list[PortalStorageObject]
    prefixes: list[str]
    is_truncated: bool = False
    next_continuation_token: Optional[str] = None


class PortalStorageObjectUploadResponse(BaseModel):
    key: str
    message: str


class PortalStorageSpaceShare(BaseModel):
    id: str
    storage_space_id: str
    storage_space_name: str
    user_id: Optional[int] = None
    email: str
    role: PortalStorageSpaceRole
    direction: PortalStorageSpaceShareDirection
    activity_label: str = "Active"


class PortalStorageSpaceSharePayload(BaseModel):
    email: Optional[str] = None
    user_id: Optional[int] = None
    role: PortalStorageSpaceRole


class PortalStorageSpaceShareUpdate(BaseModel):
    role: PortalStorageSpaceRole


class PortalActivityItem(BaseModel):
    id: int
    created_at: datetime
    actor: str
    action: str
    target: str
    storage_space_id: Optional[str] = None
    storage_space_name: Optional[str] = None
    ip_address: Optional[str] = None
    status: str = "success"


class PortalTransfer(BaseModel):
    id: str
    name: str
    direction: PortalTransferDirection
    status: PortalTransferStatus
    progress: int = 100
    size_bytes: Optional[int] = None
    storage_space_id: Optional[str] = None
    storage_space_name: Optional[str] = None
    started_at: datetime
    eta_label: str = "Completed"
    speed_label: str = "-"
    error_message: Optional[str] = None


class PortalAlert(BaseModel):
    id: str
    tone: PortalAlertTone
    title: str
    description: str
    severity_label: str
    storage_space_id: Optional[str] = None
    created_at: Optional[datetime] = None


class PortalUserCard(BaseModel):
    id: Optional[int] = None
    email: str
    role: Optional[str] = None
    iam_username: Optional[str] = None
    iam_only: bool = False


class PortalIamComplianceIssue(BaseModel):
    scope: str
    subject: str
    message: str


class PortalIamComplianceReport(BaseModel):
    ok: bool
    issues: list[PortalIamComplianceIssue]


class PortalAccountSettings(BaseModel):
    effective: PortalSettings
    admin_override: PortalSettingsOverride
    portal_manager_override: PortalSettingsOverride
    override_policy: PortalSettingsOverridePolicy


class PortalEligibility(BaseModel):
    eligible: bool
    reasons: list[str] = Field(default_factory=list)
