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


BucketPurgeStatus = Literal["completed", "completed_with_errors", "failed", "canceled"]
BucketPurgeStage = Literal["prepare", "list", "delete", "versions", "delete_bucket", "completed"]


class BucketPurgeTarget(BucketOperationTarget):
    pass


class BucketPurgeRequest(BaseModel):
    buckets: list[str] = Field(default_factory=list, max_length=200)
    targets: list[BucketPurgeTarget] = Field(default_factory=list, max_length=200)
    parallelism: int = Field(default=10, ge=1, le=64)
    include_versions: bool = True
    confirmation: str = ""

    @model_validator(mode="after")
    def validate_request(self):
        self.buckets = normalize_bucket_names(self.buckets)
        self.targets = deduplicate_bucket_targets(self.targets)
        return self


def bucket_purge_confirmation_phrase(target_count: int) -> str:
    return f"PURGE {target_count} BUCKETS"


class BucketDeleteWithPurgeRequest(BaseModel):
    parallelism: int = Field(default=10, ge=1, le=64)
    confirmation: str = ""


def bucket_delete_with_purge_confirmation_phrase(bucket_name: str) -> str:
    return f"DELETE BUCKET {bucket_name}"


class BucketPurgeFailure(BaseModel):
    bucket_name: str
    stage: str
    message: str
    key: Optional[str] = None
    version_id: Optional[str] = None
    count: int = 0


class BucketPurgeBucketResult(BaseModel):
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


class BucketPurgeProgress(BaseModel):
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


class BucketPurgeResult(BaseModel):
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
