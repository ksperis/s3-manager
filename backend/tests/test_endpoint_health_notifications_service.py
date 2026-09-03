# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from datetime import timedelta
import json

import pytest

from app.db import (
    EndpointHealthCheck,
    HealthCheckStatus,
    StorageEndpoint,
    StorageProvider,
    User,
    UserNotification,
    UserRole,
)
from app.services.endpoint_health_notifications_service import (
    EndpointHealthNotificationsService,
)
from app.services.healthcheck_common import HealthCheckResult
from app.utils.time import utcnow


@pytest.mark.parametrize(
    ("previous", "current", "expected"),
    [
        (None, "up", False),
        (None, "degraded", True),
        (None, "down", True),
        (None, "unknown", False),
        ("up", "up", False),
        ("up", "degraded", True),
        ("up", "down", True),
        ("up", "unknown", False),
        ("degraded", "up", True),
        ("degraded", "degraded", False),
        ("degraded", "down", True),
        ("degraded", "unknown", False),
        ("down", "up", True),
        ("down", "degraded", True),
        ("down", "down", False),
        ("down", "unknown", False),
        ("unknown", "up", False),
        ("unknown", "degraded", True),
        ("unknown", "down", True),
        ("unknown", "unknown", False),
    ],
)
def test_endpoint_notification_transition_matrix(
    previous: str | None,
    current: str,
    expected: bool,
):
    assert (
        EndpointHealthNotificationsService._should_notify(previous, current)
        is expected
    )


def _result(
    endpoint_id: int,
    status: HealthCheckStatus,
    *,
    offset_minutes: int,
    error_message: str | None = None,
) -> HealthCheckResult:
    return HealthCheckResult(
        endpoint_id=endpoint_id,
        status=status,
        checked_at=utcnow() + timedelta(minutes=offset_minutes),
        latency_ms=2500 if status == HealthCheckStatus.DEGRADED else 20,
        http_status=503 if status == HealthCheckStatus.DEGRADED else 200,
        error_message=error_message,
        check_mode="http",
    )


def test_endpoint_health_notifications_follow_transitions_and_admin_scope(
    db_session,
):
    endpoint = StorageEndpoint(
        name="Transition endpoint",
        endpoint_url="https://transition.example.test",
        provider=StorageProvider.CEPH.value,
        is_default=True,
    )
    admin = User(
        email="health-admin@example.test",
        hashed_password="x",
        role=UserRole.UI_ADMIN.value,
        is_active=True,
    )
    superadmin = User(
        email="health-superadmin@example.test",
        hashed_password="x",
        role=UserRole.UI_SUPERADMIN.value,
        is_active=True,
    )
    inactive_admin = User(
        email="health-inactive@example.test",
        hashed_password="x",
        role=UserRole.UI_ADMIN.value,
        is_active=False,
    )
    standard_user = User(
        email="health-user@example.test",
        hashed_password="x",
        role=UserRole.UI_USER.value,
        is_active=True,
    )
    db_session.add_all([endpoint, admin, superadmin, inactive_admin, standard_user])
    db_session.commit()
    service = EndpointHealthNotificationsService(db_session)
    endpoints = {int(endpoint.id): endpoint}

    first_up = _result(endpoint.id, HealthCheckStatus.UP, offset_minutes=0)
    assert service.create_transition_notifications(
        results=[first_up], endpoints=endpoints, previous_statuses={}
    ) == 0

    degraded = _result(
        endpoint.id,
        HealthCheckStatus.DEGRADED,
        offset_minutes=1,
        error_message="access_key=AKIA1234567890123456 timed out",
    )
    assert service.create_transition_notifications(
        results=[degraded],
        endpoints=endpoints,
        previous_statuses={(endpoint.id, "http"): "up"},
    ) == 2
    assert service.create_transition_notifications(
        results=[_result(endpoint.id, HealthCheckStatus.DEGRADED, offset_minutes=2)],
        endpoints=endpoints,
        previous_statuses={(endpoint.id, "http"): "degraded"},
    ) == 0

    down = _result(
        endpoint.id,
        HealthCheckStatus.DOWN,
        offset_minutes=3,
        error_message="connection refused",
    )
    assert service.create_transition_notifications(
        results=[down],
        endpoints=endpoints,
        previous_statuses={(endpoint.id, "http"): "degraded"},
    ) == 2
    improved = _result(endpoint.id, HealthCheckStatus.DEGRADED, offset_minutes=4)
    assert service.create_transition_notifications(
        results=[improved],
        endpoints=endpoints,
        previous_statuses={(endpoint.id, "http"): "down"},
    ) == 2
    recovered = _result(endpoint.id, HealthCheckStatus.UP, offset_minutes=5)
    assert service.create_transition_notifications(
        results=[recovered],
        endpoints=endpoints,
        previous_statuses={(endpoint.id, "http"): "degraded"},
    ) == 2
    db_session.commit()

    rows = db_session.query(UserNotification).order_by(UserNotification.id).all()
    assert len(rows) == 8
    assert {row.user_id for row in rows} == {admin.id, superadmin.id}
    assert {row.subject_type for row in rows} == {"endpoint"}
    assert [row.severity for row in rows[::2]] == [
        "warning",
        "error",
        "warning",
        "info",
    ]
    degraded_payload = json.loads(rows[0].payload_json)
    assert degraded_payload["current_status"] == "degraded"
    assert degraded_payload["error_message"] == "access_key=<redacted> timed out"
    assert "AKIA1234567890123456" not in rows[0].message


def test_previous_endpoint_status_uses_latest_raw_check(db_session):
    endpoint = StorageEndpoint(
        name="Previous endpoint",
        endpoint_url="https://previous.example.test",
        provider=StorageProvider.CEPH.value,
        is_default=True,
    )
    db_session.add(endpoint)
    db_session.commit()
    now = utcnow()
    db_session.add_all(
        [
            EndpointHealthCheck(
                storage_endpoint_id=endpoint.id,
                checked_at=now - timedelta(minutes=2),
                http_status=200,
                latency_ms=10,
                check_mode="http",
                status="up",
            ),
            EndpointHealthCheck(
                storage_endpoint_id=endpoint.id,
                checked_at=now - timedelta(minutes=1),
                http_status=503,
                latency_ms=2500,
                check_mode="http",
                status="degraded",
            ),
        ]
    )
    db_session.commit()

    statuses = EndpointHealthNotificationsService(db_session).load_previous_statuses(
        [_result(endpoint.id, HealthCheckStatus.DOWN, offset_minutes=0)]
    )

    assert statuses == {(endpoint.id, "http"): "degraded"}
