# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from app.routers import dependencies
from app.services.quota_monitoring_service import QuotaMonitoringService
from app.services.data_retention_service import DataRetentionService


def test_internal_usage_history_collect_uses_daily_history_mode(client, monkeypatch):
    monkeypatch.setattr(dependencies.settings, "internal_cron_token", "expected-token")
    calls: list[dict[str, bool]] = []

    def fake_run_monitor(
        self,
        *,
        include_quota_alerts: bool = True,
        include_usage_history: bool = True,
    ):
        calls.append(
            {
                "include_quota_alerts": include_quota_alerts,
                "include_usage_history": include_usage_history,
            }
        )
        return {
            "subjects_total": 2,
            "subjects_processed": 2,
            "history_hourly_upserts": 2,
            "history_daily_upserts": 2,
            "quota_alerts_enabled": False,
            "usage_history_collection_enabled": True,
        }

    monkeypatch.setattr(QuotaMonitoringService, "run_monitor", fake_run_monitor)

    response = client.post(
        "/api/internal/usage-history/collect",
        headers={"X-Internal-Token": "expected-token"},
    )

    assert response.status_code == 200, response.text
    assert calls == [{"include_quota_alerts": False, "include_usage_history": True}]
    assert response.json()["subjects_processed"] == 2


def test_internal_quota_monitor_does_not_persist_usage_history(client, monkeypatch):
    monkeypatch.setattr(dependencies.settings, "internal_cron_token", "expected-token")
    calls: list[dict[str, bool]] = []

    def fake_run_monitor(
        self,
        *,
        include_quota_alerts: bool = True,
        include_usage_history: bool = True,
    ):
        calls.append(
            {
                "include_quota_alerts": include_quota_alerts,
                "include_usage_history": include_usage_history,
            }
        )
        return {
            "subjects_total": 1,
            "subjects_processed": 1,
            "history_hourly_upserts": 0,
            "history_daily_upserts": 0,
            "quota_alerts_enabled": True,
            "usage_history_collection_enabled": False,
        }

    monkeypatch.setattr(QuotaMonitoringService, "run_monitor", fake_run_monitor)

    response = client.post(
        "/api/internal/quota-monitor/run",
        headers={"X-Internal-Token": "expected-token"},
    )

    assert response.status_code == 200, response.text
    assert calls == [{"include_quota_alerts": True, "include_usage_history": False}]
    assert response.json()["history_hourly_upserts"] == 0


def test_internal_notification_retention_runs_scoped_purge(client, monkeypatch):
    monkeypatch.setattr(dependencies.settings, "internal_cron_token", "expected-token")
    monkeypatch.setattr(
        DataRetentionService,
        "purge_user_notifications",
        lambda self: {
            "user_notifications": {
                "retention_days": 90,
                "deleted": 4,
            }
        },
    )

    response = client.post(
        "/api/internal/notifications/purge",
        headers={"X-Internal-Token": "expected-token"},
    )

    assert response.status_code == 200, response.text
    assert response.json() == {
        "status": "completed",
        "user_notifications": {"retention_days": 90, "deleted": 4},
    }
