# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator

from app.models.app_settings import PortalSettings, PortalSettingsOverride
from app.models.usage_history import UsageHistoryTrendResponse, UsageHistoryTrendWindow


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
    max_buckets: Optional[int] = None
    s3_endpoint: Optional[str] = None
    used_bytes: Optional[int] = None
    used_objects: Optional[int] = None
    quota_max_size_bytes: Optional[int] = None
    quota_max_objects: Optional[int] = None
    just_created: bool = False
    account_role: Optional[str] = None
    can_manage_buckets: bool = False
    can_create_storage_spaces: bool = False
    can_manage_portal_users: bool = False
    allow_named_bucket_create: bool = False


class PortalAccessKeysState(BaseModel):
    iam_user: PortalIAMUser
    s3_endpoint: Optional[str] = None
    access_keys: list[PortalAccessKey]
    can_manage_access_keys: bool = False
    max_access_keys: int = Field(default=2, ge=1)


class PortalUsageStorageSpace(BaseModel):
    id: str
    name: str
    account_id: Optional[int] = None
    project_account_label: Optional[str] = None
    used_bytes: Optional[int] = None
    object_count: Optional[int] = None
    quota_max_size_bytes: Optional[int] = None
    quota_max_objects: Optional[int] = None


class PortalUsageAccount(BaseModel):
    account_id: int
    account_name: str
    display_name: str
    rgw_account_id: Optional[str] = None
    storage_endpoint_name: Optional[str] = None
    storage_endpoint_zonegroup: Optional[str] = None
    used_bytes: Optional[int] = None
    used_objects: Optional[int] = None
    quota_max_size_bytes: Optional[int] = None
    quota_max_objects: Optional[int] = None
    storage_space_count: int = 0


class PortalUsage(BaseModel):
    used_bytes: Optional[int] = None
    used_objects: Optional[int] = None
    quota_max_size_bytes: Optional[int] = None
    quota_max_objects: Optional[int] = None
    storage_spaces: list[PortalUsageStorageSpace] = Field(default_factory=list)
    other_storage_space: Optional[PortalUsageStorageSpace] = None
    accounts: list[PortalUsageAccount] = Field(default_factory=list)


class PortalUsageAccountTrend(BaseModel):
    account_id: int
    account_name: str
    display_name: str
    rgw_account_id: Optional[str] = None
    storage_endpoint_name: Optional[str] = None
    storage_endpoint_zonegroup: Optional[str] = None
    trend: UsageHistoryTrendResponse


class PortalUsageAccountTrends(BaseModel):
    window: UsageHistoryTrendWindow
    available: bool = True
    unavailable_reason: Optional[str] = None
    accounts: list[PortalUsageAccountTrend] = Field(default_factory=list)


PortalStorageSpaceRole = Literal["Viewer", "Editor", "Owner"]
PortalStorageSpaceOrigin = Literal["portal_generic", "portal_named", "imported"]
PortalStorageSpaceNamingMode = Literal["generic_uuid", "named_bucket"]
PortalStorageSpaceVisibility = Literal["private", "shared"]
PortalStorageSpaceShareScope = Literal["restricted", "account"]
PortalStorageSpaceAccountMemberRole = Literal["Viewer", "Editor"]
PortalStorageSpaceShareDirection = Literal["with_me", "by_me"]
PortalTransferDirection = Literal["Upload", "Download"]
PortalTransferStatus = Literal["Completed", "Uploading", "Queued", "Failed"]
PortalAlertTone = Literal["info", "warning", "danger"]
PortalStorageObjectPreviewType = Literal["text", "image", "unavailable"]
PortalReplicationMode = Literal["bucket_level", "global"]
PortalReplicationStatus = Literal["configured", "unavailable", "error"]


class PortalStorageSpaceSummary(BaseModel):
    id: str
    name: str
    account_id: Optional[int] = None
    project_account_label: Optional[str] = None
    role: PortalStorageSpaceRole
    content_role: Optional[PortalStorageSpaceRole] = None
    can_browse: bool = True
    status: str = "Active"
    description: Optional[str] = None
    owner_label: Optional[str] = None
    owner_user_id: Optional[int] = None
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


class PortalStorageSpace(PortalStorageSpaceSummary):
    pass


class PortalStorageSpaceInitialShare(BaseModel):
    user_id: int
    role: PortalStorageSpaceRole


class PortalStorageSpaceCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    account_id: Optional[int] = None
    naming_mode: PortalStorageSpaceNamingMode = "generic_uuid"
    description: Optional[str] = Field(default=None, max_length=2000)
    owner_label: Optional[str] = Field(default=None, max_length=120)
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


class PortalStorageSpaceImport(BaseModel):
    bucket_name: str = Field(min_length=1, max_length=63)
    account_id: Optional[int] = None
    description: Optional[str] = Field(default=None, max_length=2000)
    owner_label: Optional[str] = Field(default=None, max_length=120)
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


class PortalStorageSpaceUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    description: Optional[str] = Field(default=None, max_length=2000)
    owner_label: Optional[str] = Field(default=None, max_length=120)
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


class PortalReplicationStorageSpace(BaseModel):
    id: str
    name: str
    bucket_name: str
    account_id: int
    account_name: str
    project_account_label: Optional[str] = None
    storage_endpoint_id: Optional[int] = None
    storage_endpoint_name: Optional[str] = None
    storage_endpoint_zonegroup: Optional[str] = None
    bucket_replication_allowed: bool = False
    global_replication_configured: bool = False
    can_manage: bool = False


class PortalReplicationSummary(BaseModel):
    id: str
    mode: PortalReplicationMode
    status: PortalReplicationStatus
    source: PortalReplicationStorageSpace
    target: Optional[PortalReplicationStorageSpace] = None
    target_bucket_name: Optional[str] = None
    zonegroup: Optional[str] = None
    rule_id: Optional[str] = None
    role_arn: Optional[str] = None
    message: Optional[str] = None


class PortalReplicationList(BaseModel):
    storage_spaces: list[PortalReplicationStorageSpace] = Field(default_factory=list)
    replications: list[PortalReplicationSummary] = Field(default_factory=list)
    can_create: bool = False
    unavailable_reason: Optional[str] = None


class PortalReplicationCreate(BaseModel):
    source_storage_space_id: str = Field(min_length=1)
    target_storage_space_id: str = Field(min_length=1)


class PortalStorageObjectDeleteResponse(BaseModel):
    key: str
    message: str


class PortalStorageObjectDetail(BaseModel):
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


class PortalStorageSpaceShare(BaseModel):
    id: str
    storage_space_id: str
    storage_space_name: str
    user_id: Optional[int] = None
    email: str
    role: PortalStorageSpaceRole
    direction: PortalStorageSpaceShareDirection
    activity_label: str = "Active"


class PortalStorageSpaceAccessPerson(BaseModel):
    user_id: Optional[int] = None
    email: str
    display_name: Optional[str] = None
    role: PortalStorageSpaceRole
    account_role: Optional[str] = None
    access_source: Optional[Literal["owner", "direct", "group", "direct_and_group"]] = None


class PortalStorageSpaceAccessSummary(BaseModel):
    mode: Literal["private", "all", "restricted"]
    default_account_member_role: Optional[PortalStorageSpaceAccountMemberRole] = None
    owner: PortalStorageSpaceAccessPerson
    effective_member_count: int = 0
    explicit_shares: list[PortalStorageSpaceShare] = Field(default_factory=list)
    public_link_count: int = 0
    can_manage_access: bool = False
    can_create_public_links: bool = False


class PortalStorageSpaceShareCandidate(BaseModel):
    user_id: int
    email: str
    display_name: Optional[str] = None
    account_role: str
    access_source: Literal["direct", "group", "direct_and_group"]
    already_shared: bool = False


class PortalStorageSpaceSharePayload(BaseModel):
    email: Optional[str] = None
    user_id: Optional[int] = None
    role: PortalStorageSpaceRole


class PortalStorageSpaceShareUpdate(BaseModel):
    role: PortalStorageSpaceRole


class PortalPublicLink(BaseModel):
    id: int
    storage_space_id: str
    storage_space_name: str
    object_key: str
    object_name: str
    url: str
    label: Optional[str] = None
    created_by_email: Optional[str] = None
    created_at: datetime
    expires_at: Optional[datetime] = None
    revoked_at: Optional[datetime] = None
    status: str


class PortalPublicLinkCreate(BaseModel):
    object_key: str = Field(min_length=1)
    label: Optional[str] = Field(default=None, max_length=120)
    expires_at: Optional[datetime] = None


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


class PortalEligibility(BaseModel):
    eligible: bool
    reasons: list[str] = Field(default_factory=list)
