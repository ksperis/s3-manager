# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from datetime import datetime
from typing import Optional, Literal

from pydantic import BaseModel, Field


class BrowserBucket(BaseModel):
    name: str
    creation_date: Optional[datetime] = None


class BrowserObject(BaseModel):
    key: str
    size: int
    last_modified: Optional[datetime] = None
    etag: Optional[str] = None
    storage_class: Optional[str] = None


class ListBrowserObjectsResponse(BaseModel):
    prefix: str
    objects: list[BrowserObject]
    prefixes: list[str]
    is_truncated: bool = False
    next_continuation_token: Optional[str] = None


class BrowserObjectVersion(BaseModel):
    key: str
    version_id: Optional[str] = None
    is_latest: bool = False
    is_delete_marker: bool = False
    last_modified: Optional[datetime] = None
    size: Optional[int] = None
    etag: Optional[str] = None
    storage_class: Optional[str] = None


class ListObjectVersionsResponse(BaseModel):
    prefix: Optional[str] = None
    versions: list[BrowserObjectVersion] = Field(default_factory=list)
    delete_markers: list[BrowserObjectVersion] = Field(default_factory=list)
    is_truncated: bool = False
    key_marker: Optional[str] = None
    version_id_marker: Optional[str] = None
    next_key_marker: Optional[str] = None
    next_version_id_marker: Optional[str] = None


class ObjectMetadata(BaseModel):
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
    metadata: dict[str, str] = Field(default_factory=dict)
    version_id: Optional[str] = None


class ObjectTag(BaseModel):
    key: str
    value: str


class ObjectTags(BaseModel):
    key: str
    tags: list[ObjectTag] = Field(default_factory=list)
    version_id: Optional[str] = None


class ObjectMetadataUpdate(BaseModel):
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


class ObjectAcl(BaseModel):
    key: str
    acl: str
    version_id: Optional[str] = None


class ObjectLegalHold(BaseModel):
    key: str
    status: Optional[Literal["ON", "OFF"]] = None
    version_id: Optional[str] = None


class ObjectRetention(BaseModel):
    key: str
    mode: Optional[Literal["GOVERNANCE", "COMPLIANCE"]] = None
    retain_until: Optional[datetime] = None
    bypass_governance: Optional[bool] = None
    version_id: Optional[str] = None


class ObjectRestoreRequest(BaseModel):
    key: str
    days: int = Field(default=1, ge=1, le=3650)
    tier: Optional[Literal["Standard", "Bulk", "Expedited"]] = None
    version_id: Optional[str] = None


class PresignRequest(BaseModel):
    key: str
    operation: Literal["get_object", "put_object", "delete_object", "post_object"]
    expires_in: int = Field(default=900, ge=60, le=43200)
    content_type: Optional[str] = None
    content_length: Optional[int] = None
    version_id: Optional[str] = None


class PresignedUrl(BaseModel):
    url: str
    method: str = "GET"
    expires_in: int
    fields: dict[str, str] = Field(default_factory=dict)
    headers: dict[str, str] = Field(default_factory=dict)


class MultipartUploadInitRequest(BaseModel):
    key: str
    content_type: Optional[str] = None
    metadata: dict[str, str] = Field(default_factory=dict)
    tags: list[ObjectTag] = Field(default_factory=list)
    acl: Optional[str] = None


class MultipartUploadInitResponse(BaseModel):
    key: str
    upload_id: str


class MultipartUploadItem(BaseModel):
    key: str
    upload_id: str
    initiated: Optional[datetime] = None
    storage_class: Optional[str] = None
    owner: Optional[str] = None


class ListMultipartUploadsResponse(BaseModel):
    uploads: list[MultipartUploadItem] = Field(default_factory=list)
    is_truncated: bool = False
    next_key: Optional[str] = None
    next_upload_id: Optional[str] = None


class MultipartPart(BaseModel):
    part_number: int
    etag: str
    size: int
    last_modified: Optional[datetime] = None


class ListPartsResponse(BaseModel):
    parts: list[MultipartPart] = Field(default_factory=list)
    is_truncated: bool = False
    next_part_number: Optional[int] = None


class PresignPartRequest(BaseModel):
    key: str
    upload_id: Optional[str] = None
    part_number: int
    expires_in: int = Field(default=900, ge=60, le=43200)


class PresignPartResponse(BaseModel):
    url: str
    method: str = "PUT"
    expires_in: int
    headers: dict[str, str] = Field(default_factory=dict)


class CompletedPart(BaseModel):
    part_number: int
    etag: str


class CompleteMultipartUploadRequest(BaseModel):
    parts: list[CompletedPart]


class CopyObjectPayload(BaseModel):
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


class DeleteObjectEntry(BaseModel):
    key: str
    version_id: Optional[str] = None


class DeleteObjectsPayload(BaseModel):
    objects: list[DeleteObjectEntry]


class BucketCorsRule(BaseModel):
    allowed_origins: list[str] = Field(default_factory=list)
    allowed_methods: list[str] = Field(default_factory=list)
    allowed_headers: list[str] = Field(default_factory=list)
    expose_headers: list[str] = Field(default_factory=list)
    max_age_seconds: Optional[int] = None


class BucketCorsStatus(BaseModel):
    enabled: bool
    rules: list[BucketCorsRule] = Field(default_factory=list)
    error: Optional[str] = None


class StsStatus(BaseModel):
    available: bool
    error: Optional[str] = None
