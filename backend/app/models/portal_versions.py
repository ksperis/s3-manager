# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Portal storage-space versioning, history, and restore contracts."""

from datetime import datetime
from typing import Literal, Optional

from pydantic import Field

from app.models.base import ApiModel


PortalStorageSpaceVersionCleanupStatus = Literal["completed", "failed", "canceled"]
PortalStorageSpaceVersionCleanupStage = Literal["prepare", "list", "delete", "completed"]
PortalStorageSpaceVersioningStatus = Literal["Enabled", "Suspended", "Disabled"]


class PortalStorageSpaceSettings(ApiModel):
    versioning_enabled: bool
    versioning_status: PortalStorageSpaceVersioningStatus
    lifecycle_enabled: bool
    version_history_retention_days: int = Field(ge=1)
    can_update: bool = False


class PortalStorageSpaceSettingsUpdate(ApiModel):
    versioning_enabled: bool
    lifecycle_enabled: bool
    version_history_retention_days: int = Field(ge=1)


class PortalStorageSpaceVersionCleanupRequest(ApiModel):
    confirmation: str = ""


def portal_storage_space_version_cleanup_confirmation_phrase(space_name: str) -> str:
    return f"CLEAN HISTORY {space_name.upper()}"


class PortalStorageSpaceVersionCleanupProgress(ApiModel):
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


class PortalStorageSpaceVersionCleanupResult(ApiModel):
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


class PortalStorageObjectVersion(ApiModel):
    key: str
    version_id: str
    is_latest: bool = False
    is_delete_marker: bool = False
    last_modified: Optional[datetime] = None
    size: Optional[int] = None


class PortalStorageObjectVersionsResponse(ApiModel):
    key: str
    versioning_status: PortalStorageSpaceVersioningStatus
    can_restore: bool = False
    versions: list[PortalStorageObjectVersion] = Field(default_factory=list)
    is_truncated: bool = False
    next_key_marker: Optional[str] = None
    next_version_id_marker: Optional[str] = None


class PortalTrashItem(ApiModel):
    key: str
    name: str
    deleted_at: Optional[datetime] = None
    delete_marker_version_id: str
    previous_version_id: Optional[str] = None
    previous_last_modified: Optional[datetime] = None
    size: Optional[int] = None


class PortalTrashResponse(ApiModel):
    versioning_status: PortalStorageSpaceVersioningStatus
    can_restore: bool = False
    items: list[PortalTrashItem] = Field(default_factory=list)
    is_truncated: bool = False
    next_key_marker: Optional[str] = None
    next_version_id_marker: Optional[str] = None


class PortalStorageObjectRestoreRequest(ApiModel):
    key: str = Field(min_length=1)
    version_id: Optional[str] = Field(default=None, min_length=1)


class PortalStorageObjectRestoreResponse(ApiModel):
    key: str
    restored_from_version_id: str
    message: str = "Restored"


PortalDeletedPrefixRestoreStatus = Literal["completed", "partial", "canceled"]
PortalDeletedPrefixRestoreStage = Literal["prepare", "list", "restore", "completed"]


class PortalDeletedPrefixRestoreRequest(ApiModel):
    prefix: str = Field(min_length=1, max_length=1024)


class PortalDeletedPrefixRestoreFailure(ApiModel):
    key: str
    detail: str


class PortalDeletedPrefixRestoreProgress(ApiModel):
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


class PortalDeletedPrefixRestoreResult(ApiModel):
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
