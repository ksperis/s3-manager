# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional
from urllib.parse import urlparse

from pydantic import BaseModel, Field, model_validator


BucketMigrationMode = Literal["one_shot", "pre_sync"]
BucketMigrationStatus = Literal[
    "draft",
    "queued",
    "running",
    "pause_requested",
    "paused",
    "awaiting_cutover",
    "cancel_requested",
    "canceled",
    "completed",
    "completed_with_errors",
    "failed",
    "rolled_back",
]
BucketMigrationPrecheckStatus = Literal["pending", "passed", "failed"]
BucketMigrationItemStatus = Literal[
    "pending",
    "running",
    "awaiting_cutover",
    "paused",
    "skipped",
    "completed",
    "failed",
    "canceled",
]


class BucketMigrationBucketMapping(BaseModel):
    source_bucket: str
    target_bucket: Optional[str] = None

    @model_validator(mode="after")
    def validate_names(self):
        self.source_bucket = (self.source_bucket or "").strip()
        if not self.source_bucket:
            raise ValueError("source_bucket is required")
        if self.target_bucket is not None:
            normalized_target = self.target_bucket.strip()
            self.target_bucket = normalized_target or None
        return self


class BucketMigrationCreateRequest(BaseModel):
    source_context_id: str
    target_context_id: str
    buckets: list[BucketMigrationBucketMapping] = Field(default_factory=list, min_length=1)

    mapping_prefix: str = ""
    mode: BucketMigrationMode = "one_shot"
    copy_bucket_settings: bool = False
    delete_source: bool = False
    lock_target_writes: bool = True
    auto_grant_source_read_for_copy: bool = True
    webhook_url: Optional[str] = None
    parallelism_max: Optional[int] = Field(default=None, ge=1, le=128)

    @model_validator(mode="after")
    def validate_payload(self):
        self.source_context_id = (self.source_context_id or "").strip()
        self.target_context_id = (self.target_context_id or "").strip()
        self.mapping_prefix = (self.mapping_prefix or "").strip()
        if self.webhook_url is not None:
            normalized_webhook_url = self.webhook_url.strip()
            self.webhook_url = normalized_webhook_url or None
            if self.webhook_url is not None:
                parsed = urlparse(self.webhook_url)
                if parsed.scheme not in {"http", "https"} or not parsed.netloc:
                    raise ValueError("webhook_url must be a valid http(s) URL")
        if not self.source_context_id:
            raise ValueError("source_context_id is required")
        if not self.target_context_id:
            raise ValueError("target_context_id is required")
        if self.source_context_id == self.target_context_id:
            raise ValueError("source_context_id and target_context_id must differ")
        seen_source: set[str] = set()
        for entry in self.buckets:
            if entry.source_bucket in seen_source:
                raise ValueError(f"Duplicate source bucket mapping: {entry.source_bucket}")
            seen_source.add(entry.source_bucket)
        return self


class BucketMigrationItemView(BaseModel):
    id: int
    source_bucket: str
    target_bucket: str
    status: BucketMigrationItemStatus
    step: str
    pre_sync_done: bool = False
    read_only_applied: bool = False
    target_lock_applied: bool = False
    target_bucket_exists: bool = False

    objects_copied: int = 0
    objects_deleted: int = 0

    source_count: Optional[int] = None
    target_count: Optional[int] = None
    matched_count: Optional[int] = None
    different_count: Optional[int] = None
    only_source_count: Optional[int] = None
    only_target_count: Optional[int] = None
    diff_sample: Optional[dict] = None

    error_message: Optional[str] = None
    started_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime


class BucketMigrationEventView(BaseModel):
    id: int
    item_id: Optional[int] = None
    level: str
    message: str
    metadata: Optional[dict] = None
    created_at: datetime


class BucketMigrationView(BaseModel):
    id: int
    created_by_user_id: Optional[int] = None

    source_context_id: str
    target_context_id: str
    mode: BucketMigrationMode
    copy_bucket_settings: bool
    delete_source: bool
    lock_target_writes: bool
    auto_grant_source_read_for_copy: bool = True
    webhook_url: Optional[str] = None
    mapping_prefix: Optional[str] = None

    status: BucketMigrationStatus
    pause_requested: bool = False
    cancel_requested: bool = False
    precheck_status: BucketMigrationPrecheckStatus = "pending"
    precheck_report: Optional[dict] = None
    precheck_checked_at: Optional[datetime] = None

    parallelism_max: int

    total_items: int = 0
    completed_items: int = 0
    failed_items: int = 0
    skipped_items: int = 0
    awaiting_items: int = 0

    error_message: Optional[str] = None

    started_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None
    last_heartbeat_at: Optional[datetime] = None

    created_at: datetime
    updated_at: datetime


class BucketMigrationDetail(BucketMigrationView):
    items: list[BucketMigrationItemView] = Field(default_factory=list)
    recent_events: list[BucketMigrationEventView] = Field(default_factory=list)


class BucketMigrationListResponse(BaseModel):
    items: list[BucketMigrationView] = Field(default_factory=list)


class BucketMigrationActionResponse(BaseModel):
    id: int
    status: BucketMigrationStatus
    message: str
