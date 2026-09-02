# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from datetime import datetime
from typing import Any, Literal, Optional

from pydantic import Field, model_validator

from app.models.base import ApiModel


BucketCompareConfigFeature = Literal[
    "versioning_status",
    "object_lock",
    "public_access_block",
    "lifecycle_rules",
    "cors_rules",
    "bucket_policy",
    "access_logging",
    "tags",
]


class BucketCompareRequestBase(ApiModel):
    source_bucket: str
    target_bucket: str
    include_content: bool = True
    include_config: bool = False
    config_features: Optional[list[BucketCompareConfigFeature]] = None
    ignore_modified_after: Optional[datetime] = None

    @model_validator(mode="after")
    def validate_comparison_scope(self):
        self.source_bucket = (self.source_bucket or "").strip()
        self.target_bucket = (self.target_bucket or "").strip()
        if not self.source_bucket:
            raise ValueError("source_bucket is required.")
        if not self.target_bucket:
            raise ValueError("target_bucket is required.")
        if not self.include_content and not self.include_config:
            raise ValueError("At least one comparison scope must be enabled.")
        if self.config_features is not None:
            self.config_features = list(dict.fromkeys(self.config_features))
            if self.include_config and not self.config_features:
                raise ValueError(
                    "At least one config feature must be enabled when include_config is true."
                )
        return self


class BucketObjectDetail(ApiModel):
    key: str
    size: Optional[int] = None
    etag: Optional[str] = None
    last_modified: Optional[datetime] = None
    storage_class: Optional[str] = None


class BucketObjectDiffEntry(ApiModel):
    key: str
    source_size: Optional[int] = None
    target_size: Optional[int] = None
    source_etag: Optional[str] = None
    target_etag: Optional[str] = None
    source_last_modified: Optional[datetime] = None
    target_last_modified: Optional[datetime] = None
    source_storage_class: Optional[str] = None
    target_storage_class: Optional[str] = None
    compare_by: Literal["md5", "size"]


class BucketContentDiff(ApiModel):
    source_count: int = 0
    target_count: int = 0
    matched_count: int = 0
    different_count: int = 0
    only_source_count: int = 0
    only_target_count: int = 0
    ignored_after_cutoff_count: int = 0
    display_limit: int = 0
    only_source_hidden_count: int = 0
    only_target_hidden_count: int = 0
    different_hidden_count: int = 0
    only_source_sample: list[str] = Field(default_factory=list)
    only_target_sample: list[str] = Field(default_factory=list)
    only_source_details: list[BucketObjectDetail] = Field(default_factory=list)
    only_target_details: list[BucketObjectDetail] = Field(default_factory=list)
    different_sample: list[BucketObjectDiffEntry] = Field(default_factory=list)


class BucketConfigDiffSection(ApiModel):
    key: str
    label: str
    source: Any = None
    target: Any = None
    changed: bool = False


class BucketConfigDiff(ApiModel):
    changed: bool = False
    sections: list[BucketConfigDiffSection] = Field(default_factory=list)
