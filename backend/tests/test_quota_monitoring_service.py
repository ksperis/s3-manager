# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from datetime import datetime

import pytest
from sqlalchemy.exc import IntegrityError

from app.db import (    QuotaAlertState,
    QuotaUsageDaily,
    QuotaUsageHourly,
    S3Account,
    S3User,
    StorageEndpoint,
    StorageProvider,
    User,
    UserRole,
    UserS3Account,
    UserS3User,
)
from app.models.app_settings import AppSettings
from app.services import quota_monitoring_service
from app.services.quota_monitoring_service import QuotaMonitoringService, SubjectContext


class _FakeAdminClient:
    def __init__(self, *, usage_bytes: int, usage_objects: int, quota_bytes: int, quota_objects: int) -> None:
        self.usage_bytes = usage_bytes
        self.usage_objects = usage_objects
        self.quota_bytes = quota_bytes
        self.quota_objects = quota_objects

    def get_all_buckets(self, **kwargs):
        return {
            "buckets": [
                {
                    "name": "bucket-1",
                    "usage": {
                        "total_bytes": self.usage_bytes,
                        "total_objects": self.usage_objects,
                    },
                }
            ]
        }

    def get_account_quota(self, account_id: str):
        return self.quota_bytes, self.quota_objects

    def get_user_quota(self, uid: str):
        return self.quota_bytes, self.quota_objects


class _FakeMailer:
    def __init__(self) -> None:
        self.calls: list[dict] = []

    def send(self, *, recipients: list[str], subject: str, body: str) -> None:
        self.calls.append(
            {
                "recipients": list(recipients),
                "subject": subject,
                "body": body,
            }
        )


def _settings(*, quota_alerts_enabled: bool, usage_history_enabled: bool) -> AppSettings:
    settings = AppSettings()
    settings.general.quota_alerts_enabled = quota_alerts_enabled
    settings.general.usage_history_enabled = usage_history_enabled
    settings.quota_notifications.threshold_percent = 85
    settings.quota_notifications.include_subject_contact_email = False
    settings.quota_notifications.smtp_host = "smtp.example.test"
    settings.quota_notifications.smtp_from_email = "alerts@example.test"
    settings.quota_notifications.smtp_port = 587
    settings.quota_notifications.smtp_starttls = False
    settings.quota_notifications.smtp_timeout_seconds = 15
    return settings


def _seed_endpoint(db_session, *, name: str = "quota-endpoint") -> StorageEndpoint:
    endpoint = StorageEndpoint(
        name=name,
        endpoint_url="http://quota-rgw.local",
        provider=StorageProvider.CEPH.value,
        is_default=True,
    )
    db_session.add(endpoint)
    db_session.commit()
    db_session.refresh(endpoint)
    return endpoint


def _seed_account(db_session, endpoint: StorageEndpoint, *, name: str = "quota-account") -> S3Account:
    account = S3Account(
        name=name,
        rgw_account_id="RGW12345678901234567",
        rgw_user_uid="quota-account-admin",
        email="account-contact@example.test",
        storage_endpoint_id=endpoint.id,
    )
    db_session.add(account)
    db_session.commit()
    db_session.refresh(account)
    return account


def _seed_s3_user(db_session, endpoint: StorageEndpoint, *, name: str = "quota-s3-user") -> S3User:
    user = S3User(
        name=name,
        rgw_user_uid=f"{name}-uid",
        email="s3-user-contact@example.test",
        rgw_access_key=f"AK-{name}",
        rgw_secret_key=f"SK-{name}",
        storage_endpoint_id=endpoint.id,
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


def _seed_user(
    db_session,
    *,
    email: str,
    role: str = UserRole.UI_USER.value,
    is_active: bool = True,
    quota_alerts_enabled: bool = True,
    quota_alerts_global_watch: bool = False,
) -> User:
    user = User(
        email=email,
        hashed_password="x",
        role=role,
        is_active=is_active,
        quota_alerts_enabled=quota_alerts_enabled,
        quota_alerts_global_watch=quota_alerts_global_watch,
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


def test_run_monitor_skips_when_both_features_disabled(db_session, monkeypatch):
    monkeypatch.setattr(quota_monitoring_service, "load_app_settings", lambda: _settings(quota_alerts_enabled=False, usage_history_enabled=False))
    monkeypatch.setattr(quota_monitoring_service.DataRetentionService, "purge_all", lambda self: {"retention": "ok"})

    service = QuotaMonitoringService(db_session)
    result = service.run_monitor()

    assert result["status"] == "skipped"
    assert result["reason"] == "Both quota_alerts_enabled and usage_history_enabled are disabled."
    assert result["retention"] == {"retention": "ok"}


def test_usage_history_hourly_and_daily_upserts(db_session, monkeypatch):
    endpoint = _seed_endpoint(db_session)
    _seed_account(db_session, endpoint)

    fake_admin = _FakeAdminClient(usage_bytes=50, usage_objects=5, quota_bytes=100, quota_objects=10)
    fixed_now = datetime(2026, 1, 10, 10, 5, 0)

    monkeypatch.setattr(quota_monitoring_service, "utcnow", lambda: fixed_now)
    monkeypatch.setattr(quota_monitoring_service, "load_app_settings", lambda: _settings(quota_alerts_enabled=False, usage_history_enabled=True))
    monkeypatch.setattr(quota_monitoring_service.DataRetentionService, "purge_all", lambda self: {})
    monkeypatch.setattr(QuotaMonitoringService, "_resolve_admin_client", lambda self, endpoint, cache: fake_admin)

    service = QuotaMonitoringService(db_session)
    first = service.run_monitor()
    second = service.run_monitor()

    assert first["history_hourly_upserts"] == 1
    assert first["history_daily_upserts"] == 1
    assert second["history_hourly_upserts"] == 1
    assert second["history_daily_upserts"] == 1

    assert db_session.query(QuotaUsageHourly).count() == 1
    assert db_session.query(QuotaUsageDaily).count() == 1
    daily = db_session.query(QuotaUsageDaily).first()
    assert daily is not None
    assert daily.samples_count == 2
    assert int(daily.last_used_bytes) == 50


def test_alert_crossing_first_run_no_duplicate_and_reset(db_session, monkeypatch):
    endpoint = _seed_endpoint(db_session)
    account = _seed_account(db_session, endpoint)

    recipient = _seed_user(db_session, email="account-admin@example.test")
    db_session.add(
        UserS3Account(
            user_id=recipient.id,
            account_id=account.id,
            account_admin=True,
        )
    )
    db_session.commit()

    fake_admin = _FakeAdminClient(usage_bytes=90, usage_objects=90, quota_bytes=100, quota_objects=100)
    fake_mailer = _FakeMailer()
    fixed_now = datetime(2026, 1, 11, 9, 0, 0)

    monkeypatch.setattr(quota_monitoring_service, "utcnow", lambda: fixed_now)
    monkeypatch.setattr(quota_monitoring_service, "load_app_settings", lambda: _settings(quota_alerts_enabled=True, usage_history_enabled=False))
    monkeypatch.setattr(quota_monitoring_service.DataRetentionService, "purge_all", lambda self: {})
    monkeypatch.setattr(QuotaMonitoringService, "_resolve_admin_client", lambda self, endpoint, cache: fake_admin)
    monkeypatch.setattr(QuotaMonitoringService, "_build_mailer", lambda self, notification_settings: (fake_mailer, None))

    service = QuotaMonitoringService(db_session)

    first = service.run_monitor()  # first run above threshold => immediate alert
    assert first["alerts_triggered"] == 1
    assert first["alerts_sent"] == 1

    second = service.run_monitor()  # still threshold => no duplicate
    assert second["alerts_triggered"] == 0
    assert second["alerts_sent"] == 0

    fake_admin.usage_bytes = 100
    fake_admin.usage_objects = 100
    third = service.run_monitor()  # threshold -> full => alert
    assert third["alerts_triggered"] == 1
    assert third["alerts_sent"] == 1

    fake_admin.usage_bytes = 40
    fake_admin.usage_objects = 40
    fourth = service.run_monitor()  # reset below threshold => no alert
    assert fourth["alerts_triggered"] == 0
    assert fourth["alerts_sent"] == 0

    fake_admin.usage_bytes = 90
    fake_admin.usage_objects = 90
    fifth = service.run_monitor()  # back above threshold after reset => alert again
    assert fifth["alerts_triggered"] == 1
    assert fifth["alerts_sent"] == 1

    assert len(fake_mailer.calls) == 3
    assert fake_mailer.calls[0]["recipients"] == ["account-admin@example.test"]

    state = db_session.query(QuotaAlertState).first()
    assert state is not None
    assert state.last_level == "threshold"


def test_recipient_resolution_for_account_s3_user_and_global_watch(db_session):
    endpoint = _seed_endpoint(db_session)
    account = _seed_account(db_session, endpoint)
    s3_user = _seed_s3_user(db_session, endpoint)

    account_admin = _seed_user(db_session, email="account-admin@example.test")
    account_root = _seed_user(db_session, email="account-root@example.test")
    account_member = _seed_user(db_session, email="account-member@example.test")
    account_disabled = _seed_user(db_session, email="account-disabled@example.test", quota_alerts_enabled=False)
    s3_user_member = _seed_user(db_session, email="s3-user-member@example.test")

    _seed_user(
        db_session,
        email="global-admin@example.test",
        role=UserRole.UI_ADMIN.value,
        quota_alerts_global_watch=True,
    )
    _seed_user(
        db_session,
        email="global-user-ignored@example.test",
        role=UserRole.UI_USER.value,
        quota_alerts_global_watch=True,
    )
    _seed_user(
        db_session,
        email="global-inactive@example.test",
        role=UserRole.UI_SUPERADMIN.value,
        is_active=False,
        quota_alerts_global_watch=True,
    )

    db_session.add_all(
        [
            UserS3Account(
                user_id=account_admin.id,
                account_id=account.id,
                account_admin=True,
            ),
            UserS3Account(
                user_id=account_root.id,
                account_id=account.id,
                is_root=True,
            ),
            UserS3Account(
                user_id=account_member.id,
                account_id=account.id,
            ),
            UserS3Account(
                user_id=account_disabled.id,
                account_id=account.id,
                account_admin=True,
            ),
            UserS3User(
                user_id=s3_user_member.id,
                s3_user_id=s3_user.id,
            ),
        ]
    )
    db_session.commit()

    service = QuotaMonitoringService(db_session)

    account_recipients = service._load_account_recipients()
    s3_user_recipients = service._load_s3_user_recipients()
    global_watch_recipients = service._load_global_watch_recipients()

    account_subject = SubjectContext(
        subject_type="account",
        subject_id=account.id,
        endpoint_id=endpoint.id,
        endpoint_name=endpoint.name,
        subject_name=account.name,
        subject_identifier=account.rgw_account_id,
        usage_uid=account.rgw_user_uid,
        quota_account_id=account.rgw_account_id,
        quota_user_uid=None,
        contact_email=account.email,
    )
    account_resolved = service._resolve_recipients(
        subject=account_subject,
        account_recipients=account_recipients,
        s3_user_recipients=s3_user_recipients,
        global_watch_recipients=global_watch_recipients,
        include_subject_contact=True,
    )

    assert set(account_resolved) == {
        "account-admin@example.test",
        "account-root@example.test",
        "global-admin@example.test",
        "account-contact@example.test",
    }

    s3_user_subject = SubjectContext(
        subject_type="s3_user",
        subject_id=s3_user.id,
        endpoint_id=endpoint.id,
        endpoint_name=endpoint.name,
        subject_name=s3_user.name,
        subject_identifier=s3_user.rgw_user_uid,
        usage_uid=s3_user.rgw_user_uid,
        quota_account_id=None,
        quota_user_uid=s3_user.rgw_user_uid,
        contact_email=s3_user.email,
    )
    s3_user_resolved = service._resolve_recipients(
        subject=s3_user_subject,
        account_recipients=account_recipients,
        s3_user_recipients=s3_user_recipients,
        global_watch_recipients=global_watch_recipients,
        include_subject_contact=False,
    )
    assert set(s3_user_resolved) == {
        "s3-user-member@example.test",
        "global-admin@example.test",
    }


def test_smtp_incomplete_is_non_blocking(db_session, monkeypatch):
    endpoint = _seed_endpoint(db_session)
    account = _seed_account(db_session, endpoint)

    recipient = _seed_user(db_session, email="quota-recipient@example.test")
    db_session.add(
        UserS3Account(
            user_id=recipient.id,
            account_id=account.id,
            account_admin=True,
        )
    )
    db_session.commit()

    settings = _settings(quota_alerts_enabled=True, usage_history_enabled=False)
    settings.quota_notifications.smtp_host = None
    settings.quota_notifications.smtp_from_email = None

    fake_admin = _FakeAdminClient(usage_bytes=90, usage_objects=90, quota_bytes=100, quota_objects=100)

    monkeypatch.setattr(quota_monitoring_service, "load_app_settings", lambda: settings)
    monkeypatch.setattr(quota_monitoring_service.DataRetentionService, "purge_all", lambda self: {})
    monkeypatch.setattr(QuotaMonitoringService, "_resolve_admin_client", lambda self, endpoint, cache: fake_admin)

    service = QuotaMonitoringService(db_session)
    result = service.run_monitor()

    assert result["alerts_triggered"] == 1
    assert result["alerts_sent"] == 0
    assert result["email_errors"] == 1
    assert any("SMTP not configured" in warning for warning in result["warnings"])


def test_quota_history_constraints_prevent_duplicate_subject_rows(db_session):
    endpoint = _seed_endpoint(db_session)
    account = _seed_account(db_session, endpoint)
    now = datetime(2026, 1, 12, 8, 0, 0)

    db_session.add(
        QuotaUsageHourly(
            hour_ts=now,
            storage_endpoint_id=endpoint.id,
            s3_account_id=account.id,
            s3_user_id=None,
            used_bytes=1,
            used_objects=1,
            usage_ratio_pct=1.0,
            collected_at=now,
        )
    )
    db_session.commit()

    db_session.add(
        QuotaUsageHourly(
            hour_ts=now,
            storage_endpoint_id=endpoint.id,
            s3_account_id=account.id,
            s3_user_id=None,
            used_bytes=2,
            used_objects=2,
            usage_ratio_pct=2.0,
            collected_at=now,
        )
    )
    with pytest.raises(IntegrityError):
        db_session.commit()
    db_session.rollback()

    db_session.add(
        QuotaUsageHourly(
            hour_ts=now,
            storage_endpoint_id=endpoint.id,
            s3_account_id=None,
            s3_user_id=None,
            used_bytes=0,
            used_objects=0,
            usage_ratio_pct=None,
            collected_at=now,
        )
    )
    with pytest.raises(IntegrityError):
        db_session.commit()
    db_session.rollback()


def test_smtp_mailer_adds_message_id_and_date_headers(monkeypatch):
    captured: dict[str, object] = {}

    class _FakeSMTP:
        def __init__(self, host: str, port: int, timeout: int):
            captured["host"] = host
            captured["port"] = port
            captured["timeout"] = timeout

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def ehlo(self):
            return None

        def starttls(self):
            return None

        def login(self, username: str, password: str):
            captured["username"] = username
            captured["password"] = password
            return None

        def send_message(self, message):
            captured["message"] = message
            return None

    monkeypatch.setattr(quota_monitoring_service.smtplib, "SMTP", _FakeSMTP)

    mailer = quota_monitoring_service.SMTPMailer(
        host="smtp.example.test",
        port=587,
        username="smtp-user",
        password="smtp-password",
        from_email="alerts@example.test",
        from_name="Quota Alerts",
        starttls=True,
        timeout_seconds=15,
    )
    mailer.send(
        recipients=["recipient@example.test"],
        subject="SMTP header test",
        body="hello",
    )

    message = captured.get("message")
    assert message is not None
    assert message["Message-ID"] is not None
    assert str(message["Message-ID"]).endswith("@example.test>")
    assert message["Date"] is not None
