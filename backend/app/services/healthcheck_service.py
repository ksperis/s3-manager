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
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db import (
    EndpointHealthCheck,
    HealthCheckStatus,
    StorageEndpoint,
)
from app.services.app_settings_service import load_app_settings
from app.services.healthcheck_common import (
    EndpointCheckTarget,
    HealthCheckProfile,
    HealthCheckResult,
    _compute_status,
    resolve_healthcheck_profile,
)
from app.services.healthcheck_persistence_service import HealthCheckPersistenceService
from app.services.s3_client import get_s3_client
from app.utils.name_ordering import name_order_by
from app.utils.time import utcnow

logger = logging.getLogger(__name__)
settings = get_settings()


class HealthCheckService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self._persistence = HealthCheckPersistenceService(db)

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

        self._persistence.record_results(results)
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
                headers={"User-Agent": "kaelo-healthcheck"},
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
