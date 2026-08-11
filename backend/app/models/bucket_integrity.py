# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional

from pydantic import Field

from app.models.base import ApiModel
from app.models.bucket_operation import (
    BucketOperationTarget,
    ExclusiveBucketOperationRequest,
)


BucketIntegrityStatus = Literal["passed", "completed_with_errors", "failed", "canceled"]
BucketIntegrityCheckMode = Literal["head", "get"]
BucketIntegrityFailureStage = Literal["list", "head", "get"]


class BucketIntegrityTarget(BucketOperationTarget):
    pass


class BucketIntegrityCheckRequest(ExclusiveBucketOperationRequest):
    targets: list[BucketIntegrityTarget] = Field(default_factory=list, max_length=200)
    parallelism: int = Field(default=10, ge=1, le=64)
    all_versions: bool = False
    check_mode: BucketIntegrityCheckMode = "head"
    since: Optional[datetime] = None
    max_mb_per_object: Optional[float] = Field(default=None, gt=0, le=10240)

class BucketIntegrityFailure(ApiModel):
    bucket_name: str
    stage: BucketIntegrityFailureStage
    message: str
    key: Optional[str] = None
    version_id: Optional[str] = None


class BucketIntegrityBucketResult(ApiModel):
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


class BucketIntegrityCheckProgress(ApiModel):
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


class BucketIntegrityCheckResult(ApiModel):
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
