# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any, Optional

from app.db import (
    EndpointHealthLatest,
    EndpointHealthRollup,
    EndpointHealthStatusSegment,
    HealthCheckStatus,
    StorageEndpoint,
)
from app.services.healthcheck_common import _coerce_check_mode, _percentile, resolve_healthcheck_profile


def incident_duration_minutes(row: EndpointHealthStatusSegment) -> int | None:
    if row.ended_at is None:
        return None
    return int((row.ended_at - row.started_at).total_seconds() / 60)


def workspace_endpoint_snapshot(
    *,
    endpoint: StorageEndpoint,
    latest_scope: EndpointHealthLatest | None,
    now: datetime,
    stale_after_seconds: int,
) -> tuple[dict[str, Any], str]:
    profile = resolve_healthcheck_profile(endpoint)
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
    counted_statuses = {
        HealthCheckStatus.UP.value,
        HealthCheckStatus.DEGRADED.value,
        HealthCheckStatus.DOWN.value,
    }
    effective_status = (
        status
        if not is_stale and status in counted_statuses
        else HealthCheckStatus.UNKNOWN.value
    )
    return (
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
        },
        effective_status,
    )


def workspace_incident_payload(
    row: EndpointHealthStatusSegment,
    *,
    endpoint_meta: dict[int, dict[str, Any]],
    incident_cutoff: datetime,
) -> dict[str, Any]:
    end_time = row.ended_at
    endpoint_info = endpoint_meta.get(int(row.storage_endpoint_id), {})
    return {
        "endpoint_id": int(row.storage_endpoint_id),
        "endpoint_name": endpoint_info.get("name")
        or f"Endpoint {row.storage_endpoint_id}",
        "endpoint_url": endpoint_info.get("url"),
        "status": row.status,
        "start": row.started_at.isoformat(),
        "end": end_time.isoformat() if end_time else None,
        "duration_minutes": incident_duration_minutes(row),
        "check_mode": _coerce_check_mode(row.check_mode),
        "ongoing": end_time is None,
        "recent": end_time is not None and end_time >= incident_cutoff,
    }


def status_from_rollup_counts(*, up_count: int, degraded_count: int, down_count: int) -> str:
    if down_count > 0:
        return HealthCheckStatus.DOWN.value
    if degraded_count > 0:
        return HealthCheckStatus.DEGRADED.value
    if up_count > 0:
        return HealthCheckStatus.UP.value
    return HealthCheckStatus.UNKNOWN.value


def build_segment_timeline_map(
    rows: list[EndpointHealthStatusSegment],
    *,
    endpoint_ids: list[int],
    start: datetime,
    now: datetime,
) -> dict[int, list[dict[str, Any]]]:
    timeline_by_endpoint: dict[int, list[dict[str, Any]]] = {
        endpoint_id: [] for endpoint_id in endpoint_ids
    }
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


def build_rollup_availability_map(
    rows: list[EndpointHealthRollup],
    *,
    endpoint_ids: list[int],
) -> dict[int, Optional[float]]:
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
        availability_by_endpoint[endpoint_id] = round(
            (state["up"] / state["known"]) * 100.0,
            2,
        )
    return availability_by_endpoint


def build_daily_from_rollups(
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
            aggregate["avg_latency_ms"] = int(
                round(int(aggregate["_latency_total"]) / latency_samples)
            )
        p95_values = [int(value) for value in aggregate["_p95_values"]]
        if p95_values:
            aggregate["p95_latency_ms"] = _percentile(p95_values, 0.95)
        aggregate.pop("_latency_total", None)
        aggregate.pop("_latency_samples", None)
        aggregate.pop("_p95_values", None)
        output.append(aggregate)

    return output
