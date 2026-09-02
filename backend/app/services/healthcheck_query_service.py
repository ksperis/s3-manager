# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from collections import Counter
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
    resolve_healthcheck_profile,
)
from app.services.healthcheck_query_projection import (
    build_daily_from_rollups,
    build_rollup_availability_map,
    build_segment_timeline_map,
    incident_duration_minutes,
    status_from_rollup_counts,
    workspace_endpoint_snapshot,
    workspace_incident_payload,
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
                "status": status_from_rollup_counts(
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
        daily = build_daily_from_rollups(rollup_rows, start=start, end=now)
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
            incidents.append(
                {
                    "endpoint_id": int(row.storage_endpoint_id),
                    "endpoint_name": meta.get("name") or f"Endpoint {row.storage_endpoint_id}",
                    "endpoint_url": meta.get("url"),
                    "status": row.status,
                    "start": row.started_at.isoformat(),
                    "end": end_time.isoformat() if end_time else None,
                    "duration_minutes": incident_duration_minutes(row),
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

    def _workspace_incident_rows(
        self,
        *,
        endpoint_ids: list[int],
        now: datetime,
        incident_cutoff: datetime,
    ) -> list[EndpointHealthStatusSegment]:
        if not endpoint_ids:
            return []
        return (
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
        endpoint_snapshots = [
            workspace_endpoint_snapshot(
                endpoint=endpoint,
                latest_scope=latest_scope_by_endpoint.get(endpoint.id),
                now=now,
                stale_after_seconds=stale_after_seconds,
            )
            for endpoint in endpoints
        ]
        payload_endpoints = [payload for payload, _status in endpoint_snapshots]
        status_counts = Counter(status for _payload, status in endpoint_snapshots)

        highlight_minutes = max(
            1,
            int(incident_highlight_minutes or settings.healthcheck_incident_recent_minutes),
        )
        incident_cutoff = now - timedelta(minutes=highlight_minutes)

        endpoint_meta = {
            int(endpoint.id): {
                "name": endpoint.name,
                "url": endpoint.endpoint_url,
            }
            for endpoint in endpoints
        }
        payload_incidents = [
            workspace_incident_payload(
                row,
                endpoint_meta=endpoint_meta,
                incident_cutoff=incident_cutoff,
            )
            for row in self._workspace_incident_rows(
                endpoint_ids=endpoint_ids,
                now=now,
                incident_cutoff=incident_cutoff,
            )
        ]

        return {
            "generated_at": now.isoformat(),
            "stale_after_seconds": stale_after_seconds,
            "incident_highlight_minutes": highlight_minutes,
            "endpoint_count": len(payload_endpoints),
            "up_count": status_counts[HealthCheckStatus.UP.value],
            "degraded_count": status_counts[HealthCheckStatus.DEGRADED.value],
            "down_count": status_counts[HealthCheckStatus.DOWN.value],
            "unknown_count": status_counts[HealthCheckStatus.UNKNOWN.value],
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
            incidents.append(
                {
                    "start": row.started_at.isoformat(),
                    "end": row.ended_at.isoformat() if row.ended_at else None,
                    "duration_minutes": incident_duration_minutes(row),
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
        return build_segment_timeline_map(
            rows,
            endpoint_ids=endpoint_ids,
            start=start,
            now=now,
        )

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
        return build_rollup_availability_map(rows, endpoint_ids=endpoint_ids)

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
