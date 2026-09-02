# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import Field

from app.models.base import ApiModel
from app.models.bucket import BucketFeatureStatus, BucketTag
from app.models.bucket_ui_tags import BucketUiTagDefinitionSummary


class BucketListingSummary(ApiModel):
    name: str
    tenant: Optional[str] = None
    # Internal listing state: an explicit empty RGW tenant means the global
    # namespace, while a missing tenant still requires metadata backfill.
    tenant_metadata_resolved: bool = Field(default=False, exclude=True, repr=False)
    owner: Optional[str] = None
    owner_name: Optional[str] = None
    owner_suspended: Optional[bool] = None
    used_bytes: Optional[int] = None
    object_count: Optional[int] = None
    quota_max_size_bytes: Optional[int] = None
    quota_max_objects: Optional[int] = None
    owner_used_bytes: Optional[int] = None
    owner_object_count: Optional[int] = None
    owner_quota_max_size_bytes: Optional[int] = None
    owner_quota_max_objects: Optional[int] = None
    tags: Optional[list[BucketTag]] = None
    features: Optional[dict[str, BucketFeatureStatus]] = None
    column_details: Optional[dict[str, Any]] = None
    ui_tags: list[BucketUiTagDefinitionSummary] = Field(default_factory=list)


class BucketListingRequest(ApiModel):
    page: int = Field(default=1, ge=1)
    page_size: int = Field(default=25, ge=1, le=200)
    filter: Optional[str] = None
    advanced_filter: Optional[str] = None
    sort_by: str = "name"
    sort_dir: Literal["asc", "desc"] = "asc"
    include: list[str] = Field(default_factory=list)
    with_stats: bool = True
    ui_tag_ids: list[int] = Field(default_factory=list)
    ui_tag_match: Literal["any", "all"] = "any"
