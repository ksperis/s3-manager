# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field, model_validator


BucketIntegrityStatus = Literal["passed", "completed_with_errors", "failed", "canceled"]
BucketIntegrityCheckMode = Literal["head", "get"]
BucketIntegrityFailureStage = Literal["list", "head", "get"]


class BucketIntegrityTarget(BaseModel):
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


class BucketIntegrityCheckRequest(BaseModel):
    buckets: list[str] = Field(default_factory=list, max_length=200)
    targets: list[BucketIntegrityTarget] = Field(default_factory=list, max_length=200)
    parallelism: int = Field(default=10, ge=1, le=64)
    all_versions: bool = False
    check_mode: BucketIntegrityCheckMode = "head"
    since: Optional[datetime] = None
    max_mb_per_object: Optional[float] = Field(default=None, gt=0, le=10240)

    @model_validator(mode="after")
    def validate_request(self):
        self.buckets = list(dict.fromkeys(bucket.strip() for bucket in self.buckets if bucket and bucket.strip()))
        deduped_targets: list[BucketIntegrityTarget] = []
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


class BucketIntegrityFailure(BaseModel):
    bucket_name: str
    stage: BucketIntegrityFailureStage
    message: str
    key: Optional[str] = None
    version_id: Optional[str] = None


class BucketIntegrityBucketResult(BaseModel):
    bucket_name: str
    context_id: Optional[str] = None
    context_name: Optional[str] = None
    status: BucketIntegrityStatus
    listed_count: int = 0
    checked_count: int = 0
    failed_count: int = 0
    bytes_read: int = 0
    duration_seconds: float = 0
    failures_sample: list[BucketIntegrityFailure] = Field(default_factory=list)


class BucketIntegrityCheckProgress(BaseModel):
    request_id: Optional[str] = None
    stage: Literal["prepare", "list", "verify", "completed"] = "prepare"
    bucket_name: Optional[str] = None
    context_id: Optional[str] = None
    context_name: Optional[str] = None
    total_buckets: int = 0
    completed_buckets: int = 0
    listed_count: int = 0
    checked_count: int = 0
    failed_count: int = 0
    bytes_read: int = 0
    message: Optional[str] = None


class BucketIntegrityCheckResult(BaseModel):
    status: BucketIntegrityStatus
    total_buckets: int = 0
    completed_buckets: int = 0
    listed_count: int = 0
    checked_count: int = 0
    failed_count: int = 0
    bytes_read: int = 0
    started_at: datetime
    finished_at: datetime
    buckets: list[BucketIntegrityBucketResult] = Field(default_factory=list)
