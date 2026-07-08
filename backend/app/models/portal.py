# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from datetime import datetime
from typing import Literal, Optional, Union

from pydantic import BaseModel, Field, field_validator, model_validator

from app.models.app_settings import PortalSettings, PortalSettingsOverride


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
    storage_space_id: Optional[str] = None
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
    can_create_storage_spaces: bool = False
    can_manage_portal_users: bool = False
    allow_named_bucket_create: bool = False
    storage_space_version_cleanup_enabled: bool = True


class PortalAccessKeysState(BaseModel):
    iam_user: PortalIAMUser
    s3_endpoint: Optional[str] = None
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
    storage_spaces: list[PortalUsageStorageSpace] = Field(default_factory=list)
    other_storage_space: Optional[PortalUsageStorageSpace] = None


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


class PortalStorageSpaceSummary(BaseModel):
    id: str
    name: str
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


PortalStorageSpaceVersionCleanupStatus = Literal["completed", "failed", "canceled"]
PortalStorageSpaceVersionCleanupStage = Literal["prepare", "list", "delete", "completed"]


class PortalStorageSpaceVersionCleanupRequest(BaseModel):
    confirmation: str = ""


def portal_storage_space_version_cleanup_confirmation_phrase(space_name: str) -> str:
    return f"CLEAN HISTORY {space_name}"


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


class PortalCollaborator(BaseModel):
    user_id: int
    email: str
    display_name: Optional[str] = None
    account_role: str
    access_source: Literal["direct", "group", "direct_and_group"]
    member_since: Optional[datetime] = None


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


class PortalServerAccessRequesterIdentity(BaseModel):
    label: str
    kind: Literal["portal_user", "external_access", "rgw_user", "rgw_account", "unknown"]
    detail: Optional[str] = None
    access_key_id: Optional[str] = None
    iam_username: Optional[str] = None
    user_id: Optional[int] = None
    email: Optional[str] = None
    resolved: bool = False


PortalServerAccessLogFilterField = Literal["action", "path", "identity"]
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
    direction: Optional[PortalTransferDirection] = None
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


class PortalEligibility(BaseModel):
    eligible: bool
    reasons: list[str] = Field(default_factory=list)
