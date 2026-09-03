# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from collections.abc import Iterable

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.sensitive_data import sanitize_persisted_error
from app.db import (
    EndpointHealthCheck,
    HealthCheckStatus,
    StorageEndpoint,
    User,
    UserRole,
)
from app.services.healthcheck_common import HealthCheckResult
from app.services.user_notifications_service import UserNotificationsService


class EndpointHealthNotificationsService:
    def __init__(self, db: Session) -> None:
        self.db = db

    def load_previous_statuses(
        self,
        results: Iterable[HealthCheckResult],
    ) -> dict[tuple[int, str], str]:
        endpoint_ids = sorted({int(result.endpoint_id) for result in results})
        if not endpoint_ids:
            return {}
        ranked = (
            self.db.query(EndpointHealthCheck)
            .with_entities(
                EndpointHealthCheck.storage_endpoint_id.label("endpoint_id"),
                EndpointHealthCheck.check_mode.label("check_mode"),
                EndpointHealthCheck.status.label("status"),
                func.row_number()
                .over(
                    partition_by=(
                        EndpointHealthCheck.storage_endpoint_id,
                        EndpointHealthCheck.check_mode,
                    ),
                    order_by=(
                        EndpointHealthCheck.checked_at.desc(),
                        EndpointHealthCheck.id.desc(),
                    ),
                )
                .label("position"),
            )
            .filter(EndpointHealthCheck.storage_endpoint_id.in_(endpoint_ids))
            .subquery()
        )
        rows = self.db.query(
            ranked.c.endpoint_id,
            ranked.c.check_mode,
            ranked.c.status,
        ).filter(ranked.c.position == 1)
        return {
            (int(endpoint_id), str(check_mode)): str(status)
            for endpoint_id, check_mode, status in rows
        }

    def create_transition_notifications(
        self,
        *,
        results: Iterable[HealthCheckResult],
        endpoints: dict[int, StorageEndpoint],
        previous_statuses: dict[tuple[int, str], str],
    ) -> int:
        admin_ids = self._active_admin_ids()
        if not admin_ids:
            return 0
        created = 0
        for result in results:
            current = result.status.value
            previous = previous_statuses.get(
                (int(result.endpoint_id), str(result.check_mode))
            )
            if not self._should_notify(previous, current):
                continue
            endpoint = endpoints.get(int(result.endpoint_id))
            if endpoint is None:
                continue
            severity, title, message = self._content(
                endpoint=endpoint,
                result=result,
                previous=previous,
            )
            safe_error = (
                sanitize_persisted_error(result.error_message)
                if result.error_message is not None
                else None
            )
            created += UserNotificationsService(self.db).create_notifications(
                user_ids=admin_ids,
                notification_type="endpoint_health",
                severity=severity,
                title=title,
                message=message,
                subject_type="endpoint",
                storage_endpoint_id=int(endpoint.id),
                event_key=(
                    f"endpoint_health:{endpoint.id}:{result.check_mode}:"
                    f"{previous or 'none'}:{current}:{result.checked_at.isoformat()}"
                ),
                payload={
                    "endpoint_id": int(endpoint.id),
                    "endpoint_name": endpoint.name,
                    "previous_status": previous,
                    "current_status": current,
                    "check_mode": result.check_mode,
                    "http_status": result.http_status,
                    "latency_ms": result.latency_ms,
                    "error_message": safe_error,
                    "checked_at": result.checked_at.isoformat(),
                },
                created_at=result.checked_at,
            )
        return created

    def _active_admin_ids(self) -> list[int]:
        return [
            int(row[0])
            for row in self.db.query(User.id)
            .filter(
                User.is_active.is_(True),
                User.role.in_(
                    [UserRole.UI_ADMIN.value, UserRole.UI_SUPERADMIN.value]
                ),
            )
            .all()
        ]

    @staticmethod
    def _should_notify(previous: str | None, current: str) -> bool:
        abnormal = {
            HealthCheckStatus.DEGRADED.value,
            HealthCheckStatus.DOWN.value,
        }
        if current in abnormal:
            return previous != current
        return current == HealthCheckStatus.UP.value and previous in abnormal

    @staticmethod
    def _content(
        *,
        endpoint: StorageEndpoint,
        result: HealthCheckResult,
        previous: str | None,
    ) -> tuple[str, str, str]:
        status = result.status
        if status == HealthCheckStatus.UP:
            return (
                "info",
                "Endpoint recovered",
                f"Endpoint {endpoint.name} recovered from {previous} and is up.",
            )

        safe_error = (
            sanitize_persisted_error(result.error_message)
            if result.error_message is not None
            else None
        )
        detail = safe_error
        if not detail and result.http_status is not None:
            detail = f"HTTP {result.http_status}"
        if not detail and result.latency_ms is not None:
            detail = f"Latency {result.latency_ms} ms"
        suffix = f": {detail}" if detail else "."
        if status == HealthCheckStatus.DOWN:
            return (
                "error",
                "Endpoint unavailable",
                f"Endpoint {endpoint.name} is down{suffix}",
            )
        return (
            "warning",
            "Endpoint degraded",
            f"Endpoint {endpoint.name} is degraded{suffix}",
        )
