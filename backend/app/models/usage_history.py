# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field


UsageHistoryGranularity = Literal["daily", "hourly"]
UsageHistorySubjectType = Literal["all", "account", "s3_user"]


class UsageHistorySummary(BaseModel):
    total_records: int = 0
    subjects_count: int = 0
    latest_collected_at: Optional[str] = None
    max_usage_ratio_pct: Optional[float] = None


class UsageHistoryRecord(BaseModel):
    id: int
    granularity: UsageHistoryGranularity
    period_start: str
    storage_endpoint_id: int
    endpoint_name: str
    subject_type: Literal["account", "s3_user"]
    subject_id: int
    subject_name: str
    subject_identifier: Optional[str] = None
    used_bytes: int = 0
    used_objects: int = 0
    quota_size_bytes: Optional[int] = None
    quota_objects: Optional[int] = None
    usage_ratio_pct: Optional[float] = None
    samples_count: Optional[int] = None
    collected_at: str


class UsageHistoryResponse(BaseModel):
    items: list[UsageHistoryRecord] = Field(default_factory=list)
    total: int = 0
    page: int = 1
    page_size: int = 50
    has_next: bool = False
    summary: UsageHistorySummary = Field(default_factory=UsageHistorySummary)
