# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field, model_validator


BucketUsageStatsStatus = Literal["completed", "completed_with_warnings", "failed", "canceled"]
BucketUsageStatsScanMode = Literal["versions", "current_only"]


class BucketUsageStatsTarget(BaseModel):
    context_id: str
    bucket_name: str

    @model_validator(mode="after")
    def validate_target(self):
        self.context_id = (self.context_id or "").strip()
        self.bucket_name = (self.bucket_name or "").strip()
        if not self.context_id:
            raise ValueError("context_id is required.")
        if not self.bucket_name:
            raise ValueError("bucket_name is required.")
        return self


class BucketUsageStatsRequest(BaseModel):
    buckets: list[str] = Field(default_factory=list, max_length=200)
    targets: list[BucketUsageStatsTarget] = Field(default_factory=list, max_length=200)
    parallelism: int = Field(default=8, ge=1, le=32)

    @model_validator(mode="after")
    def validate_request(self):
        self.buckets = list(dict.fromkeys(bucket.strip() for bucket in self.buckets if bucket and bucket.strip()))
        deduped_targets: list[BucketUsageStatsTarget] = []
        seen_targets: set[tuple[str, str]] = set()
        for target in self.targets:
            key = (target.context_id, target.bucket_name)
            if key in seen_targets:
                continue
            seen_targets.add(key)
            deduped_targets.append(target)
        self.targets = deduped_targets
        if bool(self.buckets) == bool(self.targets):
            raise ValueError("Provide exactly one of buckets or targets.")
        return self


class BucketUsageStatsDistributionEntry(BaseModel):
    key: str
    label: str
    count: int = 0
    bytes: int = 0
    ratio_count: float = 0
    ratio_bytes: float = 0


class BucketUsageStatsSnapshot(BaseModel):
    scope_kind: str
    scope_id: str
    scope_name: Optional[str] = None
    bucket_name: str
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
    warnings: list[str] = Field(default_factory=list)
    calculated_at: datetime


class BucketUsageStatsLatestResponse(BaseModel):
    snapshot: Optional[BucketUsageStatsSnapshot] = None


class BucketUsageStatsAggregate(BaseModel):
    scope_kind: str
    scope_id: str
    scope_name: Optional[str] = None
    managed_account_count: Optional[int] = None
    accounts_with_listed_buckets: Optional[int] = None
    skipped_account_count: Optional[int] = None
    bucket_count: int = 0
    buckets_with_snapshot: int = 0
    missing_bucket_count: int = 0
    partial_scan_count: int = 0
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
    warnings: list[str] = Field(default_factory=list)
    oldest_snapshot_at: Optional[datetime] = None
    newest_snapshot_at: Optional[datetime] = None


class BucketUsageStatsAggregateResponse(BaseModel):
    aggregate: BucketUsageStatsAggregate


class BucketUsageStatsScopeRequest(BaseModel):
    parallelism: int = Field(default=8, ge=1, le=32)


class BucketUsageStatsBucketResult(BaseModel):
    bucket_name: str
    context_id: Optional[str] = None
    context_name: Optional[str] = None
    status: BucketUsageStatsStatus
    snapshot: Optional[BucketUsageStatsSnapshot] = None
    duration_seconds: float = 0
    message: Optional[str] = None


class BucketUsageStatsProgress(BaseModel):
    request_id: Optional[str] = None
    stage: Literal["prepare", "list", "persist", "completed"] = "prepare"
    bucket_name: Optional[str] = None
    context_id: Optional[str] = None
    context_name: Optional[str] = None
    total_buckets: int = 0
    completed_buckets: int = 0
    listed_versions: int = 0
    listed_delete_markers: int = 0
    total_bytes: int = 0
    message: Optional[str] = None


class BucketUsageStatsResult(BaseModel):
    status: BucketUsageStatsStatus
    total_buckets: int = 0
    completed_buckets: int = 0
    failed_buckets: int = 0
    listed_versions: int = 0
    listed_delete_markers: int = 0
    total_bytes: int = 0
    started_at: datetime
    finished_at: datetime
    buckets: list[BucketUsageStatsBucketResult] = Field(default_factory=list)
