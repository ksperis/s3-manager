# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime, timedelta
from enum import Enum
from typing import Literal, Optional

from app.core.config import get_settings
from app.db import HealthCheckStatus

settings = get_settings()


class HealthWindow(str, Enum):
    DAY = "day"
    WEEK = "week"
    MONTH = "month"
    QUARTER = "quarter"
    HALF_YEAR = "half_year"
    YEAR = "year"


WINDOW_DELTAS: dict[HealthWindow, timedelta] = {
    HealthWindow.DAY: timedelta(days=1),
    HealthWindow.WEEK: timedelta(days=7),
    HealthWindow.MONTH: timedelta(days=30),
    HealthWindow.QUARTER: timedelta(days=90),
    HealthWindow.HALF_YEAR: timedelta(days=182),
    HealthWindow.YEAR: timedelta(days=365),
}

DEFAULT_CHECK_TYPE = "availability"
DEFAULT_SCOPE = "endpoint"
DEFAULT_ROLLUP_RESOLUTION_SECONDS = 300


@dataclass(frozen=True)
class HealthCheckProfile:
    mode: Literal["http", "s3"]
    target_url: str


@dataclass(frozen=True)
class EndpointCheckTarget:
    endpoint_id: int
    name: str
    endpoint_url: str
    force_path_style: bool
    verify_tls: bool
    region: Optional[str]
    supervision_access_key: Optional[str]
    supervision_secret_key: Optional[str]
    admin_access_key: Optional[str]
    admin_secret_key: Optional[str]


@dataclass
class HealthCheckResult:
    endpoint_id: int
    status: HealthCheckStatus
    checked_at: datetime
    latency_ms: Optional[int]
    http_status: Optional[int]
    error_message: Optional[str]
    check_mode: Literal["http", "s3"]


def _percentile(values: list[int], percentile: float) -> Optional[int]:
    if not values:
        return None
    sorted_values = sorted(values)
    if len(sorted_values) == 1:
        return sorted_values[0]
    k = (len(sorted_values) - 1) * percentile
    f = math.floor(k)
    c = math.ceil(k)
    if f == c:
        return sorted_values[int(k)]
    d0 = sorted_values[f] * (c - k)
    d1 = sorted_values[c] * (k - f)
    return int(round(d0 + d1))


def _compute_status(
    http_status: Optional[int],
    latency_ms: Optional[int],
    error_message: Optional[str],
) -> HealthCheckStatus:
    if error_message:
        return HealthCheckStatus.DOWN
    if http_status is None:
        return HealthCheckStatus.DOWN
    if http_status >= 500:
        return HealthCheckStatus.DEGRADED
    degraded_threshold = settings.healthcheck_degraded_latency_ms
    if degraded_threshold and latency_ms is not None and latency_ms >= degraded_threshold:
        return HealthCheckStatus.DEGRADED
    return HealthCheckStatus.UP


def _coerce_check_mode(value: object) -> Literal["http", "s3"]:
    return "s3" if str(value or "").strip().lower() == "s3" else "http"

