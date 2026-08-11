# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import Field, model_validator

from app.models.base import ApiModel


BucketConfigBackupFeature = Literal[
    "quota",
    "versioning",
    "object_lock",
    "public_access_block",
    "lifecycle",
    "cors",
    "policy",
    "access_logging",
    "tags",
]


class BucketConfigBackupRequest(ApiModel):
    buckets: list[str] = Field(..., min_length=1)
    features: list[BucketConfigBackupFeature] = Field(..., min_length=1)

    @model_validator(mode="after")
    def normalize_values(self) -> "BucketConfigBackupRequest":
        bucket_names: list[str] = []
        seen_buckets: set[str] = set()
        for raw_name in self.buckets:
            normalized = (raw_name or "").strip()
            if not normalized:
                continue
            key = normalized.lower()
            if key in seen_buckets:
                continue
            seen_buckets.add(key)
            bucket_names.append(normalized)
        if not bucket_names:
            raise ValueError("At least one bucket name is required.")

        features: list[BucketConfigBackupFeature] = []
        seen_features: set[str] = set()
        for feature in self.features:
            if feature in seen_features:
                continue
            seen_features.add(feature)
            features.append(feature)
        if not features:
            raise ValueError("At least one backup feature is required.")

        self.buckets = bucket_names
        self.features = features
        return self


class BucketConfigBackupSource(ApiModel):
    surface: str
    endpoint_id: int | None = None
    endpoint_name: str | None = None


class BucketConfigBackupBucket(ApiModel):
    name: str
    configuration: dict[str, Any] = Field(default_factory=dict)
    errors: dict[str, str] = Field(default_factory=dict)


class BucketConfigBackupResponse(ApiModel):
    kind: str = "ceph-admin.bucket-config-backup"
    version: int = 1
    generated_at: datetime
    source: BucketConfigBackupSource
    features: list[BucketConfigBackupFeature]
    buckets: list[BucketConfigBackupBucket] = Field(default_factory=list)
