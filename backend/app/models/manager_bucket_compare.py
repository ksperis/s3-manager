# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from typing import Literal, Optional

from pydantic import Field, model_validator

from app.models.base import ApiModel
from app.models.bucket_compare import (
    BucketCompareRequestBase,
    BucketConfigDiff,
    BucketContentDiff,
)

ManagerBucketCompareAction = Literal["sync_source_only", "sync_different", "delete_target_only"]


class ManagerBucketCompareRequest(BucketCompareRequestBase):
    target_context_id: str

    @model_validator(mode="after")
    def validate_target_context(self):
        self.target_context_id = (self.target_context_id or "").strip()
        if not self.target_context_id:
            raise ValueError("target_context_id is required.")
        return self


class ManagerBucketCompareResult(ApiModel):
    source_context_id: str
    target_context_id: str
    source_bucket: str
    target_bucket: str
    has_differences: bool = False
    content_diff: Optional[BucketContentDiff] = None
    config_diff: Optional[BucketConfigDiff] = None


class ManagerBucketCompareActionRequest(ApiModel):
    target_context_id: str
    source_bucket: str
    target_bucket: str
    action: ManagerBucketCompareAction
    object_keys: list[str] = Field(..., min_length=1)
    parallelism: int = Field(default=4, ge=1, le=32)

    @model_validator(mode="after")
    def validate_names(self):
        self.target_context_id = (self.target_context_id or "").strip()
        self.source_bucket = (self.source_bucket or "").strip()
        self.target_bucket = (self.target_bucket or "").strip()
        normalized_keys: list[str] = []
        seen_keys: set[str] = set()
        for raw_key in self.object_keys:
            key = (raw_key or "").strip()
            if not key:
                raise ValueError("object_keys cannot contain blank keys.")
            if key in seen_keys:
                raise ValueError("object_keys cannot contain duplicate keys.")
            seen_keys.add(key)
            normalized_keys.append(key)
        self.object_keys = normalized_keys
        if not self.target_context_id:
            raise ValueError("target_context_id is required.")
        if not self.source_bucket:
            raise ValueError("source_bucket is required.")
        if not self.target_bucket:
            raise ValueError("target_bucket is required.")
        return self


class ManagerBucketCompareActionResult(ApiModel):
    action: ManagerBucketCompareAction
    source_context_id: str
    target_context_id: str
    source_bucket: str
    target_bucket: str
    planned_count: int = 0
    succeeded_count: int = 0
    failed_count: int = 0
    failed_keys_sample: list[str] = Field(default_factory=list)
    message: str
