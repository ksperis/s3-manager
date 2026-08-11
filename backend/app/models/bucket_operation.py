# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from __future__ import annotations

from typing import TypeVar

from pydantic import Field, model_validator

from app.models.base import ApiModel


class BucketOperationTarget(ApiModel):
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


_TargetT = TypeVar("_TargetT", bound=BucketOperationTarget)


def normalize_bucket_names(bucket_names: list[str]) -> list[str]:
    return list(
        dict.fromkeys(
            bucket_name.strip()
            for bucket_name in bucket_names
            if bucket_name and bucket_name.strip()
        )
    )


def deduplicate_bucket_targets(targets: list[_TargetT]) -> list[_TargetT]:
    deduplicated: list[_TargetT] = []
    seen: set[tuple[str, str]] = set()
    for target in targets:
        key = (target.context_id, target.bucket_name)
        if key in seen:
            continue
        seen.add(key)
        deduplicated.append(target)
    return deduplicated


class BucketOperationRequest(ApiModel):
    buckets: list[str] = Field(default_factory=list, max_length=200)
    targets: list[BucketOperationTarget] = Field(default_factory=list, max_length=200)

    @model_validator(mode="after")
    def normalize_targets(self):
        self.buckets = normalize_bucket_names(self.buckets)
        self.targets = deduplicate_bucket_targets(self.targets)
        return self


class ExclusiveBucketOperationRequest(BucketOperationRequest):
    @model_validator(mode="after")
    def require_one_target_source(self):
        if bool(self.buckets) == bool(self.targets):
            raise ValueError("Provide exactly one of buckets or targets.")
        return self
