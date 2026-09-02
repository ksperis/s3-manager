# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from datetime import UTC, datetime, timedelta

from app.db import EndpointHealthRollup, EndpointHealthStatusSegment, HealthCheckStatus
from app.services.healthcheck_query_projection import (
    build_daily_from_rollups,
    build_rollup_availability_map,
    build_segment_timeline_map,
    status_from_rollup_counts,
)


def test_status_from_rollup_counts_uses_worst_known_status():
    assert status_from_rollup_counts(up_count=3, degraded_count=1, down_count=1) == "down"
    assert status_from_rollup_counts(up_count=3, degraded_count=1, down_count=0) == "degraded"
    assert status_from_rollup_counts(up_count=3, degraded_count=0, down_count=0) == "up"
    assert status_from_rollup_counts(up_count=0, degraded_count=0, down_count=0) == "unknown"


def test_build_daily_from_rollups_weights_latency_averages():
    start = datetime(2026, 9, 1, tzinfo=UTC)
    rows = [
        EndpointHealthRollup(
            storage_endpoint_id=1,
            bucket_start=start,
            up_count=2,
            degraded_count=0,
            down_count=0,
            latency_avg_ms=100,
            latency_p95_ms=120,
            latency_sample_count=2,
        ),
        EndpointHealthRollup(
            storage_endpoint_id=1,
            bucket_start=start + timedelta(hours=1),
            up_count=0,
            degraded_count=1,
            down_count=1,
            latency_avg_ms=200,
            latency_p95_ms=220,
            latency_sample_count=1,
        ),
    ]

    assert build_daily_from_rollups(rows, start=start, end=start) == [
        {
            "day": "2026-09-01",
            "ok_count": 2,
            "degraded_count": 1,
            "down_count": 1,
            "avg_latency_ms": 133,
            "p95_latency_ms": 215,
        }
    ]


def test_build_segment_timeline_map_clips_requested_window():
    start = datetime(2026, 9, 1, 10, tzinfo=UTC)
    now = start + timedelta(hours=2)
    rows = [
        EndpointHealthStatusSegment(
            storage_endpoint_id=1,
            status=HealthCheckStatus.DOWN.value,
            started_at=start - timedelta(hours=1),
            ended_at=now + timedelta(hours=1),
            avg_latency_ms=400,
        ),
        EndpointHealthStatusSegment(
            storage_endpoint_id=2,
            status=HealthCheckStatus.DEGRADED.value,
            started_at=start + timedelta(minutes=30),
            ended_at=start + timedelta(hours=1),
            avg_latency_ms=250,
        ),
    ]

    result = build_segment_timeline_map(rows, endpoint_ids=[1, 2, 3], start=start, now=now)

    assert result[1] == [
        {
            "timestamp": start.isoformat(),
            "end_timestamp": now.isoformat(),
            "status": "down",
            "latency_ms": 400,
            "reason": "Endpoint unavailable during this period.",
        }
    ]
    assert result[2][0]["reason"] == "Elevated latency around 250 ms."
    assert result[3] == []


def test_build_rollup_availability_map_ignores_unknown_samples():
    rows = [
        EndpointHealthRollup(
            storage_endpoint_id=1,
            up_count=3,
            degraded_count=1,
            down_count=1,
            unknown_count=10,
        )
    ]

    assert build_rollup_availability_map(rows, endpoint_ids=[1, 2]) == {
        1: 60.0,
        2: None,
    }
