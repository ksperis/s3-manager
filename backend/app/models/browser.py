# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from datetime import datetime
from typing import Optional, Literal

from pydantic import Field

from app.models.base import ApiModel
from app.models.portal import PortalStorageSpaceIcon


class BrowserBucket(ApiModel):
    name: str
    creation_date: Optional[datetime] = None
    display_name: Optional[str] = None
    workspace_label: Optional[str] = None
    description: Optional[str] = None
    used_bytes: Optional[int] = None
    object_count: Optional[int] = None
    quota_max_size_bytes: Optional[int] = None
    quota_max_objects: Optional[int] = None
    status: Optional[str] = None
    role: Optional[str] = None
    internal_bucket_name: Optional[str] = None
    icon: Optional[PortalStorageSpaceIcon] = None


class BrowserObject(ApiModel):
    key: str
    size: int
    last_modified: Optional[datetime] = None
    etag: Optional[str] = None
    storage_class: Optional[str] = None


BrowserObjectSortBy = Literal["name", "size", "modified", "storage_class", "etag"]
BrowserObjectSortDir = Literal["asc", "desc"]
BrowserObjectLazyColumn = Literal[
    "content_type",
    "tags_count",
    "metadata_count",
    "cache_control",
    "expires",
    "restore_status",
]


class ListBrowserObjectsResponse(ApiModel):
    prefix: str
    objects: list[BrowserObject]
    prefixes: list[str]
    is_truncated: bool = False
    next_continuation_token: Optional[str] = None


class ObjectColumnsRequest(ApiModel):
    keys: list[str] = Field(default_factory=list, min_length=1, max_length=200)
    columns: list[BrowserObjectLazyColumn] = Field(default_factory=list, min_length=1, max_length=6)


class ObjectColumnValues(ApiModel):
    key: str
    content_type: Optional[str] = None
    tags_count: Optional[int] = None
    metadata_count: Optional[int] = None
    cache_control: Optional[str] = None
    expires: Optional[datetime] = None
    restore_status: Optional[str] = None
    metadata_status: Literal["ready", "error"] = "ready"
    tags_status: Literal["ready", "error"] = "ready"


class ObjectColumnsResponse(ApiModel):
    items: list[ObjectColumnValues] = Field(default_factory=list)


class PaginatedBrowserBucketsResponse(ApiModel):
    items: list[BrowserBucket] = Field(default_factory=list)
    total: int = 0
    page: int = 1
    page_size: int = 50
    has_next: bool = False


class BrowserUsageSummary(ApiModel):
    available: bool = False
    source: Optional[Literal["account", "s3_user", "portal", "connection"]] = None
    label: Optional[str] = None
    used_bytes: Optional[int] = None
    object_count: Optional[int] = None
    quota_max_size_bytes: Optional[int] = None
    quota_max_objects: Optional[int] = None


class BrowserObjectVersion(ApiModel):
    key: str
    version_id: Optional[str] = None
    is_latest: bool = False
    is_delete_marker: bool = False
    last_modified: Optional[datetime] = None
    size: Optional[int] = None
    etag: Optional[str] = None
    storage_class: Optional[str] = None


class ListObjectVersionsResponse(ApiModel):
    prefix: Optional[str] = None
    common_prefixes: list[str] = Field(default_factory=list)
    versions: list[BrowserObjectVersion] = Field(default_factory=list)
    delete_markers: list[BrowserObjectVersion] = Field(default_factory=list)
    is_truncated: bool = False
    key_marker: Optional[str] = None
    version_id_marker: Optional[str] = None
    next_key_marker: Optional[str] = None
    next_version_id_marker: Optional[str] = None


class ObjectMetadata(ApiModel):
    key: str
    size: int
    etag: Optional[str] = None
    last_modified: Optional[datetime] = None
    content_type: Optional[str] = None
    cache_control: Optional[str] = None
    content_disposition: Optional[str] = None
    content_encoding: Optional[str] = None
    content_language: Optional[str] = None
    expires: Optional[datetime] = None
    storage_class: Optional[str] = None
    restore_status: Optional[str] = None
    metadata: dict[str, str] = Field(default_factory=dict)
    version_id: Optional[str] = None


class ObjectTag(ApiModel):
    key: str
    value: str


class ObjectTags(ApiModel):
    key: str
    tags: list[ObjectTag] = Field(default_factory=list)
    version_id: Optional[str] = None


class ObjectMetadataUpdate(ApiModel):
    key: str
    version_id: Optional[str] = None
    content_type: Optional[str] = None
    cache_control: Optional[str] = None
    content_disposition: Optional[str] = None
    content_encoding: Optional[str] = None
    content_language: Optional[str] = None
    expires: Optional[str] = None
    metadata: Optional[dict[str, str]] = None
    storage_class: Optional[str] = None


class ObjectAcl(ApiModel):
    key: str
    acl: str
    version_id: Optional[str] = None


class ObjectLegalHold(ApiModel):
    key: str
    status: Optional[Literal["ON", "OFF"]] = None
    version_id: Optional[str] = None


class ObjectRetention(ApiModel):
    key: str
    mode: Optional[Literal["GOVERNANCE", "COMPLIANCE"]] = None
    retain_until: Optional[datetime] = None
    bypass_governance: Optional[bool] = None
    version_id: Optional[str] = None


class ObjectRestoreRequest(ApiModel):
    key: str
    days: int = Field(default=1, ge=1, le=3650)
    tier: Optional[Literal["Standard", "Bulk", "Expedited"]] = None
    version_id: Optional[str] = None


class PresignRequest(ApiModel):
    key: str
    operation: Literal["get_object", "put_object", "delete_object"]
    expires_in: int = Field(default=900, ge=60, le=43200)
    content_type: Optional[str] = None
    response_content_disposition: Optional[str] = None
    version_id: Optional[str] = None


class PresignedUrl(ApiModel):
    url: str
    method: str = "GET"
    expires_in: int
    headers: dict[str, str] = Field(default_factory=dict)


class SseCustomerContext(ApiModel):
    algorithm: Literal["AES256"] = "AES256"
    key: str
    key_md5: str


class MultipartUploadInitRequest(ApiModel):
    key: str
    content_type: Optional[str] = None
    metadata: dict[str, str] = Field(default_factory=dict)
    tags: list[ObjectTag] = Field(default_factory=list)
    acl: Optional[str] = None


class MultipartUploadInitResponse(ApiModel):
    key: str
    upload_id: str


class MultipartUploadItem(ApiModel):
    key: str
    upload_id: str
    initiated: Optional[datetime] = None
    storage_class: Optional[str] = None
    owner: Optional[str] = None


class ListMultipartUploadsResponse(ApiModel):
    uploads: list[MultipartUploadItem] = Field(default_factory=list)
    is_truncated: bool = False
    next_key: Optional[str] = None
    next_upload_id: Optional[str] = None


class MultipartPart(ApiModel):
    part_number: int
    etag: str
    size: int
    last_modified: Optional[datetime] = None


class ListPartsResponse(ApiModel):
    parts: list[MultipartPart] = Field(default_factory=list)
    is_truncated: bool = False
    next_part_number: Optional[int] = None


class PresignPartRequest(ApiModel):
    key: str
    upload_id: Optional[str] = None
    part_number: int
    expires_in: int = Field(default=900, ge=60, le=43200)


class PresignPartResponse(ApiModel):
    url: str
    method: str = "PUT"
    expires_in: int
    headers: dict[str, str] = Field(default_factory=dict)


class CompletedPart(ApiModel):
    part_number: int
    etag: str


class CompleteMultipartUploadRequest(ApiModel):
    parts: list[CompletedPart]


class CopyObjectPayload(ApiModel):
    source_bucket: Optional[str] = None
    source_key: str
    destination_key: str
    source_version_id: Optional[str] = None
    metadata: dict[str, str] = Field(default_factory=dict)
    replace_metadata: bool = False
    tags: list[ObjectTag] = Field(default_factory=list)
    replace_tags: bool = False
    acl: Optional[str] = None
    move: bool = False


class DeleteObjectEntry(ApiModel):
    key: str
    version_id: Optional[str] = None


class DeleteObjectsPayload(ApiModel):
    objects: list[DeleteObjectEntry]


class CleanupObjectVersionsPayload(ApiModel):
    prefix: Optional[str] = None
    keep_last_n: Optional[int] = Field(default=None, ge=1)
    older_than_days: Optional[int] = Field(default=None, ge=1)
    delete_orphan_markers: bool = False


class CleanupObjectVersionsResponse(ApiModel):
    prefix: Optional[str] = None
    deleted_versions: int = 0
    deleted_delete_markers: int = 0
    scanned_versions: int = 0
    scanned_delete_markers: int = 0


class BucketCorsRule(ApiModel):
    allowed_origins: list[str] = Field(default_factory=list)
    allowed_methods: list[str] = Field(default_factory=list)
    allowed_headers: list[str] = Field(default_factory=list)
    expose_headers: list[str] = Field(default_factory=list)
    max_age_seconds: Optional[int] = None


class BucketCorsStatus(ApiModel):
    enabled: bool
    rules: list[BucketCorsRule] = Field(default_factory=list)
    error: Optional[str] = None


class StsStatus(ApiModel):
    available: bool
    error: Optional[str] = None


class BrowserStsCredentials(ApiModel):
    access_key_id: str
    secret_access_key: str
    session_token: str
    expiration: datetime
    endpoint: str
    region: str
