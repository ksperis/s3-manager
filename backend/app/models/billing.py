# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Optional

from pydantic import Field

from app.models.base import ApiModel


class BillingCoverage(ApiModel):
    days_collected: int
    days_in_month: int
    coverage_ratio: float = Field(..., ge=0, le=1)
    storage_days_collected: Optional[int] = None
    usage_days_collected: Optional[int] = None


class BillingCost(ApiModel):
    currency: Optional[str] = None
    storage_cost: Optional[float] = None
    egress_cost: Optional[float] = None
    ingress_cost: Optional[float] = None
    requests_cost: Optional[float] = None
    total_cost: Optional[float] = None
    rate_card_name: Optional[str] = None


class BillingUsageTotals(ApiModel):
    bytes_in: int = 0
    bytes_out: int = 0
    ops_total: int = 0
    ops_breakdown: Optional[dict[str, int]] = None


class BillingStorageTotals(ApiModel):
    avg_bytes: Optional[int] = None
    avg_gb_month: Optional[float] = None
    total_objects: Optional[int] = None


class BillingSummary(ApiModel):
    month: str
    storage_endpoint_id: Optional[int] = None
    usage: BillingUsageTotals
    storage: BillingStorageTotals
    coverage: BillingCoverage
    cost: Optional[BillingCost] = None


class BillingSubjectSummary(ApiModel):
    subject_type: str
    subject_id: int
    name: str
    rgw_identifier: Optional[str] = None
    storage: BillingStorageTotals
    usage: BillingUsageTotals
    cost: Optional[BillingCost] = None


class BillingSubjectsResponse(ApiModel):
    items: list[BillingSubjectSummary]
    total: int
    page: int
    page_size: int
    has_next: bool


class BillingDailySeriesPoint(ApiModel):
    day: str
    storage_bytes: Optional[int] = None
    bytes_in: Optional[int] = None
    bytes_out: Optional[int] = None
    ops_total: Optional[int] = None


class BillingSubjectDetail(ApiModel):
    month: str
    subject_type: str
    subject_id: int
    name: str
    rgw_identifier: Optional[str] = None
    daily: list[BillingDailySeriesPoint]
    usage: BillingUsageTotals
    storage: BillingStorageTotals
    coverage: BillingCoverage
    cost: Optional[BillingCost] = None
