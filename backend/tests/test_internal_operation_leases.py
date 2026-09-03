# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from app.routers import dependencies
from app.services.billing_collection_service import BillingCollector
from app.services.healthcheck_service import HealthCheckService
from app.services.operation_lease_service import (
    HEALTHCHECK_RUN_OPERATION,
    QUOTA_MONITOR_ALERTS_OPERATION,
    USAGE_HISTORY_COLLECT_OPERATION,
    USER_NOTIFICATIONS_PURGE_OPERATION,
    OperationLeaseService,
    billing_daily_operation_name,
)
from app.services.quota_monitoring_service import QuotaMonitoringService


def _set_token(monkeypatch) -> None:
    monkeypatch.setattr(dependencies.settings, "internal_cron_token", "expected-token")


def test_internal_billing_collect_skips_when_lease_is_active(client, db_session, monkeypatch):
    _set_token(monkeypatch)
    OperationLeaseService(db_session).acquire(
        billing_daily_operation_name("2026-07-03"),
        ttl_seconds=600,
        owner="other-backend",
    )
    monkeypatch.setattr(BillingCollector, "collect_daily", lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError()))

    response = client.post(
        "/api/internal/billing/collect/daily?day=2026-07-03",
        headers={"X-Internal-Token": "expected-token"},
    )

    assert response.status_code == 200, response.text
    assert response.json() == {
        "status": "skipped",
        "reason": "already_running",
        "operation": "billing:daily:2026-07-03",
    }


def test_internal_billing_collect_rejects_invalid_day(client, monkeypatch):
    _set_token(monkeypatch)

    response = client.post(
        "/api/internal/billing/collect/daily?day=2026-02-30",
        headers={"X-Internal-Token": "expected-token"},
    )

    assert response.status_code == 400, response.text
    assert response.json()["detail"] == "Invalid day format, expected YYYY-MM-DD"


def test_internal_healthchecks_skip_when_lease_is_active(client, db_session, monkeypatch):
    _set_token(monkeypatch)
    OperationLeaseService(db_session).acquire(
        HEALTHCHECK_RUN_OPERATION,
        ttl_seconds=600,
        owner="other-backend",
    )
    monkeypatch.setattr(HealthCheckService, "run_checks", lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError()))

    response = client.post(
        "/api/internal/healthchecks/run",
        headers={"X-Internal-Token": "expected-token"},
    )

    assert response.status_code == 200, response.text
    assert response.json()["status"] == "skipped"
    assert response.json()["operation"] == HEALTHCHECK_RUN_OPERATION


def test_internal_quota_monitor_skips_when_lease_is_active(client, db_session, monkeypatch):
    _set_token(monkeypatch)
    OperationLeaseService(db_session).acquire(
        QUOTA_MONITOR_ALERTS_OPERATION,
        ttl_seconds=600,
        owner="other-backend",
    )
    monkeypatch.setattr(QuotaMonitoringService, "run_monitor", lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError()))

    response = client.post(
        "/api/internal/quota-monitor/run",
        headers={"X-Internal-Token": "expected-token"},
    )

    assert response.status_code == 200, response.text
    assert response.json()["status"] == "skipped"
    assert response.json()["operation"] == QUOTA_MONITOR_ALERTS_OPERATION


def test_internal_usage_history_skips_when_lease_is_active(client, db_session, monkeypatch):
    _set_token(monkeypatch)
    OperationLeaseService(db_session).acquire(
        USAGE_HISTORY_COLLECT_OPERATION,
        ttl_seconds=600,
        owner="other-backend",
    )
    monkeypatch.setattr(QuotaMonitoringService, "run_monitor", lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError()))

    response = client.post(
        "/api/internal/usage-history/collect",
        headers={"X-Internal-Token": "expected-token"},
    )

    assert response.status_code == 200, response.text
    assert response.json()["status"] == "skipped"
    assert response.json()["operation"] == USAGE_HISTORY_COLLECT_OPERATION


def test_internal_notification_purge_skips_when_lease_is_active(
    client,
    db_session,
    monkeypatch,
):
    _set_token(monkeypatch)
    OperationLeaseService(db_session).acquire(
        USER_NOTIFICATIONS_PURGE_OPERATION,
        ttl_seconds=600,
        owner="other-backend",
    )

    response = client.post(
        "/api/internal/notifications/purge",
        headers={"X-Internal-Token": "expected-token"},
    )

    assert response.status_code == 200, response.text
    assert response.json() == {
        "status": "skipped",
        "reason": "already_running",
        "operation": USER_NOTIFICATIONS_PURGE_OPERATION,
    }
