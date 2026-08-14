# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any, Optional

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
from app.services.healthcheck_common import (
    DEFAULT_CHECK_TYPE,
    DEFAULT_ROLLUP_RESOLUTION_SECONDS,
    DEFAULT_SCOPE,
    WINDOW_DELTAS,
    HealthWindow,
    _coerce_check_mode,
    _percentile,
    resolve_healthcheck_profile,
)
from app.utils.name_ordering import name_order_by
from app.utils.time import utcnow

settings = get_settings()


class HealthCheckQueryService:
    def __init__(self, db: Session) -> None:
        self.db = db

    def _sorted_endpoints_query(self):
        return self.db.query(StorageEndpoint).order_by(*name_order_by(StorageEndpoint))

    def build_summary(self) -> dict:
        endpoints = self._sorted_endpoints_query().all()
        endpoint_ids = [endpoint.id for endpoint in endpoints]
        latest_scope_by_endpoint = self._load_latest_scope_by_endpoint(endpoint_ids)
        summaries: list[dict] = []
        now_iso = utcnow().isoformat()
        for endpoint in endpoints:
            profile = resolve_healthcheck_profile(endpoint)
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
        profile = resolve_healthcheck_profile(endpoint)
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
        endpoints = self._sorted_endpoints_query().all()
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
            profile = resolve_healthcheck_profile(endpoint)
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
        endpoints = self._sorted_endpoints_query().all()
        now = utcnow()
        start = now - WINDOW_DELTAS[window]
        endpoint_ids = [endpoint.id for endpoint in endpoints]

        latest_scope_by_endpoint = self._load_latest_scope_by_endpoint(endpoint_ids)

        payload: list[dict[str, Any]] = []
        for endpoint in endpoints:
            profile = resolve_healthcheck_profile(endpoint)
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
        endpoints = self._sorted_endpoints_query().all()
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
        endpoints_query = self._sorted_endpoints_query()
        if endpoint_id is not None:
            endpoints_query = endpoints_query.filter(StorageEndpoint.id == endpoint_id)
        endpoints = endpoints_query.all()
        if endpoint_id is not None and not endpoints:
            raise ValueError("Endpoint not found.")

        now = utcnow()
        stale_after_seconds = max(1, int(settings.healthcheck_interval_seconds)) * 2
        endpoint_ids = [int(endpoint.id) for endpoint in endpoints]
        latest_scope_by_endpoint = self._load_latest_scope_by_endpoint(endpoint_ids)

        payload_endpoints: list[dict[str, Any]] = []
        up_count = 0
        degraded_count = 0
        down_count = 0
        unknown_count = 0

        for endpoint in endpoints:
            profile = resolve_healthcheck_profile(endpoint)
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

            is_stale = latest_scope is None or (
                now - latest_scope.checked_at > timedelta(seconds=stale_after_seconds)
            )
            effective_status = HealthCheckStatus.UNKNOWN.value if is_stale else status

            if effective_status == HealthCheckStatus.UP.value:
                up_count += 1
            elif effective_status == HealthCheckStatus.DEGRADED.value:
                degraded_count += 1
            elif effective_status == HealthCheckStatus.DOWN.value:
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
                    "is_stale": is_stale,
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
            "stale_after_seconds": stale_after_seconds,
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
        profile = resolve_healthcheck_profile(endpoint)
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
