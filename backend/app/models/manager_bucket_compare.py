# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from typing import Literal, Optional

from pydantic import BaseModel, Field, model_validator

from app.models.ceph_admin import (
    BucketCompareConfigFeature,
    CephAdminBucketConfigDiff,
    CephAdminBucketContentDiff,
)


class ManagerBucketCompareRequest(BaseModel):
    target_context_id: str
    source_bucket: str
    target_bucket: str
    include_content: bool = True
    include_config: bool = False
    config_features: Optional[list[BucketCompareConfigFeature]] = None
    size_only: bool = False
    diff_sample_limit: int = Field(default=200, ge=1, le=2000)

    @model_validator(mode="after")
    def validate_names(self):
        self.target_context_id = (self.target_context_id or "").strip()
        self.source_bucket = (self.source_bucket or "").strip()
        self.target_bucket = (self.target_bucket or "").strip()
        if not self.target_context_id:
            raise ValueError("target_context_id is required.")
        if not self.source_bucket:
            raise ValueError("source_bucket is required.")
        if not self.target_bucket:
            raise ValueError("target_bucket is required.")
        if not self.include_content and not self.include_config:
            raise ValueError("At least one comparison scope must be enabled.")
        if self.config_features is not None:
            self.config_features = list(dict.fromkeys(self.config_features))
            if self.include_config and len(self.config_features) == 0:
                raise ValueError("At least one config feature must be enabled when include_config is true.")
        return self


class ManagerBucketCompareResult(BaseModel):
    source_context_id: str
    target_context_id: str
    source_bucket: str
    target_bucket: str
    compare_mode: Optional[Literal["size_only", "md5_or_size"]] = None
    has_differences: bool = False
    content_diff: Optional[CephAdminBucketContentDiff] = None
    config_diff: Optional[CephAdminBucketConfigDiff] = None
