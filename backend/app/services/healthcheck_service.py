# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import logging
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta
from typing import Literal, Optional

import requests
from botocore.exceptions import BotoCoreError, ClientError
from sqlalchemy.exc import IntegrityError
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
from app.services.healthcheck_common import (
    DEFAULT_CHECK_TYPE,
    DEFAULT_ROLLUP_RESOLUTION_SECONDS,
    DEFAULT_SCOPE,
    EndpointCheckTarget,
    HealthCheckProfile,
    HealthCheckResult,
    _compute_status,
    _percentile,
    resolve_healthcheck_profile,
)
from app.services.s3_client import get_s3_client
from app.utils.name_ordering import name_order_by
from app.utils.time import utcnow

logger = logging.getLogger(__name__)
settings = get_settings()


class HealthCheckService:
    def __init__(self, db: Session) -> None:
        self.db = db

    def run_checks(self) -> dict:
        app_settings = load_app_settings()
        if not app_settings.general.endpoint_status_enabled:
            raise ValueError("Endpoint Status feature is disabled")
        endpoints = self.db.query(StorageEndpoint).order_by(*name_order_by(StorageEndpoint)).all()
        run_started_at = utcnow()
        profiles = {endpoint.id: resolve_healthcheck_profile(endpoint) for endpoint in endpoints}
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
            force_path_style=bool(getattr(endpoint, "force_path_style", False)),
            verify_tls=bool(getattr(endpoint, "verify_tls", True)),
            region=endpoint.region,
            supervision_access_key=endpoint.supervision_access_key,
            supervision_secret_key=endpoint.supervision_secret_key,
            admin_access_key=endpoint.admin_access_key,
            admin_secret_key=endpoint.admin_secret_key,
        )

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
                force_path_style=target.force_path_style,
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
