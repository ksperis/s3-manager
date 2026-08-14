# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from datetime import UTC, datetime

from app.models.app_settings import QuotaNotificationSettings
from app.services import quota_alert_email_service
from app.services.quota_alert_email_service import QuotaAlertEmailService


class _FakeMailer:
    def __init__(self) -> None:
        self.calls: list[dict[str, object]] = []

    def send(
        self,
        *,
        recipients: list[str],
        subject: str,
        body: str,
    ) -> None:
        self.calls.append(
            {
                "recipients": recipients,
                "subject": subject,
                "body": body,
            }
        )


def _settings(**overrides) -> QuotaNotificationSettings:
    values = {
        "smtp_host": "smtp.example.test",
        "smtp_port": 587,
        "smtp_username": "smtp-user",
        "smtp_from_email": "alerts@example.test",
        "smtp_from_name": "Quota Alerts",
        "smtp_starttls": True,
        "smtp_timeout_seconds": 15,
    }
    values.update(overrides)
    return QuotaNotificationSettings(**values)


def test_build_mailer_requires_username_for_environment_password():
    service = QuotaAlertEmailService()
    service.smtp_password = "secret"

    mailer, reason = service.build_mailer(
        _settings(smtp_username=None)
    )

    assert mailer is None
    assert reason == (
        "SMTP configuration invalid: SMTP_PASSWORD is set but "
        "smtp_username is empty."
    )


def test_send_test_email_normalizes_recipient_and_reports_timestamp(
    monkeypatch,
):
    service = QuotaAlertEmailService()
    fake_mailer = _FakeMailer()
    fixed_now = datetime(2026, 8, 14, 17, 0, tzinfo=UTC)
    monkeypatch.setattr(
        service,
        "build_mailer",
        lambda notification_settings: (fake_mailer, None),
    )
    monkeypatch.setattr(
        quota_alert_email_service,
        "utcnow",
        lambda: fixed_now,
    )

    result = service.send_test_email(
        notification_settings=_settings(),
        recipient_email=" Admin@Example.Test ",
    )

    assert result == {
        "status": "sent",
        "recipient": "admin@example.test",
        "sent_at": "2026-08-14T17:00:00+00:00",
    }
    assert fake_mailer.calls[0]["recipients"] == [
        "admin@example.test"
    ]
    assert "SMTP configuration" in str(fake_mailer.calls[0]["subject"])
