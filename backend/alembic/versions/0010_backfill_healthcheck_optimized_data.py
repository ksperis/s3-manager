"""backfill optimized healthcheck tables

Revision ID: 0010_backfill_healthcheck_optimized_data
Revises: 0009_healthcheck_optimized_tables
Create Date: 2026-02-19 00:10:00.000000
"""
from __future__ import annotations

from collections import deque
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable

from alembic import op
import sqlalchemy as sa


revision = "0010_backfill_healthcheck_optimized_data"
down_revision = "0009_healthcheck_optimized_tables"
branch_labels = None
depends_on = None

DEFAULT_CHECK_TYPE = "availability"
DEFAULT_SCOPE = "endpoint"
DEFAULT_ROLLUP_RESOLUTION_SECONDS = 300


def _coerce_mode(value: Any) -> str:
    return "s3" if str(value or "").strip().lower() == "s3" else "http"


def _as_datetime(value: Any) -> datetime:
    if isinstance(value, datetime):
        if value.tzinfo is not None:
            return value.astimezone(timezone.utc).replace(tzinfo=None)
        return value
    if isinstance(value, str):
        normalized = value.strip().replace("Z", "+00:00")
        parsed = datetime.fromisoformat(normalized)
        if parsed.tzinfo is not None:
            return parsed.astimezone(timezone.utc).replace(tzinfo=None)
        return parsed
    raise TypeError(f"Unsupported datetime value: {value!r}")


def _bucket_start(timestamp: datetime, resolution_seconds: int) -> datetime:
    normalized = timestamp.replace(second=0, microsecond=0)
    if resolution_seconds <= 60:
        return normalized
    minutes = resolution_seconds // 60
    floored_minute = (normalized.minute // minutes) * minutes
    return normalized.replace(minute=floored_minute)


def _percentile(values: list[int], percentile: float) -> int | None:
    if not values:
        return None
    sorted_values = sorted(values)
    if len(sorted_values) == 1:
        return sorted_values[0]
    k = (len(sorted_values) - 1) * percentile
    low = int(k)
    high = min(low + 1, len(sorted_values) - 1)
    if low == high:
        return sorted_values[low]
    lower_weight = high - k
    upper_weight = k - low
    return int(round((sorted_values[low] * lower_weight) + (sorted_values[high] * upper_weight)))


def _chunks(rows: list[dict[str, Any]], size: int = 1000) -> Iterable[list[dict[str, Any]]]:
    for index in range(0, len(rows), size):
        yield rows[index : index + size]


def _flush_buffer(bind: Any, table: Any, rows: list[dict[str, Any]]) -> None:
    if not rows:
        return
    for chunk in _chunks(rows):
        bind.execute(table.insert(), chunk)
    rows.clear()


def upgrade() -> None:
    bind = op.get_bind()
    metadata = sa.MetaData()
    checks = sa.Table("endpoint_health_checks", metadata, autoload_with=bind)
    latest = sa.Table("endpoint_health_latest", metadata, autoload_with=bind)
    segments = sa.Table("endpoint_health_status_segments", metadata, autoload_with=bind)
    rollups = sa.Table("endpoint_health_rollups", metadata, autoload_with=bind)

    bind.execute(latest.delete())
    bind.execute(segments.delete())
    bind.execute(rollups.delete())

    rows = bind.execute(
        sa.select(
            checks.c.storage_endpoint_id,
            checks.c.checked_at,
            checks.c.status,
            checks.c.latency_ms,
            checks.c.http_status,
            checks.c.error_message,
            checks.c.check_mode,
        ).order_by(
            checks.c.storage_endpoint_id.asc(),
            checks.c.check_mode.asc(),
            checks.c.checked_at.asc(),
            checks.c.id.asc(),
        )
    ).mappings()

    recent_by_key: dict[tuple[int, str], deque[tuple[datetime, str, int | None]]] = {}
    active_segment_by_key: dict[tuple[int, str], dict[str, Any]] = {}
    active_bucket_by_key: dict[tuple[int, str], dict[str, Any]] = {}
    latest_by_key: dict[tuple[int, str], dict[str, Any]] = {}

    segment_rows: list[dict[str, Any]] = []
    rollup_rows: list[dict[str, Any]] = []
    now = datetime.utcnow()

    def flush_segment(key: tuple[int, str], end_time: datetime | None) -> None:
        state = active_segment_by_key.pop(key, None)
        if state is None:
            return
        sample_count = int(state["latency_sample_count"])
        avg_latency_ms = None
        if sample_count > 0:
            avg_latency_ms = int(round(int(state["latency_total"]) / sample_count))
        segment_rows.append(
            {
                "storage_endpoint_id": key[0],
                "check_mode": key[1],
                "check_type": DEFAULT_CHECK_TYPE,
                "scope": DEFAULT_SCOPE,
                "status": state["status"],
                "started_at": state["started_at"],
                "ended_at": end_time,
                "checks_count": int(state["checks_count"]),
                "min_latency_ms": state["min_latency_ms"],
                "avg_latency_ms": avg_latency_ms,
                "max_latency_ms": state["max_latency_ms"],
                "latency_sample_count": sample_count,
                "updated_at": now,
            }
        )
        if len(segment_rows) >= 5000:
            _flush_buffer(bind, segments, segment_rows)

    def flush_bucket(key: tuple[int, str]) -> None:
        state = active_bucket_by_key.pop(key, None)
        if state is None:
            return
        latencies = [int(value) for value in state["latencies"]]
        rollup_rows.append(
            {
                "storage_endpoint_id": key[0],
                "check_mode": key[1],
                "check_type": DEFAULT_CHECK_TYPE,
                "scope": DEFAULT_SCOPE,
                "resolution_seconds": DEFAULT_ROLLUP_RESOLUTION_SECONDS,
                "bucket_start": state["bucket_start"],
                "up_count": int(state["up_count"]),
                "degraded_count": int(state["degraded_count"]),
                "down_count": int(state["down_count"]),
                "unknown_count": int(state["unknown_count"]),
                "latency_min_ms": min(latencies) if latencies else None,
                "latency_avg_ms": int(round(sum(latencies) / len(latencies))) if latencies else None,
                "latency_max_ms": max(latencies) if latencies else None,
                "latency_p95_ms": _percentile(latencies, 0.95) if latencies else None,
                "latency_sample_count": len(latencies),
                "updated_at": now,
            }
        )
        if len(rollup_rows) >= 5000:
            _flush_buffer(bind, rollups, rollup_rows)

    for row in rows:
        endpoint_id = int(row["storage_endpoint_id"])
        check_mode = _coerce_mode(row["check_mode"])
        checked_at = _as_datetime(row["checked_at"])
        status = str(row["status"] or "unknown").strip().lower() or "unknown"
        latency_ms = int(row["latency_ms"]) if row["latency_ms"] is not None else None
        http_status = int(row["http_status"]) if row["http_status"] is not None else None
        error_message = row["error_message"]
        key = (endpoint_id, check_mode)

        recent = recent_by_key.setdefault(key, deque())
        recent.append((checked_at, status, latency_ms))
        cutoff = checked_at - timedelta(days=1)
        while recent and recent[0][0] < cutoff:
            recent.popleft()

        known_statuses = [entry_status for _, entry_status, _ in recent if entry_status != "unknown"]
        up_checks = sum(1 for entry_status in known_statuses if entry_status == "up")
        availability_24h = int(round((up_checks / len(known_statuses)) * 100.0)) if known_statuses else None
        recent_latencies = [
            int(entry_latency)
            for _, entry_status, entry_latency in recent
            if entry_latency is not None and entry_status != "down"
        ]
        latest_by_key[key] = {
            "storage_endpoint_id": endpoint_id,
            "check_mode": check_mode,
            "check_type": DEFAULT_CHECK_TYPE,
            "scope": DEFAULT_SCOPE,
            "checked_at": checked_at,
            "status": status,
            "latency_ms": latency_ms,
            "http_status": http_status,
            "error_message": error_message,
            "min_latency_ms": min(recent_latencies) if recent_latencies else None,
            "avg_latency_ms": int(round(sum(recent_latencies) / len(recent_latencies))) if recent_latencies else None,
            "max_latency_ms": max(recent_latencies) if recent_latencies else None,
            "latency_sample_count": len(recent_latencies),
            "availability_24h": availability_24h,
            "updated_at": now,
        }

        segment = active_segment_by_key.get(key)
        latency_for_segment = latency_ms if latency_ms is not None and status != "down" else None
        if segment is None:
            active_segment_by_key[key] = {
                "status": status,
                "started_at": checked_at,
                "checks_count": 1,
                "min_latency_ms": latency_for_segment,
                "max_latency_ms": latency_for_segment,
                "latency_total": int(latency_for_segment or 0),
                "latency_sample_count": (1 if latency_for_segment is not None else 0),
            }
        elif str(segment["status"]) == status:
            segment["checks_count"] = int(segment["checks_count"]) + 1
            if latency_for_segment is not None:
                segment["latency_total"] = int(segment["latency_total"]) + int(latency_for_segment)
                segment["latency_sample_count"] = int(segment["latency_sample_count"]) + 1
                segment["min_latency_ms"] = (
                    latency_for_segment
                    if segment["min_latency_ms"] is None
                    else min(int(segment["min_latency_ms"]), int(latency_for_segment))
                )
                segment["max_latency_ms"] = (
                    latency_for_segment
                    if segment["max_latency_ms"] is None
                    else max(int(segment["max_latency_ms"]), int(latency_for_segment))
                )
        else:
            flush_segment(key, checked_at)
            active_segment_by_key[key] = {
                "status": status,
                "started_at": checked_at,
                "checks_count": 1,
                "min_latency_ms": latency_for_segment,
                "max_latency_ms": latency_for_segment,
                "latency_total": int(latency_for_segment or 0),
                "latency_sample_count": (1 if latency_for_segment is not None else 0),
            }

        bucket_start = _bucket_start(checked_at, DEFAULT_ROLLUP_RESOLUTION_SECONDS)
        bucket = active_bucket_by_key.get(key)
        if bucket is None or bucket["bucket_start"] != bucket_start:
            if bucket is not None:
                flush_bucket(key)
            active_bucket_by_key[key] = {
                "bucket_start": bucket_start,
                "up_count": 0,
                "degraded_count": 0,
                "down_count": 0,
                "unknown_count": 0,
                "latencies": [],
            }
            bucket = active_bucket_by_key[key]

        if status == "up":
            bucket["up_count"] = int(bucket["up_count"]) + 1
        elif status == "degraded":
            bucket["degraded_count"] = int(bucket["degraded_count"]) + 1
        elif status == "down":
            bucket["down_count"] = int(bucket["down_count"]) + 1
        else:
            bucket["unknown_count"] = int(bucket["unknown_count"]) + 1
        if latency_ms is not None and status != "down":
            bucket["latencies"].append(int(latency_ms))

    for key in list(active_segment_by_key.keys()):
        flush_segment(key, None)
    for key in list(active_bucket_by_key.keys()):
        flush_bucket(key)

    latest_rows = list(latest_by_key.values())
    _flush_buffer(bind, latest, latest_rows)
    _flush_buffer(bind, segments, segment_rows)
    _flush_buffer(bind, rollups, rollup_rows)


def downgrade() -> None:
    pass
