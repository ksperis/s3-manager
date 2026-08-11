# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Literal, Optional

from app.models.base import ApiModel


UsageTrendWindow = Literal["month", "week", "day"]


class ManagerUsageTrendBaseline(ApiModel):
    window: UsageTrendWindow
    label: str
    period_start: str
    used_bytes: Optional[int] = None
    used_objects: Optional[int] = None
    bucket_count: Optional[int] = None
    collected_at: Optional[str] = None


class ManagerUsageTrendsResponse(ApiModel):
    storage: Optional[ManagerUsageTrendBaseline] = None
    objects: Optional[ManagerUsageTrendBaseline] = None
    buckets: Optional[ManagerUsageTrendBaseline] = None
