# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from datetime import date

from app.db import (
    BillingStorageDaily,
    BillingUsageDaily,
    EndpointHealthLatest,
    EndpointHealthRollup,
    HealthCheckStatus,
    QuotaUsageDaily,
    QuotaUsageHourly,
    UserNotification,
)
from app.services.billing_service import BillingCollector
from app.services.healthcheck_service import (
    DEFAULT_ROLLUP_RESOLUTION_SECONDS,
    HealthCheckResult,
    HealthCheckService,
)
from app.services.quota_monitoring_service import QuotaMonitoringService, SubjectContext
from app.services.user_notifications_service import UserNotificationsService
from app.utils.time import utcnow


def _subject() -> SubjectContext:
    return SubjectContext(
        subject_type="account",
        subject_id=42,
        endpoint_id=7,
        endpoint_name="ceph",
        subject_name="account",
        subject_identifier="account",
        usage_uid="account",
        quota_account_id="account",
        quota_user_uid=None,
        contact_email=None,
    )


def test_quota_usage_history_upserts_keep_one_row(db_session):
    service = QuotaMonitoringService(db_session)
    now = utcnow()
    subject = _subject()

    service._upsert_hourly(subject, 10, 1, 1, 100, 10, 10.0, now)
    service._upsert_hourly(subject, 20, 2, 2, 100, 10, 20.0, now)
    service._upsert_daily(subject, 10, 1, 1, 10.0, now)
    service._upsert_daily(subject, 20, 2, 2, 20.0, now)
    db_session.commit()

    hourly = db_session.query(QuotaUsageHourly).one()
    daily = db_session.query(QuotaUsageDaily).one()
    assert hourly.used_bytes == 20
    assert hourly.bucket_count == 2
    assert daily.last_used_bytes == 20
    assert daily.samples_count == 2


def test_user_quota_notifications_are_idempotent_per_event_key(db_session):
    service = UserNotificationsService(db_session)
    now = utcnow()

    first = service.create_quota_alert_notifications(
        user_ids=[1],
        subject_type="account",
        subject_id=42,
        storage_endpoint_id=7,
        event_key="quota:account:42:threshold",
        title="Quota warning",
        message="Usage exceeded threshold.",
        severity="warning",
        payload={"ratio": 90},
        created_at=now,
    )
    second = service.create_quota_alert_notifications(
        user_ids=[1],
        subject_type="account",
        subject_id=42,
        storage_endpoint_id=7,
        event_key="quota:account:42:threshold",
        title="Quota warning",
        message="Usage exceeded threshold.",
        severity="warning",
        payload={"ratio": 90},
        created_at=now,
    )
    db_session.commit()

    assert first == 1
    assert second == 0
    assert db_session.query(UserNotification).count() == 1


def test_billing_daily_upserts_keep_one_row(db_session):
    collector = BillingCollector(db_session)
    day = date(2026, 7, 3)

    collector._upsert_usage(
        day=day,
        endpoint_id=7,
        s3_account_id=42,
        s3_user_id=None,
        bytes_in=1,
        bytes_out=2,
        ops_total=3,
        ops_breakdown={"get": 3},
    )
    collector._upsert_usage(
        day=day,
        endpoint_id=7,
        s3_account_id=42,
        s3_user_id=None,
        bytes_in=10,
        bytes_out=20,
        ops_total=30,
        ops_breakdown={"get": 30},
    )
    collector._upsert_storage(
        day=day,
        endpoint_id=7,
        s3_account_id=42,
        s3_user_id=None,
        total_bytes=100,
        total_objects=1,
        by_bucket=None,
    )
    collector._upsert_storage(
        day=day,
        endpoint_id=7,
        s3_account_id=42,
        s3_user_id=None,
        total_bytes=200,
        total_objects=2,
        by_bucket=None,
    )

    usage = db_session.query(BillingUsageDaily).one()
    storage = db_session.query(BillingStorageDaily).one()
    assert usage.bytes_in == 10
    assert usage.ops_total == 30
    assert storage.total_bytes == 200
    assert storage.total_objects == 2


def test_health_latest_and_rollup_upserts_keep_one_row(db_session):
    service = HealthCheckService(db_session)
    checked_at = utcnow()
    first = HealthCheckResult(
        endpoint_id=7,
        status=HealthCheckStatus.UP,
        checked_at=checked_at,
        latency_ms=12,
        http_status=200,
        error_message=None,
        check_mode="http",
    )
    second = HealthCheckResult(
        endpoint_id=7,
        status=HealthCheckStatus.DEGRADED,
        checked_at=checked_at,
        latency_ms=1200,
        http_status=503,
        error_message=None,
        check_mode="http",
    )

    service._update_latest_entry(first)
    service._update_latest_entry(second)
    service._update_rollup_bucket(first, DEFAULT_ROLLUP_RESOLUTION_SECONDS)
    service._update_rollup_bucket(second, DEFAULT_ROLLUP_RESOLUTION_SECONDS)
    db_session.commit()

    latest = db_session.query(EndpointHealthLatest).one()
    rollup = db_session.query(EndpointHealthRollup).one()
    assert latest.status == HealthCheckStatus.DEGRADED.value
    assert latest.latency_ms == 1200
    assert rollup.bucket_start == service._bucket_start(checked_at, DEFAULT_ROLLUP_RESOLUTION_SECONDS)
