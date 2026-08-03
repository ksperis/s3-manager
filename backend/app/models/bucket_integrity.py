# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field, model_validator

from app.models.bucket_operation import (
    BucketOperationTarget,
    deduplicate_bucket_targets,
    normalize_bucket_names,
)


BucketIntegrityStatus = Literal["passed", "completed_with_errors", "failed", "canceled"]
BucketIntegrityCheckMode = Literal["head", "get"]
BucketIntegrityFailureStage = Literal["list", "head", "get"]


class BucketIntegrityTarget(BucketOperationTarget):
    pass


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
        self.buckets = normalize_bucket_names(self.buckets)
        self.targets = deduplicate_bucket_targets(self.targets)
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
