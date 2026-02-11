# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import logging
import math
import time
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from enum import Enum
from typing import Optional

import requests
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db import EndpointHealthCheck, EndpointHealthDaily, HealthCheckStatus, StorageEndpoint
from app.services.app_settings_service import load_app_settings

logger = logging.getLogger(__name__)
settings = get_settings()


class HealthWindow(str, Enum):
    DAY = "day"
    WEEK = "week"
    MONTH = "month"
    QUARTER = "quarter"
    YEAR = "year"


WINDOW_DELTAS: dict[HealthWindow, timedelta] = {
    HealthWindow.DAY: timedelta(days=1),
    HealthWindow.WEEK: timedelta(days=7),
    HealthWindow.MONTH: timedelta(days=30),
    HealthWindow.QUARTER: timedelta(days=90),
    HealthWindow.YEAR: timedelta(days=365),
}


@dataclass
class HealthCheckResult:
    endpoint_id: int
    status: HealthCheckStatus
    checked_at: datetime
    latency_ms: Optional[int]
    http_status: Optional[int]
    error_message: Optional[str]


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


class HealthCheckService:
    def __init__(self, db: Session) -> None:
        self.db = db

    def run_checks(self) -> dict:
        app_settings = load_app_settings()
        if not app_settings.general.endpoint_status_enabled:
            raise ValueError("Endpoint Status feature is disabled")
        endpoints = (
            self.db.query(StorageEndpoint)
            .order_by(StorageEndpoint.is_default.desc(), StorageEndpoint.name.asc())
            .all()
        )
        now = datetime.utcnow()
        results: list[HealthCheckResult] = []
        for endpoint in endpoints:
            results.append(self._check_endpoint(endpoint, now))
        for result in results:
            self.db.add(
                EndpointHealthCheck(
                    storage_endpoint_id=result.endpoint_id,
                    checked_at=result.checked_at,
                    http_status=result.http_status,
                    latency_ms=result.latency_ms,
                    status=result.status.value,
                    error_message=result.error_message,
                )
            )
        self.db.commit()
        today = now.date()
        for endpoint in endpoints:
            self._update_daily_aggregate(endpoint.id, today)
        self._prune_history()
        return {
            "checked_at": now.isoformat(),
            "total": len(endpoints),
            "results": [
                {
                    "endpoint_id": result.endpoint_id,
                    "status": result.status.value,
                    "latency_ms": result.latency_ms,
                    "http_status": result.http_status,
                    "error_message": result.error_message,
                }
                for result in results
            ],
        }

    def build_summary(self) -> dict:
        endpoints = (
            self.db.query(StorageEndpoint)
            .order_by(StorageEndpoint.is_default.desc(), StorageEndpoint.name.asc())
            .all()
        )
        summaries: list[dict] = []
        for endpoint in endpoints:
            last = (
                self.db.query(EndpointHealthCheck)
                .filter(EndpointHealthCheck.storage_endpoint_id == endpoint.id)
                .order_by(EndpointHealthCheck.checked_at.desc())
                .first()
            )
            if not last:
                summaries.append(
                    {
                        "endpoint_id": endpoint.id,
                        "name": endpoint.name,
                        "endpoint_url": endpoint.endpoint_url,
                        "status": HealthCheckStatus.UNKNOWN.value,
                        "checked_at": datetime.utcnow().isoformat(),
                        "latency_ms": None,
                        "http_status": None,
                        "error_message": "No checks yet",
                    }
                )
                continue
            summaries.append(
                {
                    "endpoint_id": endpoint.id,
                    "name": endpoint.name,
                    "endpoint_url": endpoint.endpoint_url,
                    "status": last.status,
                    "checked_at": last.checked_at.isoformat(),
                    "latency_ms": last.latency_ms,
                    "http_status": last.http_status,
                    "error_message": last.error_message,
                }
            )
        return {"generated_at": datetime.utcnow().isoformat(), "endpoints": summaries}

    def build_series(self, endpoint_id: int, window: HealthWindow) -> dict:
        endpoint = self.db.query(StorageEndpoint).filter(StorageEndpoint.id == endpoint_id).first()
        if not endpoint:
            raise ValueError("Endpoint not found.")
        now = datetime.utcnow()
        start = now - WINDOW_DELTAS[window]
        raw_rows = (
            self.db.query(EndpointHealthCheck)
            .filter(
                EndpointHealthCheck.storage_endpoint_id == endpoint_id,
                EndpointHealthCheck.checked_at >= start,
                EndpointHealthCheck.checked_at <= now,
            )
            .order_by(EndpointHealthCheck.checked_at.asc())
            .all()
        )
        series = [
            {
                "timestamp": row.checked_at.isoformat(),
                "status": row.status,
                "latency_ms": row.latency_ms,
                "http_status": row.http_status,
            }
            for row in raw_rows
        ]
        daily_rows = (
            self.db.query(EndpointHealthDaily)
            .filter(
                EndpointHealthDaily.storage_endpoint_id == endpoint_id,
                EndpointHealthDaily.day >= start.date(),
                EndpointHealthDaily.day <= now.date(),
            )
            .order_by(EndpointHealthDaily.day.asc())
            .all()
        )
        daily_map = {row.day: row for row in daily_rows}
        daily: list[dict] = []
        cursor = start.date()
        while cursor <= now.date():
            row = daily_map.get(cursor)
            if row:
                daily.append(
                    {
                        "day": cursor.isoformat(),
                        "ok_count": row.ok_count,
                        "degraded_count": row.degraded_count,
                        "down_count": row.down_count,
                        "avg_latency_ms": row.avg_latency_ms,
                        "p95_latency_ms": row.p95_latency_ms,
                    }
                )
            else:
                daily.append(
                    {
                        "day": cursor.isoformat(),
                        "ok_count": 0,
                        "degraded_count": 0,
                        "down_count": 0,
                        "avg_latency_ms": None,
                        "p95_latency_ms": None,
                    }
                )
            cursor += timedelta(days=1)
        return {
            "endpoint_id": endpoint_id,
            "window": window.value,
            "start": start.isoformat(),
            "end": now.isoformat(),
            "data_points": len(series),
            "series": series,
            "daily": daily,
        }

    def build_incidents(self, endpoint_id: int, window: HealthWindow) -> dict:
        endpoint = self.db.query(StorageEndpoint).filter(StorageEndpoint.id == endpoint_id).first()
        if not endpoint:
            raise ValueError("Endpoint not found.")
        now = datetime.utcnow()
        start = now - WINDOW_DELTAS[window]
        rows = (
            self.db.query(EndpointHealthCheck)
            .filter(
                EndpointHealthCheck.storage_endpoint_id == endpoint_id,
                EndpointHealthCheck.checked_at >= start,
                EndpointHealthCheck.checked_at <= now,
            )
            .order_by(EndpointHealthCheck.checked_at.asc())
            .all()
        )
        incidents: list[dict] = []
        active: Optional[EndpointHealthCheck] = None
        active_status: Optional[str] = None
        for row in rows:
            status = row.status
            if status == HealthCheckStatus.UP.value:
                if active:
                    incidents.append(self._close_incident(active, row.checked_at, active_status))
                    active = None
                    active_status = None
                continue
            if active is None:
                active = row
                active_status = status
                continue
            if status != active_status:
                incidents.append(self._close_incident(active, row.checked_at, active_status))
                active = row
                active_status = status
        if active:
            incidents.append(self._close_incident(active, None, active_status))
        return {"endpoint_id": endpoint_id, "window": window.value, "incidents": incidents}

    def _close_incident(
        self,
        start_row: EndpointHealthCheck,
        end_time: Optional[datetime],
        status: Optional[str],
    ) -> dict:
        duration = None
        if end_time:
            duration = int((end_time - start_row.checked_at).total_seconds() / 60)
        return {
            "start": start_row.checked_at.isoformat(),
            "end": end_time.isoformat() if end_time else None,
            "duration_minutes": duration,
            "status": status or HealthCheckStatus.DOWN.value,
        }

    def _check_endpoint(self, endpoint: StorageEndpoint, timestamp: datetime) -> HealthCheckResult:
        url = (endpoint.endpoint_url or "").strip()
        if not url:
            return HealthCheckResult(
                endpoint_id=endpoint.id,
                status=HealthCheckStatus.DOWN,
                checked_at=timestamp,
                latency_ms=None,
                http_status=None,
                error_message="Endpoint URL missing",
            )
        latency_ms: Optional[int] = None
        http_status: Optional[int] = None
        error_message: Optional[str] = None
        start = time.monotonic()
        try:
            response = requests.get(
                url,
                timeout=settings.healthcheck_timeout_seconds,
                verify=settings.healthcheck_verify_ssl,
                allow_redirects=True,
                headers={"User-Agent": "s3-manager-healthcheck"},
            )
            http_status = response.status_code
        except requests.RequestException as exc:
            error_message = str(exc)
            logger.warning("Healthcheck failed for %s: %s", url, exc)
        finally:
            latency_ms = int((time.monotonic() - start) * 1000)
        status = _compute_status(http_status, latency_ms, error_message)
        if status == HealthCheckStatus.DEGRADED and error_message is None and http_status is not None:
            error_message = f"HTTP {http_status}"
        return HealthCheckResult(
            endpoint_id=endpoint.id,
            status=status,
            checked_at=timestamp,
            latency_ms=latency_ms,
            http_status=http_status,
            error_message=error_message,
        )

    def _update_daily_aggregate(self, endpoint_id: int, day: date) -> None:
        start = datetime.combine(day, datetime.min.time())
        end = start + timedelta(days=1)
        rows = (
            self.db.query(EndpointHealthCheck)
            .filter(
                EndpointHealthCheck.storage_endpoint_id == endpoint_id,
                EndpointHealthCheck.checked_at >= start,
                EndpointHealthCheck.checked_at < end,
            )
            .order_by(EndpointHealthCheck.checked_at.asc())
            .all()
        )
        if not rows:
            return
        counts = {
            HealthCheckStatus.UP.value: 0,
            HealthCheckStatus.DEGRADED.value: 0,
            HealthCheckStatus.DOWN.value: 0,
            HealthCheckStatus.UNKNOWN.value: 0,
        }
        latencies: list[int] = []
        for row in rows:
            counts[row.status] = counts.get(row.status, 0) + 1
            if row.latency_ms is not None:
                latencies.append(row.latency_ms)
        avg_latency = int(sum(latencies) / len(latencies)) if latencies else None
        p95_latency = _percentile(latencies, 0.95) if latencies else None
        last = rows[-1]
        entry = (
            self.db.query(EndpointHealthDaily)
            .filter(
                EndpointHealthDaily.storage_endpoint_id == endpoint_id,
                EndpointHealthDaily.day == day,
            )
            .first()
        )
        if entry is None:
            entry = EndpointHealthDaily(
                day=day,
                storage_endpoint_id=endpoint_id,
            )
        entry.check_count = len(rows)
        entry.ok_count = counts.get(HealthCheckStatus.UP.value, 0)
        entry.degraded_count = counts.get(HealthCheckStatus.DEGRADED.value, 0)
        entry.down_count = counts.get(HealthCheckStatus.DOWN.value, 0)
        entry.avg_latency_ms = avg_latency
        entry.p95_latency_ms = p95_latency
        entry.last_status = last.status
        entry.last_checked_at = last.checked_at
        entry.updated_at = datetime.utcnow()
        self.db.add(entry)
        self.db.commit()

    def _prune_history(self) -> None:
        retention_days = settings.healthcheck_retention_days
        if retention_days <= 0:
            return
        cutoff = datetime.utcnow() - timedelta(days=retention_days)
        deleted = (
            self.db.query(EndpointHealthCheck)
            .filter(EndpointHealthCheck.checked_at < cutoff)
            .delete(synchronize_session=False)
        )
        if deleted:
            logger.info("Pruned %s healthcheck rows before %s", deleted, cutoff.isoformat())
        self.db.commit()
