# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from app.utils.time import utcnow

import logging
import math
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import datetime, timedelta
from enum import Enum
from typing import Any, Literal, Optional

import requests
from botocore.exceptions import BotoCoreError, ClientError
from sqlalchemy import and_, func, or_
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db import (
    EndpointHealthCheck,
    EndpointHealthLatest,
    EndpointHealthRollup,
    EndpointHealthStatusSegment,
    HealthCheckStatus,
    StorageEndpoint,
)
from app.services.app_settings_service import load_app_settings
from app.services.s3_client import get_s3_client
from app.utils.storage_endpoint_features import normalize_features_config

logger = logging.getLogger(__name__)
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
        run_started_at = utcnow()
        profiles = {endpoint.id: self._resolve_healthcheck_profile(endpoint) for endpoint in endpoints}
        baselines = {
            endpoint.id: self._load_latency_baseline(endpoint.id, profiles[endpoint.id].mode, run_started_at)
            for endpoint in endpoints
        }
        check_targets = [self._to_check_target(endpoint) for endpoint in endpoints]

        results: list[HealthCheckResult] = []
        if check_targets:
            worker_count = min(len(check_targets), 8)
            with ThreadPoolExecutor(max_workers=worker_count, thread_name_prefix="healthcheck") as executor:
                futures = {
                    executor.submit(
                        self._check_endpoint,
                        target,
                        profile=profiles[target.endpoint_id],
                        baseline_latency_ms=baselines[target.endpoint_id],
                    ): target.endpoint_id
                    for target in check_targets
                }
                for future in as_completed(futures):
                    endpoint_id = futures[future]
                    try:
                        results.append(future.result())
                    except Exception as exc:  # pragma: no cover - defensive guard
                        logger.exception("Healthcheck worker failed for endpoint %s: %s", endpoint_id, exc)
                        results.append(
                            HealthCheckResult(
                                endpoint_id=endpoint_id,
                                status=HealthCheckStatus.DOWN,
                                checked_at=utcnow(),
                                latency_ms=None,
                                http_status=None,
                                error_message=f"Healthcheck worker failure: {exc}",
                                check_mode=profiles[endpoint_id].mode,
                            )
                        )

        results.sort(key=lambda item: item.endpoint_id)

        for result in results:
            self.db.add(
                EndpointHealthCheck(
                    storage_endpoint_id=result.endpoint_id,
                    checked_at=result.checked_at,
                    http_status=result.http_status,
                    latency_ms=result.latency_ms,
                    check_mode=result.check_mode,
                    status=result.status.value,
                    error_message=result.error_message,
                )
            )
        self.db.commit()

        for result in results:
            self._update_latest_entry(result)
            self._update_status_segment(result)
            self._update_rollup_bucket(result, resolution_seconds=DEFAULT_ROLLUP_RESOLUTION_SECONDS)
        self.db.commit()

        self._prune_history()
        return {
            "checked_at": run_started_at.isoformat(),
            "total": len(endpoints),
            "results": [
                {
                    "endpoint_id": result.endpoint_id,
                    "status": result.status.value,
                    "latency_ms": result.latency_ms,
                    "http_status": result.http_status,
                    "error_message": result.error_message,
                    "check_mode": result.check_mode,
                }
                for result in results
            ],
        }

    @staticmethod
    def _to_check_target(endpoint: StorageEndpoint) -> EndpointCheckTarget:
        return EndpointCheckTarget(
            endpoint_id=endpoint.id,
            name=endpoint.name,
            endpoint_url=(endpoint.endpoint_url or "").strip(),
            verify_tls=bool(getattr(endpoint, "verify_tls", True)),
            region=endpoint.region,
            supervision_access_key=endpoint.supervision_access_key,
            supervision_secret_key=endpoint.supervision_secret_key,
            admin_access_key=endpoint.admin_access_key,
            admin_secret_key=endpoint.admin_secret_key,
        )

    def build_summary(self) -> dict:
        endpoints = (
            self.db.query(StorageEndpoint)
            .order_by(StorageEndpoint.is_default.desc(), StorageEndpoint.name.asc())
            .all()
        )
        endpoint_ids = [endpoint.id for endpoint in endpoints]
        latest_scope_by_endpoint = self._load_latest_scope_by_endpoint(endpoint_ids)
        summaries: list[dict] = []
        now_iso = utcnow().isoformat()
        for endpoint in endpoints:
            profile = self._resolve_healthcheck_profile(endpoint)
            latest = latest_scope_by_endpoint.get(endpoint.id)
            if latest is None:
                summaries.append(
                    {
                        "endpoint_id": endpoint.id,
                        "name": endpoint.name,
                        "endpoint_url": endpoint.endpoint_url,
                        "status": HealthCheckStatus.UNKNOWN.value,
                        "checked_at": now_iso,
                        "latency_ms": None,
                        "http_status": None,
                        "error_message": "No checks yet",
                        "check_mode": profile.mode,
                        "check_target_url": profile.target_url,
                    }
                )
                continue
            summaries.append(
                {
                    "endpoint_id": endpoint.id,
                    "name": endpoint.name,
                    "endpoint_url": endpoint.endpoint_url,
                    "status": latest.status,
                    "checked_at": latest.checked_at.isoformat(),
                    "latency_ms": latest.latency_ms,
                    "http_status": latest.http_status,
                    "error_message": latest.error_message,
                    "check_mode": _coerce_check_mode(latest.check_mode or profile.mode),
                    "check_target_url": profile.target_url,
                }
            )
        return {"generated_at": utcnow().isoformat(), "endpoints": summaries}

    def build_series(self, endpoint_id: int, window: HealthWindow) -> dict:
        endpoint = self.db.query(StorageEndpoint).filter(StorageEndpoint.id == endpoint_id).first()
        if not endpoint:
            raise ValueError("Endpoint not found.")
        profile = self._resolve_healthcheck_profile(endpoint)
        now = utcnow()
        start = now - WINDOW_DELTAS[window]
        rollup_rows = (
            self.db.query(EndpointHealthRollup)
            .filter(
                EndpointHealthRollup.storage_endpoint_id == endpoint_id,
                EndpointHealthRollup.check_type == DEFAULT_CHECK_TYPE,
                EndpointHealthRollup.scope == DEFAULT_SCOPE,
                EndpointHealthRollup.resolution_seconds == DEFAULT_ROLLUP_RESOLUTION_SECONDS,
                EndpointHealthRollup.bucket_start >= start,
                EndpointHealthRollup.bucket_start <= now,
            )
            .order_by(EndpointHealthRollup.bucket_start.asc())
            .all()
        )

        latest_scope = self._load_latest_scope_by_endpoint([endpoint_id]).get(endpoint_id)
        check_mode = _coerce_check_mode(
            (latest_scope.check_mode if latest_scope else None) or profile.mode
        )

        series = [
            {
                "timestamp": row.bucket_start.isoformat(),
                "status": self._status_from_rollup_counts(
                    up_count=int(row.up_count or 0),
                    degraded_count=int(row.degraded_count or 0),
                    down_count=int(row.down_count or 0),
                ),
                "latency_ms": row.latency_avg_ms,
                "http_status": None,
                "check_mode": _coerce_check_mode(row.check_mode),
                "check_type": row.check_type or DEFAULT_CHECK_TYPE,
                "scope": row.scope or DEFAULT_SCOPE,
            }
            for row in rollup_rows
        ]
        daily = self._build_daily_from_rollups(rollup_rows, start=start, end=now)
        data_points = sum(
            int(row.up_count or 0)
            + int(row.degraded_count or 0)
            + int(row.down_count or 0)
            + int(row.unknown_count or 0)
            for row in rollup_rows
        )

        return {
            "endpoint_id": endpoint_id,
            "window": window.value,
            "start": start.isoformat(),
            "end": now.isoformat(),
            "data_points": data_points,
            "check_mode": check_mode,
            "check_target_url": profile.target_url,
            "check_type": DEFAULT_CHECK_TYPE,
            "scope": DEFAULT_SCOPE,
            "resolution_seconds": DEFAULT_ROLLUP_RESOLUTION_SECONDS,
            "series": series,
            "daily": daily,
        }

    def build_overview(self, window: HealthWindow) -> dict:
        endpoints = (
            self.db.query(StorageEndpoint)
            .order_by(StorageEndpoint.is_default.desc(), StorageEndpoint.name.asc())
            .all()
        )
        now = utcnow()
        start = now - WINDOW_DELTAS[window]
        endpoint_ids = [endpoint.id for endpoint in endpoints]
        payload: list[dict] = []

        latest_scope_by_endpoint = self._load_latest_scope_by_endpoint(endpoint_ids)

        timeline_by_endpoint = self._build_segment_timeline_map(
            endpoint_ids=endpoint_ids,
            start=start,
            now=now,
        )
        availability_by_endpoint = self._build_rollup_availability_map(
            endpoint_ids=endpoint_ids,
            start=start,
            now=now,
        )

        for endpoint in endpoints:
            profile = self._resolve_healthcheck_profile(endpoint)
            latest_scope = latest_scope_by_endpoint.get(endpoint.id)
            timeline = timeline_by_endpoint.get(endpoint.id, [])
            availability = availability_by_endpoint.get(endpoint.id)

            if latest_scope is not None:
                status = latest_scope.status
                checked_at = latest_scope.checked_at.isoformat()
                latency_ms = latest_scope.latency_ms
                check_mode = _coerce_check_mode(latest_scope.check_mode)
                baseline = latest_scope.avg_latency_ms
            else:
                status = HealthCheckStatus.UNKNOWN.value
                checked_at = now.isoformat()
                latency_ms = None
                check_mode = profile.mode
                baseline = None

            payload.append(
                {
                    "endpoint_id": endpoint.id,
                    "name": endpoint.name,
                    "endpoint_url": endpoint.endpoint_url,
                    "status": status,
                    "checked_at": checked_at,
                    "latency_ms": latency_ms,
                    "check_mode": check_mode,
                    "check_target_url": profile.target_url,
                    "availability_pct": availability,
                    "baseline_latency_ms": baseline,
                    "timeline": timeline,
                }
            )

        return {
            "generated_at": now.isoformat(),
            "window": window.value,
            "start": start.isoformat(),
            "end": now.isoformat(),
            "endpoints": payload,
        }

    def build_latency_overview(self, window: HealthWindow = HealthWindow.DAY) -> dict:
        endpoints = (
            self.db.query(StorageEndpoint)
            .order_by(StorageEndpoint.is_default.desc(), StorageEndpoint.name.asc())
            .all()
        )
        now = utcnow()
        start = now - WINDOW_DELTAS[window]
        endpoint_ids = [endpoint.id for endpoint in endpoints]

        latest_scope_by_endpoint = self._load_latest_scope_by_endpoint(endpoint_ids)

        payload: list[dict[str, Any]] = []
        for endpoint in endpoints:
            profile = self._resolve_healthcheck_profile(endpoint)
            latest_scope = latest_scope_by_endpoint.get(endpoint.id)
            if latest_scope is not None:
                status = latest_scope.status
                checked_at = latest_scope.checked_at.isoformat()
                latency_ms = latest_scope.latency_ms
                check_mode = _coerce_check_mode(latest_scope.check_mode)
                min_latency_ms = latest_scope.min_latency_ms
                avg_latency_ms = latest_scope.avg_latency_ms
                max_latency_ms = latest_scope.max_latency_ms
                sample_count = int(latest_scope.latency_sample_count or 0)
            else:
                status = HealthCheckStatus.UNKNOWN.value
                checked_at = now.isoformat()
                latency_ms = None
                check_mode = profile.mode
                min_latency_ms = None
                avg_latency_ms = None
                max_latency_ms = None
                sample_count = 0
            payload.append(
                {
                    "endpoint_id": endpoint.id,
                    "name": endpoint.name,
                    "endpoint_url": endpoint.endpoint_url,
                    "status": status,
                    "checked_at": checked_at,
                    "latency_ms": latency_ms,
                    "check_mode": check_mode,
                    "check_target_url": profile.target_url,
                    "min_latency_ms": min_latency_ms,
                    "avg_latency_ms": avg_latency_ms,
                    "max_latency_ms": max_latency_ms,
                    "sample_count": sample_count,
                    "check_type": "availability",
                    "scope": "endpoint",
                }
            )

        return {
            "generated_at": now.isoformat(),
            "window": window.value,
            "start": start.isoformat(),
            "end": now.isoformat(),
            "endpoints": payload,
        }

    def build_global_incidents(self, window: HealthWindow, limit: int = 300) -> dict:
        endpoints = (
            self.db.query(StorageEndpoint)
            .order_by(StorageEndpoint.is_default.desc(), StorageEndpoint.name.asc())
            .all()
        )
        endpoint_meta = {
            endpoint.id: {
                "name": endpoint.name,
                "url": endpoint.endpoint_url,
            }
            for endpoint in endpoints
        }
        now = utcnow()
        start = now - WINDOW_DELTAS[window]

        segment_rows = (
            self.db.query(EndpointHealthStatusSegment)
            .filter(
                EndpointHealthStatusSegment.check_type == DEFAULT_CHECK_TYPE,
                EndpointHealthStatusSegment.scope == DEFAULT_SCOPE,
                EndpointHealthStatusSegment.status.in_(
                    [
                        HealthCheckStatus.DEGRADED.value,
                        HealthCheckStatus.DOWN.value,
                    ]
                ),
                EndpointHealthStatusSegment.started_at <= now,
                or_(
                    EndpointHealthStatusSegment.ended_at.is_(None),
                    EndpointHealthStatusSegment.ended_at >= start,
                ),
            )
            .order_by(EndpointHealthStatusSegment.started_at.desc())
            .all()
        )
        incidents = []
        for row in segment_rows:
            meta = endpoint_meta.get(int(row.storage_endpoint_id), {})
            end_time = row.ended_at
            duration = None
            if end_time is not None:
                duration = int((end_time - row.started_at).total_seconds() / 60)
            incidents.append(
                {
                    "endpoint_id": int(row.storage_endpoint_id),
                    "endpoint_name": meta.get("name") or f"Endpoint {row.storage_endpoint_id}",
                    "endpoint_url": meta.get("url"),
                    "status": row.status,
                    "start": row.started_at.isoformat(),
                    "end": end_time.isoformat() if end_time else None,
                    "duration_minutes": duration,
                    "check_mode": _coerce_check_mode(row.check_mode),
                    "check_type": row.check_type or DEFAULT_CHECK_TYPE,
                    "scope": row.scope or DEFAULT_SCOPE,
                }
            )

        total = len(incidents)
        if limit > 0:
            incidents = incidents[:limit]

        return {
            "window": window.value,
            "start": start.isoformat(),
            "end": now.isoformat(),
            "total": total,
            "incidents": incidents,
        }

    def build_workspace_health_overview(
        self,
        *,
        endpoint_id: Optional[int] = None,
        incident_highlight_minutes: Optional[int] = None,
    ) -> dict:
        endpoints_query = (
            self.db.query(StorageEndpoint)
            .order_by(StorageEndpoint.is_default.desc(), StorageEndpoint.name.asc())
        )
        if endpoint_id is not None:
            endpoints_query = endpoints_query.filter(StorageEndpoint.id == endpoint_id)
        endpoints = endpoints_query.all()
        if endpoint_id is not None and not endpoints:
            raise ValueError("Endpoint not found.")

        now = utcnow()
        endpoint_ids = [int(endpoint.id) for endpoint in endpoints]
        latest_scope_by_endpoint = self._load_latest_scope_by_endpoint(endpoint_ids)

        payload_endpoints: list[dict[str, Any]] = []
        up_count = 0
        degraded_count = 0
        down_count = 0
        unknown_count = 0

        for endpoint in endpoints:
            profile = self._resolve_healthcheck_profile(endpoint)
            latest_scope = latest_scope_by_endpoint.get(endpoint.id)
            if latest_scope is not None:
                status = str(latest_scope.status or HealthCheckStatus.UNKNOWN.value)
                checked_at = latest_scope.checked_at.isoformat()
                latency_ms = latest_scope.latency_ms
                check_mode = _coerce_check_mode(latest_scope.check_mode)
            else:
                status = HealthCheckStatus.UNKNOWN.value
                checked_at = now.isoformat()
                latency_ms = None
                check_mode = profile.mode

            if status == HealthCheckStatus.UP.value:
                up_count += 1
            elif status == HealthCheckStatus.DEGRADED.value:
                degraded_count += 1
            elif status == HealthCheckStatus.DOWN.value:
                down_count += 1
            else:
                unknown_count += 1

            payload_endpoints.append(
                {
                    "endpoint_id": endpoint.id,
                    "name": endpoint.name,
                    "endpoint_url": endpoint.endpoint_url,
                    "status": status,
                    "checked_at": checked_at,
                    "latency_ms": latency_ms,
                    "check_mode": check_mode,
                    "check_target_url": profile.target_url,
                }
            )

        highlight_minutes = max(
            1,
            int(incident_highlight_minutes or settings.healthcheck_incident_recent_minutes),
        )
        incident_cutoff = now - timedelta(minutes=highlight_minutes)

        payload_incidents: list[dict[str, Any]] = []
        if endpoint_ids:
            endpoint_meta = {
                int(endpoint.id): {
                    "name": endpoint.name,
                    "url": endpoint.endpoint_url,
                }
                for endpoint in endpoints
            }
            incident_rows = (
                self.db.query(EndpointHealthStatusSegment)
                .filter(
                    EndpointHealthStatusSegment.storage_endpoint_id.in_(endpoint_ids),
                    EndpointHealthStatusSegment.check_type == DEFAULT_CHECK_TYPE,
                    EndpointHealthStatusSegment.scope == DEFAULT_SCOPE,
                    EndpointHealthStatusSegment.status.in_(
                        [
                            HealthCheckStatus.DEGRADED.value,
                            HealthCheckStatus.DOWN.value,
                        ]
                    ),
                    EndpointHealthStatusSegment.started_at <= now,
                    or_(
                        EndpointHealthStatusSegment.ended_at.is_(None),
                        EndpointHealthStatusSegment.ended_at >= incident_cutoff,
                    ),
                )
                .order_by(EndpointHealthStatusSegment.started_at.desc())
                .all()
            )
            for row in incident_rows:
                end_time = row.ended_at
                duration_minutes = None
                if end_time is not None:
                    duration_minutes = int((end_time - row.started_at).total_seconds() / 60)
                endpoint_info = endpoint_meta.get(int(row.storage_endpoint_id), {})
                ongoing = end_time is None
                recent = end_time is not None and end_time >= incident_cutoff
                payload_incidents.append(
                    {
                        "endpoint_id": int(row.storage_endpoint_id),
                        "endpoint_name": endpoint_info.get("name") or f"Endpoint {row.storage_endpoint_id}",
                        "endpoint_url": endpoint_info.get("url"),
                        "status": row.status,
                        "start": row.started_at.isoformat(),
                        "end": end_time.isoformat() if end_time else None,
                        "duration_minutes": duration_minutes,
                        "check_mode": _coerce_check_mode(row.check_mode),
                        "ongoing": ongoing,
                        "recent": recent,
                    }
                )

        return {
            "generated_at": now.isoformat(),
            "incident_highlight_minutes": highlight_minutes,
            "endpoint_count": len(payload_endpoints),
            "up_count": up_count,
            "degraded_count": degraded_count,
            "down_count": down_count,
            "unknown_count": unknown_count,
            "endpoints": payload_endpoints,
            "incidents": payload_incidents,
        }

    def build_incidents(self, endpoint_id: int, window: HealthWindow) -> dict:
        endpoint = self.db.query(StorageEndpoint).filter(StorageEndpoint.id == endpoint_id).first()
        if not endpoint:
            raise ValueError("Endpoint not found.")
        profile = self._resolve_healthcheck_profile(endpoint)
        latest_scope = self._load_latest_scope_by_endpoint([endpoint_id]).get(endpoint_id)
        check_mode = _coerce_check_mode(
            (latest_scope.check_mode if latest_scope else None) or profile.mode
        )
        now = utcnow()
        start = now - WINDOW_DELTAS[window]
        rows = (
            self.db.query(EndpointHealthStatusSegment)
            .filter(
                EndpointHealthStatusSegment.storage_endpoint_id == endpoint_id,
                EndpointHealthStatusSegment.check_type == DEFAULT_CHECK_TYPE,
                EndpointHealthStatusSegment.scope == DEFAULT_SCOPE,
                EndpointHealthStatusSegment.status.in_(
                    [HealthCheckStatus.DEGRADED.value, HealthCheckStatus.DOWN.value]
                ),
                EndpointHealthStatusSegment.started_at <= now,
                or_(
                    EndpointHealthStatusSegment.ended_at.is_(None),
                    EndpointHealthStatusSegment.ended_at >= start,
                ),
            )
            .order_by(EndpointHealthStatusSegment.started_at.desc())
            .all()
        )
        incidents: list[dict[str, Any]] = []
        for row in rows:
            duration = None
            if row.ended_at is not None:
                duration = int((row.ended_at - row.started_at).total_seconds() / 60)
            incidents.append(
                {
                    "start": row.started_at.isoformat(),
                    "end": row.ended_at.isoformat() if row.ended_at else None,
                    "duration_minutes": duration,
                    "status": row.status,
                    "check_mode": _coerce_check_mode(row.check_mode),
                    "check_type": row.check_type or DEFAULT_CHECK_TYPE,
                    "scope": row.scope or DEFAULT_SCOPE,
                }
            )
        return {
            "endpoint_id": endpoint_id,
            "window": window.value,
            "check_mode": check_mode,
            "check_type": DEFAULT_CHECK_TYPE,
            "scope": DEFAULT_SCOPE,
            "incidents": incidents,
        }

    def build_raw_checks(self, endpoint_id: int, window: HealthWindow, page: int = 1, page_size: int = 25) -> dict:
        endpoint = self.db.query(StorageEndpoint).filter(StorageEndpoint.id == endpoint_id).first()
        if not endpoint:
            raise ValueError("Endpoint not found.")
        now = utcnow()
        start = now - WINDOW_DELTAS[window]
        safe_page = max(1, int(page))
        safe_page_size = max(1, int(page_size))

        query = (
            self.db.query(EndpointHealthCheck)
            .filter(
                EndpointHealthCheck.storage_endpoint_id == endpoint_id,
                EndpointHealthCheck.checked_at >= start,
                EndpointHealthCheck.checked_at <= now,
            )
        )
        total = int(query.count())
        offset = (safe_page - 1) * safe_page_size
        rows = (
            query.order_by(EndpointHealthCheck.checked_at.desc(), EndpointHealthCheck.id.desc())
            .offset(offset)
            .limit(safe_page_size)
            .all()
        )
        checks = [
            {
                "checked_at": row.checked_at.isoformat(),
                "status": row.status,
                "latency_ms": row.latency_ms,
                "http_status": row.http_status,
                "error_message": row.error_message,
                "check_mode": _coerce_check_mode(row.check_mode),
            }
            for row in rows
        ]
        return {
            "endpoint_id": endpoint_id,
            "window": window.value,
            "start": start.isoformat(),
            "end": now.isoformat(),
            "page": safe_page,
            "page_size": safe_page_size,
            "total": total,
            "checks": checks,
        }

    def _update_latest_entry(self, result: HealthCheckResult) -> None:
        window_start = result.checked_at - timedelta(days=1)
        rows = (
            self.db.query(EndpointHealthCheck.status, EndpointHealthCheck.latency_ms)
            .filter(
                EndpointHealthCheck.storage_endpoint_id == result.endpoint_id,
                EndpointHealthCheck.check_mode == result.check_mode,
                EndpointHealthCheck.checked_at >= window_start,
                EndpointHealthCheck.checked_at <= result.checked_at,
            )
            .all()
        )
        known_statuses = [str(status) for status, _ in rows if str(status) != HealthCheckStatus.UNKNOWN.value]
        up_checks = sum(1 for status in known_statuses if status == HealthCheckStatus.UP.value)
        availability_24h = int(round((up_checks / len(known_statuses)) * 100.0)) if known_statuses else None
        latencies = [
            int(latency)
            for status, latency in rows
            if latency is not None and str(status) != HealthCheckStatus.DOWN.value
        ]

        entry = (
            self.db.query(EndpointHealthLatest)
            .filter(
                EndpointHealthLatest.storage_endpoint_id == result.endpoint_id,
                EndpointHealthLatest.check_mode == result.check_mode,
                EndpointHealthLatest.check_type == DEFAULT_CHECK_TYPE,
                EndpointHealthLatest.scope == DEFAULT_SCOPE,
            )
            .first()
        )
        if entry is None:
            entry = EndpointHealthLatest(
                storage_endpoint_id=result.endpoint_id,
                check_mode=result.check_mode,
                check_type=DEFAULT_CHECK_TYPE,
                scope=DEFAULT_SCOPE,
            )
        entry.checked_at = result.checked_at
        entry.status = result.status.value
        entry.latency_ms = result.latency_ms
        entry.http_status = result.http_status
        entry.error_message = result.error_message
        entry.min_latency_ms = min(latencies) if latencies else None
        entry.avg_latency_ms = int(round(sum(latencies) / len(latencies))) if latencies else None
        entry.max_latency_ms = max(latencies) if latencies else None
        entry.latency_sample_count = len(latencies)
        entry.availability_24h = availability_24h
        entry.updated_at = utcnow()
        self.db.add(entry)

    def _update_status_segment(self, result: HealthCheckResult) -> None:
        active = (
            self.db.query(EndpointHealthStatusSegment)
            .filter(
                EndpointHealthStatusSegment.storage_endpoint_id == result.endpoint_id,
                EndpointHealthStatusSegment.check_mode == result.check_mode,
                EndpointHealthStatusSegment.check_type == DEFAULT_CHECK_TYPE,
                EndpointHealthStatusSegment.scope == DEFAULT_SCOPE,
                EndpointHealthStatusSegment.ended_at.is_(None),
            )
            .order_by(EndpointHealthStatusSegment.started_at.desc())
            .first()
        )
        latency_value = int(result.latency_ms) if result.latency_ms is not None and result.status != HealthCheckStatus.DOWN else None

        if active and active.status == result.status.value:
            active.checks_count = int(active.checks_count or 0) + 1
            if latency_value is not None:
                sample_count = int(active.latency_sample_count or 0)
                avg = int(active.avg_latency_ms) if active.avg_latency_ms is not None else latency_value
                total = (avg * sample_count) + latency_value
                sample_count += 1
                active.latency_sample_count = sample_count
                active.avg_latency_ms = int(round(total / sample_count))
                active.min_latency_ms = (
                    latency_value if active.min_latency_ms is None else min(int(active.min_latency_ms), latency_value)
                )
                active.max_latency_ms = (
                    latency_value if active.max_latency_ms is None else max(int(active.max_latency_ms), latency_value)
                )
            active.updated_at = utcnow()
            self.db.add(active)
            return

        if active:
            active.ended_at = result.checked_at
            active.updated_at = utcnow()
            self.db.add(active)

        self.db.add(
            EndpointHealthStatusSegment(
                storage_endpoint_id=result.endpoint_id,
                check_mode=result.check_mode,
                check_type=DEFAULT_CHECK_TYPE,
                scope=DEFAULT_SCOPE,
                status=result.status.value,
                started_at=result.checked_at,
                ended_at=None,
                checks_count=1,
                min_latency_ms=latency_value,
                avg_latency_ms=latency_value,
                max_latency_ms=latency_value,
                latency_sample_count=(1 if latency_value is not None else 0),
                updated_at=utcnow(),
            )
        )

    @staticmethod
    def _bucket_start(timestamp: datetime, resolution_seconds: int) -> datetime:
        normalized = timestamp.replace(second=0, microsecond=0)
        if resolution_seconds <= 60:
            return normalized
        minutes = resolution_seconds // 60
        floored_minute = (normalized.minute // minutes) * minutes
        return normalized.replace(minute=floored_minute)

    def _update_rollup_bucket(self, result: HealthCheckResult, resolution_seconds: int) -> None:
        bucket_start = self._bucket_start(result.checked_at, resolution_seconds)
        bucket_end = bucket_start + timedelta(seconds=resolution_seconds)
        rows = (
            self.db.query(EndpointHealthCheck.status, EndpointHealthCheck.latency_ms)
            .filter(
                EndpointHealthCheck.storage_endpoint_id == result.endpoint_id,
                EndpointHealthCheck.check_mode == result.check_mode,
                EndpointHealthCheck.checked_at >= bucket_start,
                EndpointHealthCheck.checked_at < bucket_end,
            )
            .all()
        )
        counts = {
            HealthCheckStatus.UP.value: 0,
            HealthCheckStatus.DEGRADED.value: 0,
            HealthCheckStatus.DOWN.value: 0,
            HealthCheckStatus.UNKNOWN.value: 0,
        }
        latencies: list[int] = []
        for status, latency in rows:
            status_value = str(status)
            counts[status_value] = counts.get(status_value, 0) + 1
            if latency is not None and status_value != HealthCheckStatus.DOWN.value:
                latencies.append(int(latency))

        entry = (
            self.db.query(EndpointHealthRollup)
            .filter(
                EndpointHealthRollup.storage_endpoint_id == result.endpoint_id,
                EndpointHealthRollup.check_mode == result.check_mode,
                EndpointHealthRollup.check_type == DEFAULT_CHECK_TYPE,
                EndpointHealthRollup.scope == DEFAULT_SCOPE,
                EndpointHealthRollup.resolution_seconds == resolution_seconds,
                EndpointHealthRollup.bucket_start == bucket_start,
            )
            .first()
        )
        if entry is None:
            entry = EndpointHealthRollup(
                storage_endpoint_id=result.endpoint_id,
                check_mode=result.check_mode,
                check_type=DEFAULT_CHECK_TYPE,
                scope=DEFAULT_SCOPE,
                resolution_seconds=resolution_seconds,
                bucket_start=bucket_start,
            )
        entry.up_count = counts.get(HealthCheckStatus.UP.value, 0)
        entry.degraded_count = counts.get(HealthCheckStatus.DEGRADED.value, 0)
        entry.down_count = counts.get(HealthCheckStatus.DOWN.value, 0)
        entry.unknown_count = counts.get(HealthCheckStatus.UNKNOWN.value, 0)
        entry.latency_sample_count = len(latencies)
        entry.latency_min_ms = min(latencies) if latencies else None
        entry.latency_avg_ms = int(round(sum(latencies) / len(latencies))) if latencies else None
        entry.latency_max_ms = max(latencies) if latencies else None
        entry.latency_p95_ms = _percentile(latencies, 0.95) if latencies else None
        entry.updated_at = utcnow()
        self.db.add(entry)

    def _resolve_healthcheck_profile(self, endpoint: StorageEndpoint) -> HealthCheckProfile:
        features = normalize_features_config(endpoint.provider, endpoint.features_config)
        healthcheck_cfg = features.get("healthcheck", {})
        mode = _coerce_check_mode(healthcheck_cfg.get("mode"))
        target_url = str(healthcheck_cfg.get("url") or endpoint.endpoint_url or "").strip()
        return HealthCheckProfile(mode=mode, target_url=target_url)

    def _load_latency_baseline(
        self,
        endpoint_id: int,
        check_mode: Literal["http", "s3"],
        now: datetime,
    ) -> Optional[int]:
        baseline_window_days = max(1, int(settings.healthcheck_latency_baseline_window_days))
        baseline_sample_size = max(5, int(settings.healthcheck_baseline_sample_size))
        start = now - timedelta(days=baseline_window_days)
        rows = (
            self.db.query(EndpointHealthCheck.latency_ms)
            .filter(
                EndpointHealthCheck.storage_endpoint_id == endpoint_id,
                EndpointHealthCheck.checked_at >= start,
                EndpointHealthCheck.status == HealthCheckStatus.UP.value,
                EndpointHealthCheck.check_mode == check_mode,
                EndpointHealthCheck.latency_ms.isnot(None),
            )
            .order_by(EndpointHealthCheck.checked_at.desc())
            .limit(baseline_sample_size)
            .all()
        )
        latencies = [int(row[0]) for row in rows if row[0] is not None]
        if len(latencies) < 5:
            return None
        return int(sum(latencies) / len(latencies))

    def _is_latency_substantially_degraded(self, latency_ms: Optional[int], baseline_latency_ms: Optional[int]) -> bool:
        if latency_ms is None or baseline_latency_ms is None or baseline_latency_ms <= 0:
            return False
        ratio = float(settings.healthcheck_relative_degraded_ratio)
        min_delta = int(settings.healthcheck_relative_degraded_min_delta_ms)
        if ratio <= 1.0:
            return False
        return latency_ms >= int(round(baseline_latency_ms * ratio)) and (latency_ms - baseline_latency_ms) >= min_delta

    @staticmethod
    def _resolve_verify_ssl(target: EndpointCheckTarget) -> bool:
        return bool(settings.healthcheck_verify_ssl) and bool(target.verify_tls)

    def _http_probe(self, target: EndpointCheckTarget, url: str) -> tuple[Optional[int], Optional[str]]:
        try:
            response = requests.get(
                url,
                timeout=settings.healthcheck_timeout_seconds,
                verify=self._resolve_verify_ssl(target),
                allow_redirects=True,
                headers={"User-Agent": "s3-manager-healthcheck"},
            )
            return response.status_code, None
        except requests.RequestException as exc:
            logger.warning("HTTP healthcheck failed for %s: %s", url, exc)
            return None, str(exc)

    def _s3_probe(self, target: EndpointCheckTarget, url: str) -> tuple[Optional[int], Optional[str]]:
        access_key = (target.supervision_access_key or target.admin_access_key or "").strip() or None
        secret_key = target.supervision_secret_key or target.admin_secret_key
        if not access_key or not secret_key:
            return None, "S3 healthcheck mode requires supervision/admin credentials."

        try:
            s3_client = get_s3_client(
                access_key=access_key,
                secret_key=secret_key,
                endpoint=url,
                region=target.region,
                verify_tls=self._resolve_verify_ssl(target),
            )
            response = s3_client.list_buckets()
            meta = response.get("ResponseMetadata", {}) if isinstance(response, dict) else {}
            status_code = meta.get("HTTPStatusCode", 200)
            return int(status_code), None
        except ClientError as exc:
            status_code = exc.response.get("ResponseMetadata", {}).get("HTTPStatusCode") if hasattr(exc, "response") else None
            if status_code is None:
                logger.warning("S3 healthcheck failed for %s: %s", url, exc)
                return None, str(exc)
            return int(status_code), None
        except BotoCoreError as exc:
            logger.warning("S3 healthcheck failed for %s: %s", url, exc)
            return None, str(exc)

    def _check_endpoint(
        self,
        target: EndpointCheckTarget,
        *,
        profile: HealthCheckProfile,
        baseline_latency_ms: Optional[int],
    ) -> HealthCheckResult:
        url = profile.target_url.strip().rstrip("/")
        checked_at = utcnow()
        if not url:
            return HealthCheckResult(
                endpoint_id=target.endpoint_id,
                status=HealthCheckStatus.DOWN,
                checked_at=checked_at,
                latency_ms=None,
                http_status=None,
                error_message="Endpoint URL missing",
                check_mode=profile.mode,
            )

        latency_ms: Optional[int] = None
        http_status: Optional[int] = None
        error_message: Optional[str] = None

        start = time.monotonic()
        try:
            if profile.mode == "s3":
                http_status, error_message = self._s3_probe(target, url)
            else:
                http_status, error_message = self._http_probe(target, url)
        finally:
            latency_ms = int((time.monotonic() - start) * 1000)

        status = _compute_status(http_status, latency_ms, error_message)
        if status == HealthCheckStatus.UP and self._is_latency_substantially_degraded(latency_ms, baseline_latency_ms):
            status = HealthCheckStatus.DEGRADED
            if baseline_latency_ms is not None and latency_ms is not None:
                error_message = f"Latency spike: {latency_ms} ms vs baseline {baseline_latency_ms} ms"
        elif status == HealthCheckStatus.DEGRADED and error_message is None:
            if http_status is not None and http_status >= 500:
                error_message = f"HTTP {http_status}"
            elif baseline_latency_ms is not None and latency_ms is not None and self._is_latency_substantially_degraded(latency_ms, baseline_latency_ms):
                error_message = f"Latency spike: {latency_ms} ms vs baseline {baseline_latency_ms} ms"
            elif settings.healthcheck_degraded_latency_ms and latency_ms is not None:
                error_message = f"Latency {latency_ms} ms above threshold"

        return HealthCheckResult(
            endpoint_id=target.endpoint_id,
            status=status,
            checked_at=checked_at,
            latency_ms=latency_ms,
            http_status=http_status,
            error_message=error_message,
            check_mode=profile.mode,
        )

    def _build_segment_timeline_map(
        self,
        *,
        endpoint_ids: list[int],
        start: datetime,
        now: datetime,
    ) -> dict[int, list[dict[str, Any]]]:
        if not endpoint_ids:
            return {}

        rows = (
            self.db.query(EndpointHealthStatusSegment)
            .filter(
                EndpointHealthStatusSegment.storage_endpoint_id.in_(endpoint_ids),
                EndpointHealthStatusSegment.check_type == DEFAULT_CHECK_TYPE,
                EndpointHealthStatusSegment.scope == DEFAULT_SCOPE,
                EndpointHealthStatusSegment.started_at <= now,
                or_(
                    EndpointHealthStatusSegment.ended_at.is_(None),
                    EndpointHealthStatusSegment.ended_at >= start,
                ),
            )
            .order_by(
                EndpointHealthStatusSegment.storage_endpoint_id.asc(),
                EndpointHealthStatusSegment.started_at.asc(),
            )
            .all()
        )
        timeline_by_endpoint: dict[int, list[dict[str, Any]]] = {endpoint_id: [] for endpoint_id in endpoint_ids}
        for row in rows:
            segment_start = max(row.started_at, start)
            segment_end = min((row.ended_at or now), now)
            if segment_end <= segment_start:
                continue
            status = str(row.status or HealthCheckStatus.UNKNOWN.value)
            reason: Optional[str] = None
            if status == HealthCheckStatus.DOWN.value:
                reason = "Endpoint unavailable during this period."
            elif status == HealthCheckStatus.DEGRADED.value:
                if row.avg_latency_ms is not None:
                    reason = f"Elevated latency around {row.avg_latency_ms} ms."
                else:
                    reason = "Degraded checks detected."
            timeline_by_endpoint.setdefault(int(row.storage_endpoint_id), []).append(
                {
                    "timestamp": segment_start.isoformat(),
                    "end_timestamp": segment_end.isoformat(),
                    "status": status,
                    "latency_ms": row.avg_latency_ms,
                    "reason": reason,
                }
            )
        return timeline_by_endpoint

    def _build_rollup_availability_map(
        self,
        *,
        endpoint_ids: list[int],
        start: datetime,
        now: datetime,
    ) -> dict[int, Optional[float]]:
        if not endpoint_ids:
            return {}
        rows = (
            self.db.query(EndpointHealthRollup)
            .filter(
                EndpointHealthRollup.storage_endpoint_id.in_(endpoint_ids),
                EndpointHealthRollup.check_type == DEFAULT_CHECK_TYPE,
                EndpointHealthRollup.scope == DEFAULT_SCOPE,
                EndpointHealthRollup.resolution_seconds == DEFAULT_ROLLUP_RESOLUTION_SECONDS,
                EndpointHealthRollup.bucket_start >= start,
                EndpointHealthRollup.bucket_start <= now,
            )
            .order_by(
                EndpointHealthRollup.storage_endpoint_id.asc(),
                EndpointHealthRollup.bucket_start.asc(),
            )
            .all()
        )
        accumulator: dict[int, dict[str, int]] = {}
        for row in rows:
            endpoint_id = int(row.storage_endpoint_id)
            state = accumulator.setdefault(endpoint_id, {"up": 0, "known": 0})
            up_count = int(row.up_count or 0)
            degraded_count = int(row.degraded_count or 0)
            down_count = int(row.down_count or 0)
            state["up"] += up_count
            state["known"] += up_count + degraded_count + down_count

        availability_by_endpoint: dict[int, Optional[float]] = {}
        for endpoint_id in endpoint_ids:
            state = accumulator.get(endpoint_id)
            if not state or state["known"] <= 0:
                availability_by_endpoint[endpoint_id] = None
                continue
            availability_by_endpoint[endpoint_id] = round((state["up"] / state["known"]) * 100.0, 2)
        return availability_by_endpoint

    @staticmethod
    def _status_from_rollup_counts(*, up_count: int, degraded_count: int, down_count: int) -> str:
        if down_count > 0:
            return HealthCheckStatus.DOWN.value
        if degraded_count > 0:
            return HealthCheckStatus.DEGRADED.value
        if up_count > 0:
            return HealthCheckStatus.UP.value
        return HealthCheckStatus.UNKNOWN.value

    def _build_daily_from_rollups(
        self,
        rollup_rows: list[EndpointHealthRollup],
        *,
        start: datetime,
        end: datetime,
    ) -> list[dict[str, Any]]:
        if not rollup_rows:
            return []
        by_day: dict[str, dict[str, Any]] = {}
        cursor = start.date()
        end_day = end.date()
        while cursor <= end_day:
            day_key = cursor.isoformat()
            by_day[day_key] = {
                "day": day_key,
                "ok_count": 0,
                "degraded_count": 0,
                "down_count": 0,
                "avg_latency_ms": None,
                "p95_latency_ms": None,
                "_latency_total": 0,
                "_latency_samples": 0,
                "_p95_values": [],
            }
            cursor += timedelta(days=1)

        for row in rollup_rows:
            day_key = row.bucket_start.date().isoformat()
            aggregate = by_day.get(day_key)
            if aggregate is None:
                continue
            up_count = int(row.up_count or 0)
            degraded_count = int(row.degraded_count or 0)
            down_count = int(row.down_count or 0)
            aggregate["ok_count"] += up_count
            aggregate["degraded_count"] += degraded_count
            aggregate["down_count"] += down_count
            sample_count = int(row.latency_sample_count or 0)
            if sample_count > 0 and row.latency_avg_ms is not None:
                aggregate["_latency_total"] += int(row.latency_avg_ms) * sample_count
                aggregate["_latency_samples"] += sample_count
            if row.latency_p95_ms is not None:
                aggregate["_p95_values"].append(int(row.latency_p95_ms))

        output: list[dict[str, Any]] = []
        for day_key in sorted(by_day.keys()):
            aggregate = by_day[day_key]
            latency_samples = int(aggregate["_latency_samples"])
            if latency_samples > 0:
                aggregate["avg_latency_ms"] = int(round(int(aggregate["_latency_total"]) / latency_samples))
            p95_values = [int(value) for value in aggregate["_p95_values"]]
            if p95_values:
                aggregate["p95_latency_ms"] = _percentile(p95_values, 0.95)
            aggregate.pop("_latency_total", None)
            aggregate.pop("_latency_samples", None)
            aggregate.pop("_p95_values", None)
            output.append(aggregate)

        return output

    def _load_latest_scope_by_endpoint(self, endpoint_ids: list[int]) -> dict[int, EndpointHealthLatest]:
        if not endpoint_ids:
            return {}
        latest_rows = (
            self.db.query(
                EndpointHealthLatest.storage_endpoint_id.label("endpoint_id"),
                func.max(EndpointHealthLatest.checked_at).label("last_checked_at"),
            )
            .filter(
                EndpointHealthLatest.storage_endpoint_id.in_(endpoint_ids),
                EndpointHealthLatest.check_type == DEFAULT_CHECK_TYPE,
                EndpointHealthLatest.scope == DEFAULT_SCOPE,
            )
            .group_by(EndpointHealthLatest.storage_endpoint_id)
            .subquery()
        )

        rows = (
            self.db.query(EndpointHealthLatest)
            .join(
                latest_rows,
                and_(
                    EndpointHealthLatest.storage_endpoint_id == latest_rows.c.endpoint_id,
                    EndpointHealthLatest.checked_at == latest_rows.c.last_checked_at,
                ),
            )
            .filter(
                EndpointHealthLatest.check_type == DEFAULT_CHECK_TYPE,
                EndpointHealthLatest.scope == DEFAULT_SCOPE,
            )
            .all()
        )
        latest_by_endpoint: dict[int, EndpointHealthLatest] = {}
        for row in rows:
            endpoint_id = int(row.storage_endpoint_id)
            current = latest_by_endpoint.get(endpoint_id)
            if current is None or row.checked_at > current.checked_at:
                latest_by_endpoint[endpoint_id] = row
        return latest_by_endpoint

    def _prune_history(self) -> None:
        retention_days = settings.healthcheck_retention_days
        if retention_days <= 0:
            return
        cutoff = utcnow() - timedelta(days=retention_days)
        deleted_raw = (
            self.db.query(EndpointHealthCheck)
            .filter(EndpointHealthCheck.checked_at < cutoff)
            .delete(synchronize_session=False)
        )
        deleted_rollups = (
            self.db.query(EndpointHealthRollup)
            .filter(EndpointHealthRollup.bucket_start < cutoff)
            .delete(synchronize_session=False)
        )
        deleted_segments = (
            self.db.query(EndpointHealthStatusSegment)
            .filter(
                EndpointHealthStatusSegment.ended_at.isnot(None),
                EndpointHealthStatusSegment.ended_at < cutoff,
            )
            .delete(synchronize_session=False)
        )
        total_deleted = deleted_raw + deleted_rollups + deleted_segments
        if total_deleted:
            logger.info(
                "Pruned health metrics rows before %s (raw=%s rollups=%s segments=%s)",
                cutoff.isoformat(),
                deleted_raw,
                deleted_rollups,
                deleted_segments,
            )
        self.db.commit()
