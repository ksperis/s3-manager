# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from datetime import datetime
import logging
from typing import Optional

from app.core.config import get_settings
from app.models.app_settings import QuotaNotificationSettings
from app.services import smtp_mailer
from app.services.quota_alert_recipients_service import normalize_email
from app.services.quota_subject import SubjectContext
from app.utils.time import utcnow


logger = logging.getLogger(__name__)


class QuotaAlertEmailService:
    """Configure and deliver quota alert and SMTP test messages."""

    def __init__(self) -> None:
        self.smtp_password = (
            get_settings().smtp_password or ""
        ).strip() or None

    def build_mailer(
        self,
        notification_settings: QuotaNotificationSettings,
    ) -> tuple[Optional[smtp_mailer.SMTPMailer], Optional[str]]:
        host = (notification_settings.smtp_host or "").strip()
        from_email = (
            notification_settings.smtp_from_email or ""
        ).strip()
        username = (
            notification_settings.smtp_username or ""
        ).strip() or None

        if not host or not from_email:
            return (
                None,
                "SMTP not configured: smtp_host and smtp_from_email are "
                "required for quota notifications.",
            )
        if self.smtp_password and not username:
            return (
                None,
                "SMTP configuration invalid: SMTP_PASSWORD is set but "
                "smtp_username is empty.",
            )

        return (
            smtp_mailer.SMTPMailer(
                host=host,
                port=int(notification_settings.smtp_port),
                username=username,
                password=self.smtp_password,
                from_email=from_email,
                from_name=notification_settings.smtp_from_name,
                starttls=bool(notification_settings.smtp_starttls),
                timeout_seconds=int(
                    notification_settings.smtp_timeout_seconds
                ),
            ),
            None,
        )

    def send_test_email(
        self,
        *,
        notification_settings: QuotaNotificationSettings,
        recipient_email: Optional[str],
    ) -> dict[str, str]:
        recipient = normalize_email(recipient_email)
        if not recipient:
            raise ValueError(
                "Current user email is required to send a test email."
            )

        mailer, reason = self.build_mailer(notification_settings)
        if mailer is None:
            raise ValueError(
                reason or "SMTP not configured for quota notifications."
            )

        checked_at = utcnow()
        subject = "[Quota TEST] SMTP configuration"
        body = (
            "This is a test email for quota notifications SMTP "
            "configuration.\n\n"
            f"Threshold percent: "
            f"{int(notification_settings.threshold_percent)}\n"
            f"SMTP host: "
            f"{(notification_settings.smtp_host or '').strip() or 'n/a'}\n"
            f"SMTP port: {int(notification_settings.smtp_port)}\n"
            f"STARTTLS: "
            f"{'enabled' if notification_settings.smtp_starttls else 'disabled'}\n"
            f"Sent at (UTC): {checked_at.isoformat()}\n"
        )
        try:
            mailer.send(
                recipients=[recipient],
                subject=subject,
                body=body,
            )
        except Exception as exc:
            raise ValueError(f"Unable to send test email: {exc}") from exc

        return {
            "status": "sent",
            "recipient": recipient,
            "sent_at": checked_at.isoformat(),
        }

    @staticmethod
    def send_alert_email(
        *,
        mailer: Optional[smtp_mailer.SMTPMailer],
        recipients: list[str],
        subject: SubjectContext,
        alert_level: str,
        ratio_pct: Optional[float],
        threshold_percent: int,
        used_bytes: int,
        used_objects: int,
        quota_size_bytes: Optional[int],
        quota_objects: Optional[int],
        checked_at: datetime,
    ) -> bool:
        if mailer is None:
            return False
        ratio_display = (
            f"{ratio_pct:.3f}" if ratio_pct is not None else "n/a"
        )
        email_subject = (
            f"[Quota {alert_level.upper()}] "
            f"{subject.subject_type}:{subject.subject_name}"
        )
        body = (
            f"Quota alert level: {alert_level}\n"
            f"Subject type: {subject.subject_type}\n"
            f"Subject: {subject.subject_name}\n"
            f"Identifier: {subject.subject_identifier}\n"
            f"Endpoint: {subject.endpoint_name}\n"
            f"Threshold percent: {threshold_percent}\n"
            f"Usage ratio (%): {ratio_display}\n"
            f"Used bytes: {used_bytes}\n"
            f"Quota bytes: "
            f"{quota_size_bytes if quota_size_bytes is not None else 'unlimited'}\n"
            f"Used objects: {used_objects}\n"
            f"Quota objects: "
            f"{quota_objects if quota_objects is not None else 'unlimited'}\n"
            f"Checked at (UTC): {checked_at.isoformat()}\n"
        )
        try:
            mailer.send(
                recipients=recipients,
                subject=email_subject,
                body=body,
            )
            return True
        except Exception as exc:  # pragma: no cover - network side effect
            logger.warning(
                "Unable to send quota alert email for %s:%s to %s "
                "recipients: %s",
                subject.subject_type,
                subject.subject_id,
                len(recipients),
                exc,
            )
            return False
