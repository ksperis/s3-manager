# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Optional

from pydantic import Field

from app.models.base import ApiModel
from app.db import HealthCheckStatus


class EndpointHealthSummary(ApiModel):
    endpoint_id: int
    name: str
    endpoint_url: str
    status: HealthCheckStatus
    checked_at: str
    latency_ms: Optional[int] = None
    http_status: Optional[int] = None
    error_message: Optional[str] = None
    check_mode: str = "http"
    check_target_url: Optional[str] = None


class EndpointHealthSummaryResponse(ApiModel):
    generated_at: str
    endpoints: list[EndpointHealthSummary]


class EndpointHealthPoint(ApiModel):
    timestamp: str
    status: HealthCheckStatus
    latency_ms: Optional[int] = None
    http_status: Optional[int] = None
    check_mode: str = "http"
    check_type: str = "availability"
    scope: str = "endpoint"


class EndpointHealthDailyPoint(ApiModel):
    day: str
    ok_count: int = 0
    degraded_count: int = 0
    down_count: int = 0
    avg_latency_ms: Optional[int] = None
    p95_latency_ms: Optional[int] = None


class EndpointHealthSeries(ApiModel):
    endpoint_id: int
    window: str
    start: str
    end: str
    data_points: int
    check_mode: str = "http"
    check_target_url: Optional[str] = None
    check_type: str = "availability"
    scope: str = "endpoint"
    resolution_seconds: int = 300
    series: list[EndpointHealthPoint]
    daily: list[EndpointHealthDailyPoint]


class EndpointHealthIncident(ApiModel):
    start: str
    end: Optional[str] = None
    duration_minutes: Optional[int] = None
    status: HealthCheckStatus
    check_mode: str = "http"
    check_type: str = "availability"
    scope: str = "endpoint"


class EndpointHealthIncidentsResponse(ApiModel):
    endpoint_id: int
    window: str
    check_mode: str = "http"
    check_type: str = "availability"
    scope: str = "endpoint"
    incidents: list[EndpointHealthIncident]


class EndpointHealthRawCheck(ApiModel):
    checked_at: str
    status: HealthCheckStatus
    latency_ms: Optional[int] = None
    http_status: Optional[int] = None
    error_message: Optional[str] = None
    check_mode: str = "http"


class EndpointHealthRawChecksResponse(ApiModel):
    endpoint_id: int
    window: str
    start: str
    end: str
    page: int
    page_size: int
    total: int
    checks: list[EndpointHealthRawCheck]


class EndpointHealthTimelinePoint(ApiModel):
    timestamp: str
    end_timestamp: Optional[str] = None
    status: HealthCheckStatus
    latency_ms: Optional[int] = None
    reason: Optional[str] = None


class EndpointHealthOverviewEndpoint(ApiModel):
    endpoint_id: int
    name: str
    endpoint_url: str
    status: HealthCheckStatus
    checked_at: str
    latency_ms: Optional[int] = None
    check_mode: str = "http"
    check_target_url: Optional[str] = None
    availability_pct: Optional[float] = None
    baseline_latency_ms: Optional[int] = None
    timeline: list[EndpointHealthTimelinePoint] = Field(default_factory=list)


class EndpointHealthOverviewResponse(ApiModel):
    generated_at: str
    window: str
    start: str
    end: str
    endpoints: list[EndpointHealthOverviewEndpoint]


class EndpointHealthLatencyOverviewEndpoint(ApiModel):
    endpoint_id: int
    name: str
    endpoint_url: str
    status: HealthCheckStatus
    checked_at: str
    latency_ms: Optional[int] = None
    check_mode: str = "http"
    check_target_url: Optional[str] = None
    min_latency_ms: Optional[int] = None
    avg_latency_ms: Optional[int] = None
    max_latency_ms: Optional[int] = None
    sample_count: int = 0
    check_type: str = "availability"
    scope: str = "endpoint"


class EndpointHealthLatencyOverviewResponse(ApiModel):
    generated_at: str
    window: str
    start: str
    end: str
    endpoints: list[EndpointHealthLatencyOverviewEndpoint]


class EndpointHealthGlobalIncident(ApiModel):
    endpoint_id: int
    endpoint_name: str
    endpoint_url: Optional[str] = None
    status: HealthCheckStatus
    start: str
    end: Optional[str] = None
    duration_minutes: Optional[int] = None
    check_mode: str = "http"
    check_type: str = "availability"
    scope: str = "endpoint"


class EndpointHealthGlobalIncidentsResponse(ApiModel):
    window: str
    start: str
    end: str
    total: int = 0
    incidents: list[EndpointHealthGlobalIncident]


class WorkspaceEndpointHealthEntry(ApiModel):
    endpoint_id: int
    name: str
    endpoint_url: str
    status: HealthCheckStatus
    checked_at: str
    latency_ms: Optional[int] = None
    check_mode: str = "http"
    check_target_url: Optional[str] = None
    is_stale: bool = False


class WorkspaceEndpointIncidentEntry(ApiModel):
    endpoint_id: int
    endpoint_name: str
    endpoint_url: Optional[str] = None
    status: HealthCheckStatus
    start: str
    end: Optional[str] = None
    duration_minutes: Optional[int] = None
    check_mode: str = "http"
    ongoing: bool = False
    recent: bool = False


class WorkspaceEndpointHealthOverviewResponse(ApiModel):
    generated_at: str
    stale_after_seconds: int
    incident_highlight_minutes: int
    endpoint_count: int
    up_count: int = 0
    degraded_count: int = 0
    down_count: int = 0
    unknown_count: int = 0
    endpoints: list[WorkspaceEndpointHealthEntry]
    incidents: list[WorkspaceEndpointIncidentEntry]
