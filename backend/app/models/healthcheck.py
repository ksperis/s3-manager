# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Optional

from pydantic import BaseModel

from app.db import HealthCheckStatus


class EndpointHealthSummary(BaseModel):
    endpoint_id: int
    name: str
    endpoint_url: str
    status: HealthCheckStatus
    checked_at: str
    latency_ms: Optional[int] = None
    http_status: Optional[int] = None
    error_message: Optional[str] = None


class EndpointHealthSummaryResponse(BaseModel):
    generated_at: str
    endpoints: list[EndpointHealthSummary]


class EndpointHealthPoint(BaseModel):
    timestamp: str
    status: HealthCheckStatus
    latency_ms: Optional[int] = None
    http_status: Optional[int] = None


class EndpointHealthDailyPoint(BaseModel):
    day: str
    ok_count: int = 0
    degraded_count: int = 0
    down_count: int = 0
    avg_latency_ms: Optional[int] = None
    p95_latency_ms: Optional[int] = None


class EndpointHealthSeries(BaseModel):
    endpoint_id: int
    window: str
    start: str
    end: str
    data_points: int
    series: list[EndpointHealthPoint]
    daily: list[EndpointHealthDailyPoint]


class EndpointHealthIncident(BaseModel):
    start: str
    end: Optional[str] = None
    duration_minutes: Optional[int] = None
    status: HealthCheckStatus


class EndpointHealthIncidentsResponse(BaseModel):
    endpoint_id: int
    window: str
    incidents: list[EndpointHealthIncident]
