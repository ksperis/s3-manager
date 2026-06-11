# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import json
from datetime import date, datetime

from fastapi.testclient import TestClient

from app.db import AuditLog, QuotaUsageDaily, QuotaUsageHourly, S3Account, S3User, StorageEndpoint, StorageProvider
from app.models.app_settings import AppSettings
from app.routers.admin import usage_history as usage_history_router
from app.services import usage_history_service
from app.services.quota_monitoring_service import QuotaMonitoringService


def _settings(*, usage_history_enabled: bool) -> AppSettings:
    settings = AppSettings()
    settings.general.usage_history_enabled = usage_history_enabled
    settings.general.quota_alerts_enabled = True
    return settings


def _seed_endpoint(db_session) -> StorageEndpoint:
    endpoint = StorageEndpoint(
        name="Ceph main",
        endpoint_url="https://rgw.example.test",
        provider=StorageProvider.CEPH.value,
        is_default=True,
    )
    db_session.add(endpoint)
    db_session.commit()
    return endpoint


def test_list_usage_history_daily_records(client: TestClient, db_session, monkeypatch):
    monkeypatch.setattr(usage_history_router, "load_app_settings", lambda: _settings(usage_history_enabled=True))
    endpoint = _seed_endpoint(db_session)
    account = S3Account(
        name="Tenant A",
        rgw_account_id="tenant-a",
        rgw_access_key="ak",
        rgw_secret_key="sk",
        storage_endpoint_id=endpoint.id,
    )
    s3_user = S3User(
        name="Legacy User",
        rgw_user_uid="legacy-user",
        rgw_access_key="uak",
        rgw_secret_key="usk",
        storage_endpoint_id=endpoint.id,
    )
    db_session.add_all([account, s3_user])
    db_session.commit()
    db_session.add_all(
        [
            QuotaUsageDaily(
                day=date(2026, 6, 7),
                storage_endpoint_id=endpoint.id,
                s3_account_id=account.id,
                last_used_bytes=2048,
                last_used_objects=5,
                bucket_count=3,
                max_ratio_pct=50.0,
                samples_count=2,
                updated_at=datetime(2026, 6, 7, 12, 0, 0),
            ),
            QuotaUsageDaily(
                day=date(2026, 6, 7),
                storage_endpoint_id=endpoint.id,
                s3_user_id=s3_user.id,
                last_used_bytes=1024,
                last_used_objects=3,
                bucket_count=1,
                max_ratio_pct=25.0,
                samples_count=1,
                updated_at=datetime(2026, 6, 7, 12, 5, 0),
            ),
        ]
    )
    db_session.commit()

    response = client.get(
        "/api/admin/usage-history",
        params={"granularity": "daily", "subject_type": "account", "start": "2026-06-01", "end": "2026-06-08"},
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["total"] == 1
    assert payload["summary"]["subjects_count"] == 1
    assert payload["summary"]["max_usage_ratio_pct"] == 50.0
    assert payload["items"][0]["subject_name"] == "Tenant A"
    assert payload["items"][0]["subject_identifier"] == "tenant-a"
    assert payload["items"][0]["used_bytes"] == 2048
    assert payload["items"][0]["bucket_count"] == 3
    assert payload["items"][0]["samples_count"] == 2


def test_list_usage_history_requires_enabled_feature(client: TestClient, monkeypatch):
    monkeypatch.setattr(usage_history_router, "load_app_settings", lambda: _settings(usage_history_enabled=False))

    response = client.get("/api/admin/usage-history")

    assert response.status_code == 403
    assert response.json()["detail"] == "Usage history is disabled"


def test_usage_history_trends_aggregate_endpoint_subjects(client: TestClient, db_session, monkeypatch):
    monkeypatch.setattr(usage_history_router, "load_app_settings", lambda: _settings(usage_history_enabled=True))
    monkeypatch.setattr(usage_history_service, "utcnow", lambda: datetime(2026, 6, 9, 12, 0, 0))
    endpoint = _seed_endpoint(db_session)
    other_endpoint = StorageEndpoint(
        name="Ceph other",
        endpoint_url="https://rgw-other.example.test",
        provider=StorageProvider.CEPH.value,
    )
    account = S3Account(
        name="Tenant A",
        rgw_account_id="tenant-a",
        rgw_access_key="ak",
        rgw_secret_key="sk",
        storage_endpoint_id=endpoint.id,
    )
    other_account = S3Account(
        name="Tenant B",
        rgw_account_id="tenant-b",
        rgw_access_key="bk",
        rgw_secret_key="bs",
        storage_endpoint=other_endpoint,
    )
    s3_user = S3User(
        name="Legacy User",
        rgw_user_uid="legacy-user",
        rgw_access_key="uak",
        rgw_secret_key="usk",
        storage_endpoint_id=endpoint.id,
    )
    db_session.add_all([other_endpoint, account, other_account, s3_user])
    db_session.commit()
    db_session.add_all(
        [
            QuotaUsageDaily(
                day=date(2026, 6, 8),
                storage_endpoint_id=endpoint.id,
                s3_account_id=account.id,
                last_used_bytes=2048,
                last_used_objects=5,
                bucket_count=3,
                max_ratio_pct=50.0,
                samples_count=2,
                updated_at=datetime(2026, 6, 8, 12, 0, 0),
            ),
            QuotaUsageDaily(
                day=date(2026, 6, 8),
                storage_endpoint_id=endpoint.id,
                s3_user_id=s3_user.id,
                last_used_bytes=1024,
                last_used_objects=3,
                bucket_count=1,
                max_ratio_pct=25.0,
                samples_count=1,
                updated_at=datetime(2026, 6, 8, 12, 5, 0),
            ),
            QuotaUsageDaily(
                day=date(2026, 6, 8),
                storage_endpoint_id=other_endpoint.id,
                s3_account_id=other_account.id,
                last_used_bytes=8192,
                last_used_objects=9,
                bucket_count=4,
                max_ratio_pct=80.0,
                samples_count=1,
                updated_at=datetime(2026, 6, 8, 12, 10, 0),
            ),
        ]
    )
    db_session.commit()

    response = client.get(
        "/api/admin/usage-history/trends",
        params={"window": "month", "endpoint_id": endpoint.id},
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["window"] == "month"
    assert payload["granularity"] == "daily"
    assert payload["available"] is True
    assert payload["summary"]["subjects_count"] == 2
    assert payload["summary"]["latest_used_bytes"] == 3072
    assert payload["summary"]["max_usage_ratio_pct"] == 50.0
    assert payload["points"] == [
        {
            "period_start": "2026-06-08",
            "used_bytes": 3072,
            "used_objects": 8,
            "bucket_count": 4,
            "max_usage_ratio_pct": 50.0,
            "subjects_count": 2,
            "samples_count": 3,
            "collected_at": "2026-06-08T12:05:00",
        }
    ]


def test_usage_history_trends_require_enabled_feature(client: TestClient, monkeypatch):
    monkeypatch.setattr(usage_history_router, "load_app_settings", lambda: _settings(usage_history_enabled=False))

    response = client.get("/api/admin/usage-history/trends")

    assert response.status_code == 403
    assert response.json()["detail"] == "Usage history is disabled"


def test_collect_usage_history_runs_without_quota_alerts_and_audits(client: TestClient, db_session, monkeypatch):
    monkeypatch.setattr(usage_history_router, "load_app_settings", lambda: _settings(usage_history_enabled=True))
    calls: list[dict[str, bool]] = []

    def fake_run_monitor(self, *, include_quota_alerts: bool = True, include_usage_history: bool = True):
        calls.append(
            {
                "include_quota_alerts": include_quota_alerts,
                "include_usage_history": include_usage_history,
            }
        )
        return {
            "subjects_total": 1,
            "subjects_processed": 1,
            "history_hourly_upserts": 1,
            "history_daily_upserts": 1,
            "errors": [],
        }

    monkeypatch.setattr(QuotaMonitoringService, "run_monitor", fake_run_monitor)

    response = client.post("/api/admin/usage-history/collect")

    assert response.status_code == 200, response.text
    assert calls == [{"include_quota_alerts": False, "include_usage_history": True}]
    payload = response.json()
    assert payload["subjects_processed"] == 1
    audit = db_session.query(AuditLog).filter(AuditLog.action == "collect_usage_history").one()
    metadata = json.loads(audit.metadata_json or "{}")
    assert audit.scope == "admin"
    assert metadata["history_hourly_upserts"] == 1
    assert metadata["manual_trigger"] is True


def test_list_usage_history_hourly_records_include_quota(client: TestClient, db_session, monkeypatch):
    monkeypatch.setattr(usage_history_router, "load_app_settings", lambda: _settings(usage_history_enabled=True))
    endpoint = _seed_endpoint(db_session)
    s3_user = S3User(
        name="Legacy User",
        rgw_user_uid="legacy-user",
        rgw_access_key="uak",
        rgw_secret_key="usk",
        storage_endpoint_id=endpoint.id,
    )
    db_session.add(s3_user)
    db_session.commit()
    db_session.add(
        QuotaUsageHourly(
            hour_ts=datetime(2026, 6, 8, 10, 0, 0),
            storage_endpoint_id=endpoint.id,
            s3_user_id=s3_user.id,
            used_bytes=4096,
            used_objects=7,
            bucket_count=2,
            quota_size_bytes=8192,
            quota_objects=10,
            usage_ratio_pct=70.0,
            collected_at=datetime(2026, 6, 8, 10, 5, 0),
        )
    )
    db_session.commit()

    response = client.get(
        "/api/admin/usage-history",
        params={"granularity": "hourly", "subject_type": "s3_user", "start": "2026-06-08", "end": "2026-06-08"},
    )

    assert response.status_code == 200, response.text
    item = response.json()["items"][0]
    assert item["subject_name"] == "Legacy User"
    assert item["subject_identifier"] == "legacy-user"
    assert item["bucket_count"] == 2
    assert item["quota_size_bytes"] == 8192
    assert item["usage_ratio_pct"] == 70.0
