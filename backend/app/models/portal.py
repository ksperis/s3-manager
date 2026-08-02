# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from datetime import datetime
from typing import Literal, Optional, Union

from pydantic import AwareDatetime, BaseModel, Field, field_validator, model_validator

from app.models.app_settings import PortalSettings, PortalSettingsOverride
from app.models.bucket_usage_stats import BucketUsageStatsDistributionEntry, BucketUsageStatsScanMode
from app.models.user import UserAvatar


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
    target_type: Literal["self", "external"] = "self"
    external_email: Optional[str] = None
    storage_space_name: Optional[str] = None
    bucket_name: Optional[str] = None
    permission: Optional[Literal["read_only", "read_write"]] = None


class PortalAccessKeyCreate(BaseModel):
    target_type: Literal["self", "external"] = "self"
    storage_space_id: Optional[str] = Field(default=None, min_length=1, max_length=1024)
    external_email: Optional[str] = Field(default=None, max_length=254)
    permission: Optional[Literal["read_only", "read_write"]] = None

    @field_validator("storage_space_id")
    @classmethod
    def _validate_storage_space_id(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Storage Space is required")
        return cleaned

    @field_validator("external_email")
    @classmethod
    def _validate_external_email(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        cleaned = " ".join(value.split())
        if not cleaned:
            raise ValueError("External user label is required")
        return cleaned


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
    can_create_private_storage_spaces: bool = False
    can_create_team_storage_spaces: bool = False
    can_manage_portal_users: bool = False
    allow_named_bucket_create: bool = False
    server_access_logging_enabled: bool = True
    storage_space_version_cleanup_enabled: bool = True


class PortalAccessKeysState(BaseModel):
    iam_user: PortalIAMUser
    s3_endpoint: Optional[str] = None
    force_path_style: bool = False
    access_keys: list[PortalAccessKey]
    can_manage_access_keys: bool = False
    max_access_keys: int = Field(default=2, ge=1)


class PortalUsageStorageSpace(BaseModel):
    id: str
    name: str
    used_bytes: Optional[int] = None
    object_count: Optional[int] = None
    quota_max_size_bytes: Optional[int] = None
    quota_max_objects: Optional[int] = None


class PortalUsage(BaseModel):
    used_bytes: Optional[int] = None
    used_objects: Optional[int] = None
    quota_max_size_bytes: Optional[int] = None
    quota_max_objects: Optional[int] = None
    max_buckets: Optional[int] = None
    storage_spaces: list[PortalUsageStorageSpace] = Field(default_factory=list)
    other_storage_space: Optional[PortalUsageStorageSpace] = None


class PortalStorageSpaceUsageStatsSnapshot(BaseModel):
    scan_mode: BucketUsageStatsScanMode
    version_listing_available: bool = True
    object_version_count: int = 0
    current_version_count: int = 0
    noncurrent_version_count: int = 0
    delete_marker_count: int = 0
    total_bytes: int = 0
    current_bytes: int = 0
    noncurrent_bytes: int = 0
    data_type_distribution: list[BucketUsageStatsDistributionEntry] = Field(default_factory=list)
    storage_class_distribution: list[BucketUsageStatsDistributionEntry] = Field(default_factory=list)
    size_distribution: list[BucketUsageStatsDistributionEntry] = Field(default_factory=list)
    age_distribution: list[BucketUsageStatsDistributionEntry] = Field(default_factory=list)
    current_vs_noncurrent: list[BucketUsageStatsDistributionEntry] = Field(default_factory=list)
    calculated_at: datetime


class PortalStorageSpaceUsageStatsResponse(BaseModel):
    snapshot: Optional[PortalStorageSpaceUsageStatsSnapshot] = None


PortalStorageSpaceRole = Literal["Viewer", "Editor", "Owner", "Manager"]
PortalStorageSpaceGrantRole = Literal["Viewer", "Editor"]
PortalStorageSpaceOrigin = Literal["portal_generic", "portal_named", "imported"]
PortalStorageSpaceNamingMode = Literal["generic_uuid", "named_bucket"]
PortalStorageSpaceVisibility = Literal["private", "shared"]
PortalStorageSpaceShareScope = Literal["restricted", "account"]
PortalStorageSpaceAccountMemberRole = Literal["Viewer", "Editor"]
PortalStorageSpaceIconSource = Literal["preset", "uploaded"]
PortalStorageSpaceIconPreset = Literal["bucket", "folder", "archive", "database", "media"]
PortalStorageSpaceShareDirection = Literal["with_me", "by_me"]
PortalServerAccessDirection = Literal["Upload", "Download"]
PortalAlertTone = Literal["info", "warning", "danger"]
PortalStorageObjectPreviewType = Literal["text", "image", "unavailable"]


class PortalStorageSpaceCollaboratorPreview(BaseModel):
    user_id: int
    email: str
    display_name: Optional[str] = None
    role: PortalStorageSpaceRole
    avatar: UserAvatar


class PortalStorageSpaceIcon(BaseModel):
    source: PortalStorageSpaceIconSource = "preset"
    preset: Optional[PortalStorageSpaceIconPreset] = "bucket"
    url: Optional[str] = None
    updated_at: Optional[datetime] = None


class PortalStorageSpaceIconChoice(BaseModel):
    source: PortalStorageSpaceIconSource
    preset: Optional[PortalStorageSpaceIconPreset] = None


class PortalStorageSpaceSummary(BaseModel):
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


class PortalStorageSpaceInitialShare(BaseModel):
    user_id: int
    role: PortalStorageSpaceGrantRole


class PortalStorageSpaceCreate(BaseModel):
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


class PortalStorageSpaceImport(BaseModel):
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


class PortalStorageSpaceUpdate(BaseModel):
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


PortalStorageSpaceVersionCleanupStatus = Literal["completed", "failed", "canceled"]
PortalStorageSpaceVersionCleanupStage = Literal["prepare", "list", "delete", "completed"]
PortalStorageSpaceVersioningStatus = Literal["Enabled", "Suspended", "Disabled"]


class PortalStorageSpaceSettings(BaseModel):
    versioning_enabled: bool
    versioning_status: PortalStorageSpaceVersioningStatus
    lifecycle_enabled: bool
    version_history_retention_days: int = Field(ge=1)
    can_update: bool = False


class PortalStorageSpaceSettingsUpdate(BaseModel):
    versioning_enabled: bool
    lifecycle_enabled: bool
    version_history_retention_days: int = Field(ge=1)


class PortalStorageSpaceVersionCleanupRequest(BaseModel):
    confirmation: str = ""


def portal_storage_space_version_cleanup_confirmation_phrase(space_name: str) -> str:
    return f"CLEAN HISTORY {space_name.upper()}"


class PortalStorageSpaceVersionCleanupProgress(BaseModel):
    request_id: Optional[str] = None
    stage: PortalStorageSpaceVersionCleanupStage = "prepare"
    storage_space_id: str
    storage_space_name: str
    scanned_versions: int = 0
    scanned_delete_markers: int = 0
    delete_candidates: int = 0
    deleted_versions: int = 0
    deleted_delete_markers: int = 0
    bytes_freed: int = 0
    total_candidates_final: bool = False
    message: Optional[str] = None


class PortalStorageSpaceVersionCleanupResult(BaseModel):
    status: PortalStorageSpaceVersionCleanupStatus
    storage_space_id: str
    storage_space_name: str
    scanned_versions: int = 0
    scanned_delete_markers: int = 0
    deleted_versions: int = 0
    deleted_delete_markers: int = 0
    bytes_freed: int = 0
    started_at: datetime
    finished_at: datetime


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


class PortalStorageObjectVersion(BaseModel):
    key: str
    version_id: str
    is_latest: bool = False
    is_delete_marker: bool = False
    last_modified: Optional[datetime] = None
    size: Optional[int] = None


class PortalStorageObjectVersionsResponse(BaseModel):
    key: str
    versioning_status: PortalStorageSpaceVersioningStatus
    can_restore: bool = False
    versions: list[PortalStorageObjectVersion] = Field(default_factory=list)
    is_truncated: bool = False
    next_key_marker: Optional[str] = None
    next_version_id_marker: Optional[str] = None


class PortalTrashItem(BaseModel):
    key: str
    name: str
    deleted_at: Optional[datetime] = None
    delete_marker_version_id: str
    previous_version_id: Optional[str] = None
    previous_last_modified: Optional[datetime] = None
    size: Optional[int] = None


class PortalTrashResponse(BaseModel):
    versioning_status: PortalStorageSpaceVersioningStatus
    can_restore: bool = False
    items: list[PortalTrashItem] = Field(default_factory=list)
    is_truncated: bool = False
    next_key_marker: Optional[str] = None
    next_version_id_marker: Optional[str] = None


class PortalStorageObjectRestoreRequest(BaseModel):
    key: str = Field(min_length=1)
    version_id: Optional[str] = Field(default=None, min_length=1)


class PortalStorageObjectRestoreResponse(BaseModel):
    key: str
    restored_from_version_id: str
    message: str = "Restored"


PortalDeletedPrefixRestoreStatus = Literal["completed", "partial", "canceled"]
PortalDeletedPrefixRestoreStage = Literal["prepare", "list", "restore", "completed"]


class PortalDeletedPrefixRestoreRequest(BaseModel):
    prefix: str = Field(min_length=1, max_length=1024)


class PortalDeletedPrefixRestoreFailure(BaseModel):
    key: str
    detail: str


class PortalDeletedPrefixRestoreProgress(BaseModel):
    request_id: Optional[str] = None
    stage: PortalDeletedPrefixRestoreStage = "prepare"
    storage_space_id: str
    storage_space_name: str
    prefix: str
    scanned_versions: int = 0
    scanned_delete_markers: int = 0
    restore_candidates: int = 0
    restored_objects: int = 0
    failed_objects: int = 0
    total_candidates_final: bool = False
    current_key: Optional[str] = None
    message: Optional[str] = None


class PortalDeletedPrefixRestoreResult(BaseModel):
    status: PortalDeletedPrefixRestoreStatus
    storage_space_id: str
    storage_space_name: str
    prefix: str
    scanned_versions: int = 0
    scanned_delete_markers: int = 0
    restore_candidates: int = 0
    restored_objects: int = 0
    failed_objects: int = 0
    failures: list[PortalDeletedPrefixRestoreFailure] = Field(default_factory=list)
    failures_truncated: bool = False
    started_at: datetime
    finished_at: datetime


class PortalStorageSpaceShare(BaseModel):
    id: str
    storage_space_id: str
    storage_space_name: str
    user_id: Optional[int] = None
    email: str
    role: PortalStorageSpaceGrantRole
    direction: PortalStorageSpaceShareDirection
    activity_label: str = "Active"


class PortalStorageSpaceAccessPerson(BaseModel):
    user_id: Optional[int] = None
    email: str
    display_name: Optional[str] = None
    role: PortalStorageSpaceRole
    account_role: Optional[str] = None
    access_source: Optional[Literal["owner", "direct", "group", "direct_and_group"]] = None
    avatar: Optional[UserAvatar] = None


class PortalStorageSpaceAccessSummary(BaseModel):
    mode: Literal["private", "all", "restricted"]
    default_account_member_role: Optional[PortalStorageSpaceAccountMemberRole] = None
    owner: Optional[PortalStorageSpaceAccessPerson] = None
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
    avatar: Optional[UserAvatar] = None


class PortalCollaborator(BaseModel):
    user_id: int
    email: str
    display_name: Optional[str] = None
    account_role: str
    access_source: Literal["direct", "group", "direct_and_group"]
    member_since: Optional[datetime] = None
    avatar: Optional[UserAvatar] = None
    can_review_access: bool = False


PortalCollaboratorStorageSpaceAccessSource = Literal[
    "direct",
    "team",
    "owner",
    "project_manager",
]


class PortalCollaboratorStorageSpaceAccess(BaseModel):
    storage_space_id: str
    storage_space_name: str
    role: PortalStorageSpaceRole
    source: PortalCollaboratorStorageSpaceAccessSource
    can_revoke: bool = False


class PortalCollaboratorAccessReview(BaseModel):
    collaborator: PortalCollaborator
    can_request_project_removal: bool = False
    space_accesses: list[PortalCollaboratorStorageSpaceAccess] = Field(default_factory=list)


class PortalCollaboratorTrend(BaseModel):
    window: Literal["month", "week", "day"]
    label: str
    period_start: str
    collaborator_count: int = 0


class PortalCollaboratorSummary(BaseModel):
    collaborator_count: int = 0
    external_access_key_count: int = 0
    trend: Optional[PortalCollaboratorTrend] = None


class PortalCollaboratorsResponse(BaseModel):
    summary: PortalCollaboratorSummary
    collaborators: list[PortalCollaborator] = Field(default_factory=list)


class PortalStorageSpaceSharePayload(BaseModel):
    email: Optional[str] = None
    user_id: Optional[int] = None
    role: PortalStorageSpaceGrantRole


class PortalStorageSpaceShareUpdate(BaseModel):
    role: PortalStorageSpaceGrantRole


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
    expires_at: Optional[AwareDatetime] = None


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


class PortalServerAccessRequesterIdentity(BaseModel):
    label: str
    kind: Literal["portal_user", "external_access", "rgw_user", "rgw_account", "unknown"]
    detail: Optional[str] = None
    access_key_id: Optional[str] = None
    iam_username: Optional[str] = None
    user_id: Optional[int] = None
    email: Optional[str] = None
    resolved: bool = False


PortalServerAccessLogFilterField = Literal["action", "space", "path", "identity", "result"]
PortalServerAccessLogFilterOp = Literal[
    "eq",
    "neq",
    "contains",
    "starts_with",
    "ends_with",
    "in",
    "not_in",
    "is_null",
    "not_null",
]


class PortalServerAccessLogFilterRule(BaseModel):
    field: PortalServerAccessLogFilterField
    op: PortalServerAccessLogFilterOp
    value: Optional[Union[str, int, float, bool, list[str], list[int], list[float], list[bool]]] = None

    @model_validator(mode="after")
    def validate_rule(self):
        if self.op not in ("is_null", "not_null") and self.value is None:
            raise ValueError("Portal server access log filter rule requires value.")
        return self


class PortalServerAccessLogFilterQuery(BaseModel):
    match: Literal["all", "any"] = "all"
    rules: list[PortalServerAccessLogFilterRule] = Field(default_factory=list)


class PortalServerAccessLogEntry(BaseModel):
    id: str
    source: Literal["server_access_logging"] = "server_access_logging"
    timestamp: datetime
    storage_space_id: Optional[str] = None
    storage_space_name: Optional[str] = None
    bucket_name: str
    operation: str
    operation_category: Literal["upload", "download", "delete", "metadata", "list", "other"]
    object_key: Optional[str] = None
    object_name: Optional[str] = None
    direction: Optional[PortalServerAccessDirection] = None
    status_code: Optional[int] = None
    error_code: Optional[str] = None
    bytes_sent: Optional[int] = None
    object_size: Optional[int] = None
    requester: Optional[str] = None
    requester_identity: Optional[PortalServerAccessRequesterIdentity] = None
    client_ip: Optional[str] = None
    auth_type: Optional[str] = None
    request_id: Optional[str] = None
    request_uri: Optional[str] = None
    user_agent: Optional[str] = None
    log_object_key: str


class PortalServerAccessLogPage(BaseModel):
    entries: list[PortalServerAccessLogEntry]
    total: int
    limit: int
    offset: int


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


class PortalAccountSettings(BaseModel):
    effective: PortalSettings
    admin_override: PortalSettingsOverride
    delegated_to_portal_managers: bool = False


class PortalProjectSettings(BaseModel):
    effective: PortalSettings
    project_override: PortalSettingsOverride
    delegated_to_portal_managers: bool = False
    can_update: bool = False


class PortalEligibility(BaseModel):
    eligible: bool
    reasons: list[str] = Field(default_factory=list)
