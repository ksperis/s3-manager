# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db import (
    EndpointHealthCheck,
    EndpointHealthLatest,
    EndpointHealthRollup,
    EndpointHealthStatusSegment,
    HealthCheckStatus,
)
from app.services.healthcheck_common import (
    DEFAULT_CHECK_TYPE,
    DEFAULT_ROLLUP_RESOLUTION_SECONDS,
    DEFAULT_SCOPE,
    HealthCheckResult,
    _percentile,
)
from app.utils.time import utcnow

logger = logging.getLogger(__name__)
settings = get_settings()


class HealthCheckPersistenceService:
    def __init__(self, db: Session) -> None:
        self.db = db

    def record_results(self, results: list[HealthCheckResult]) -> None:
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
        created = entry is None
        if created:
            entry = EndpointHealthLatest(
                storage_endpoint_id=result.endpoint_id,
                check_mode=result.check_mode,
                check_type=DEFAULT_CHECK_TYPE,
                scope=DEFAULT_SCOPE,
            )
        self._apply_latest_entry_values(entry, result, latencies, availability_24h)
        if created:
            try:
                with self.db.begin_nested():
                    self.db.add(entry)
                    self.db.flush()
                return
            except IntegrityError:
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
                    raise
                self._apply_latest_entry_values(entry, result, latencies, availability_24h)
        self.db.add(entry)

    @staticmethod
    def _apply_latest_entry_values(
        entry: EndpointHealthLatest,
        result: HealthCheckResult,
        latencies: list[int],
        availability_24h: Optional[int],
    ) -> None:
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
        created = entry is None
        if created:
            entry = EndpointHealthRollup(
                storage_endpoint_id=result.endpoint_id,
                check_mode=result.check_mode,
                check_type=DEFAULT_CHECK_TYPE,
                scope=DEFAULT_SCOPE,
                resolution_seconds=resolution_seconds,
                bucket_start=bucket_start,
            )
        self._apply_rollup_values(entry, counts, latencies)
        if created:
            try:
                with self.db.begin_nested():
                    self.db.add(entry)
                    self.db.flush()
                return
            except IntegrityError:
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
                    raise
                self._apply_rollup_values(entry, counts, latencies)
        self.db.add(entry)

    @staticmethod
    def _apply_rollup_values(
        entry: EndpointHealthRollup,
        counts: dict[str, int],
        latencies: list[int],
    ) -> None:
        entry.up_count = counts.get(HealthCheckStatus.UP.value, 0)
        entry.degraded_count = counts.get(HealthCheckStatus.DEGRADED.value, 0)
        entry.down_count = counts.get(HealthCheckStatus.DOWN.value, 0)
        entry.unknown_count = counts.get(HealthCheckStatus.UNKNOWN.value, 0)
        entry.latency_sample_count = len(latencies)
        entry.latency_avg_ms = int(round(sum(latencies) / len(latencies))) if latencies else None
        entry.latency_p95_ms = _percentile(latencies, 0.95) if latencies else None
        entry.updated_at = utcnow()

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

