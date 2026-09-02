# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Portal usage and storage-statistics API contracts."""

from datetime import datetime
from typing import Optional

from pydantic import Field

from app.models.base import ApiModel
from app.models.bucket_usage_stats import BucketUsageStatsDistributionEntry, BucketUsageStatsScanMode


class PortalUsageStorageSpace(ApiModel):
    id: str
    name: str
    used_bytes: Optional[int] = None
    object_count: Optional[int] = None
    quota_max_size_bytes: Optional[int] = None
    quota_max_objects: Optional[int] = None


class PortalUsage(ApiModel):
    used_bytes: Optional[int] = None
    used_objects: Optional[int] = None
    quota_max_size_bytes: Optional[int] = None
    quota_max_objects: Optional[int] = None
    max_buckets: Optional[int] = None
    storage_spaces: list[PortalUsageStorageSpace] = Field(default_factory=list)
    other_storage_space: Optional[PortalUsageStorageSpace] = None


class PortalStorageSpaceUsageStatsSnapshot(ApiModel):
    scan_mode: BucketUsageStatsScanMode
    version_listing_available: bool = True
    object_version_count: int = 0
    current_version_count: int = 0
    noncurrent_version_count: int = 0
    delete_marker_count: int = 0
    total_bytes: int = 0
    current_bytes: int = 0
    noncurrent_bytes: int = 0
    data_type_distribution: list[BucketUsageStatsDistributionEntry] = Field(default_factory=list)
    storage_class_distribution: list[BucketUsageStatsDistributionEntry] = Field(default_factory=list)
    size_distribution: list[BucketUsageStatsDistributionEntry] = Field(default_factory=list)
    age_distribution: list[BucketUsageStatsDistributionEntry] = Field(default_factory=list)
    current_vs_noncurrent: list[BucketUsageStatsDistributionEntry] = Field(default_factory=list)
    calculated_at: datetime


class PortalStorageSpaceUsageStatsResponse(ApiModel):
    snapshot: Optional[PortalStorageSpaceUsageStatsSnapshot] = None
