# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional

from pydantic import Field

from app.models.base import ApiModel
from app.models.bucket_operation import (
    BucketOperationRequest,
    BucketOperationTarget,
)


BucketPurgeStatus = Literal["completed", "completed_with_errors", "failed", "canceled"]
BucketPurgeStage = Literal["prepare", "list", "delete", "versions", "delete_bucket", "completed"]


class BucketPurgeRequest(BucketOperationRequest):
    targets: list[BucketOperationTarget] = Field(default_factory=list, max_length=200)
    parallelism: int = Field(default=10, ge=1, le=64)
    include_versions: bool = True
    confirmation: str = ""

def bucket_purge_confirmation_phrase(target_count: int) -> str:
    return f"PURGE {target_count} BUCKETS"


class BucketDeleteWithPurgeRequest(ApiModel):
    parallelism: int = Field(default=10, ge=1, le=64)
    confirmation: str = ""


def bucket_delete_with_purge_confirmation_phrase(bucket_name: str) -> str:
    return f"DELETE BUCKET {bucket_name}"


class BucketPurgeFailure(ApiModel):
    bucket_name: str
    stage: str
    message: str
    key: Optional[str] = None
    version_id: Optional[str] = None
    count: int = 0


class BucketPurgeBucketResult(ApiModel):
    bucket_name: str
    context_id: Optional[str] = None
    context_name: Optional[str] = None
    status: BucketPurgeStatus
    listed_objects: int = 0
    listed_versions: int = 0
    deleted_objects: int = 0
    deleted_versions: int = 0
    failed_count: int = 0
    bucket_deleted: bool = False
    duration_seconds: float = 0
    failures_sample: list[BucketPurgeFailure] = Field(default_factory=list)


class BucketPurgeProgress(ApiModel):
    request_id: Optional[str] = None
    stage: BucketPurgeStage = "prepare"
    bucket_name: Optional[str] = None
    context_id: Optional[str] = None
    context_name: Optional[str] = None
    total_buckets: int = 0
    completed_buckets: int = 0
    listed_objects: int = 0
    listed_versions: int = 0
    deleted_objects: int = 0
    deleted_versions: int = 0
    total_entries_estimate: Optional[int] = None
    total_entries_final: bool = False
    failed_count: int = 0
    bucket_deleted: bool = False
    message: Optional[str] = None


class BucketPurgeResult(ApiModel):
    status: BucketPurgeStatus
    total_buckets: int = 0
    completed_buckets: int = 0
    listed_objects: int = 0
    listed_versions: int = 0
    deleted_objects: int = 0
    deleted_versions: int = 0
    failed_count: int = 0
    bucket_deleted: bool = False
    started_at: datetime
    finished_at: datetime
    buckets: list[BucketPurgeBucketResult] = Field(default_factory=list)
