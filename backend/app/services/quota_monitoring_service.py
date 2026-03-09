# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from app.utils.time import utcnow

from dataclasses import dataclass
from datetime import datetime
from email.message import EmailMessage
from email.utils import formatdate, make_msgid
import logging
import smtplib
from typing import Any, Optional

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db import (
    AccountRole,
    QuotaAlertState,
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
from app.models.app_settings import QuotaNotificationSettings
from app.services.app_settings_service import load_app_settings
from app.services.data_retention_service import DataRetentionService
from app.services.rgw_admin import RGWAdminClient, RGWAdminError, get_rgw_admin_client
from app.utils.rgw import extract_bucket_list, resolve_admin_uid
from app.utils.storage_endpoint_features import resolve_admin_endpoint
from app.utils.usage_stats import extract_usage_stats

logger = logging.getLogger(__name__)
runtime_settings = get_settings()


@dataclass
class SubjectContext:
    subject_type: str
    subject_id: int
    endpoint_id: int
    endpoint_name: str
    subject_name: str
    subject_identifier: str
    usage_uid: Optional[str]
    quota_account_id: Optional[str]
    quota_user_uid: Optional[str]
    contact_email: Optional[str]


class SMTPMailer:
    def __init__(
        self,
        *,
        host: str,
        port: int,
        username: Optional[str],
        password: Optional[str],
        from_email: str,
        from_name: Optional[str],
        starttls: bool,
        timeout_seconds: int,
    ) -> None:
        self.host = host
        self.port = port
        self.username = username
        self.password = password
        self.from_email = from_email
        self.from_name = from_name
        self.starttls = starttls
        self.timeout_seconds = timeout_seconds

    def send(self, *, recipients: list[str], subject: str, body: str) -> None:
        if not recipients:
            return
        message = EmailMessage()
        message["To"] = ", ".join(recipients)
        message["From"] = f"{self.from_name} <{self.from_email}>" if self.from_name else self.from_email
        message["Subject"] = subject
        # Some receivers (including Gmail) reject RFC-non-compliant mails
        # when Message-ID is missing.
        message["Message-ID"] = make_msgid(domain=self._message_id_domain())
        message["Date"] = formatdate(localtime=True)
        message.set_content(body)

        with smtplib.SMTP(self.host, self.port, timeout=self.timeout_seconds) as smtp:
            smtp.ehlo()
            if self.starttls:
                smtp.starttls()
                smtp.ehlo()
            if self.username or self.password:
                smtp.login(self.username or "", self.password or "")
            smtp.send_message(message)

    def _message_id_domain(self) -> str:
        sender = (self.from_email or "").strip()
        if "@" not in sender:
            return "localhost"
        domain = sender.rsplit("@", 1)[1].strip()
        return domain or "localhost"


class QuotaMonitoringService:
    _LEVEL_NORMAL = "normal"
    _LEVEL_THRESHOLD = "threshold"
    _LEVEL_FULL = "full"
    _LEVEL_ORDER = {
        _LEVEL_NORMAL: 0,
        _LEVEL_THRESHOLD: 1,
        _LEVEL_FULL: 2,
    }

    def __init__(self, db: Session) -> None:
        self.db = db
        self._mail_error_reason: Optional[str] = None
        self._mailer: Optional[SMTPMailer] = None

    def run_monitor(self) -> dict[str, Any]:
        app_settings = load_app_settings()
        now = utcnow()
        summary: dict[str, Any] = {
            "started_at": now.isoformat(),
            "subjects_total": 0,
            "subjects_processed": 0,
            "history_hourly_upserts": 0,
            "history_daily_upserts": 0,
            "alerts_triggered": 0,
            "alerts_sent": 0,
            "email_errors": 0,
            "errors": [],
            "warnings": [],
            "quota_alerts_enabled": bool(app_settings.general.quota_alerts_enabled),
            "usage_history_enabled": bool(app_settings.general.usage_history_enabled),
            "threshold_percent": int(app_settings.quota_notifications.threshold_percent),
        }

        if not app_settings.general.quota_alerts_enabled and not app_settings.general.usage_history_enabled:
            summary["status"] = "skipped"
            summary["reason"] = "Both quota_alerts_enabled and usage_history_enabled are disabled."
            summary["retention"] = DataRetentionService(self.db).purge_all()
            summary["finished_at"] = utcnow().isoformat()
            return summary

        endpoint_map = {endpoint.id: endpoint for endpoint in self.db.query(StorageEndpoint).all()}
        default_endpoint = (
            self.db.query(StorageEndpoint)
            .filter(StorageEndpoint.is_default.is_(True))
            .order_by(StorageEndpoint.id.asc())
            .first()
        )
        default_endpoint_id = default_endpoint.id if default_endpoint else None

        subjects = self._load_subjects(endpoint_map=endpoint_map, default_endpoint_id=default_endpoint_id)
        summary["subjects_total"] = len(subjects)

        account_recipients = self._load_account_recipients()
        s3_user_recipients = self._load_s3_user_recipients()
        global_watch_recipients = self._load_global_watch_recipients()
        states = self._load_alert_states()
        admin_clients: dict[int, Optional[RGWAdminClient]] = {}

        if app_settings.general.quota_alerts_enabled:
            self._mailer, self._mail_error_reason = self._build_mailer(app_settings.quota_notifications)
            if not self._mailer and self._mail_error_reason:
                summary["warnings"].append(self._mail_error_reason)

        for subject in subjects:
            endpoint = endpoint_map.get(subject.endpoint_id)
            if not endpoint:
                summary["errors"].append(
                    {
                        "subject_type": subject.subject_type,
                        "subject_id": subject.subject_id,
                        "error": f"Storage endpoint id={subject.endpoint_id} not found.",
                    }
                )
                continue

            admin_client = self._resolve_admin_client(endpoint, admin_clients)
            if not admin_client:
                summary["errors"].append(
                    {
                        "subject_type": subject.subject_type,
                        "subject_id": subject.subject_id,
                        "error": f"Admin client unavailable for endpoint '{subject.endpoint_name}'.",
                    }
                )
                continue

            try:
                usage_bytes, usage_objects = self._collect_usage(admin_client, subject.usage_uid)
            except Exception as exc:  # pragma: no cover - defensive logging
                logger.warning("Quota monitor usage collection failed for %s:%s: %s", subject.subject_type, subject.subject_id, exc)
                summary["errors"].append(
                    {
                        "subject_type": subject.subject_type,
                        "subject_id": subject.subject_id,
                        "error": f"Usage collection failed: {exc}",
                    }
                )
                continue

            quota_size_bytes = None
            quota_objects = None
            try:
                quota_size_bytes, quota_objects = self._collect_quota(admin_client, subject)
            except Exception as exc:  # pragma: no cover - defensive logging
                logger.warning("Quota monitor quota collection failed for %s:%s: %s", subject.subject_type, subject.subject_id, exc)
                summary["errors"].append(
                    {
                        "subject_type": subject.subject_type,
                        "subject_id": subject.subject_id,
                        "error": f"Quota collection failed: {exc}",
                    }
                )

            ratio_pct = self._compute_usage_ratio(
                used_bytes=usage_bytes,
                used_objects=usage_objects,
                quota_size_bytes=quota_size_bytes,
                quota_objects=quota_objects,
            )

            if app_settings.general.usage_history_enabled:
                self._upsert_hourly(subject, usage_bytes, usage_objects, quota_size_bytes, quota_objects, ratio_pct, now)
                summary["history_hourly_upserts"] += 1
                self._upsert_daily(subject, usage_bytes, usage_objects, ratio_pct, now)
                summary["history_daily_upserts"] += 1

            if app_settings.general.quota_alerts_enabled:
                should_alert, next_level = self._update_state_and_check_alert(
                    subject=subject,
                    states=states,
                    ratio_pct=ratio_pct,
                    threshold_percent=int(app_settings.quota_notifications.threshold_percent),
                    now=now,
                )
                if should_alert and next_level in {self._LEVEL_THRESHOLD, self._LEVEL_FULL}:
                    summary["alerts_triggered"] += 1
                    recipients = self._resolve_recipients(
                        subject=subject,
                        account_recipients=account_recipients,
                        s3_user_recipients=s3_user_recipients,
                        global_watch_recipients=global_watch_recipients,
                        include_subject_contact=bool(app_settings.quota_notifications.include_subject_contact_email),
                    )
                    if recipients:
                        sent = self._send_quota_alert_email(
                            recipients=recipients,
                            subject=subject,
                            alert_level=next_level,
                            ratio_pct=ratio_pct,
                            threshold_percent=int(app_settings.quota_notifications.threshold_percent),
                            used_bytes=usage_bytes,
                            used_objects=usage_objects,
                            quota_size_bytes=quota_size_bytes,
                            quota_objects=quota_objects,
                            checked_at=now,
                        )
                        if sent:
                            summary["alerts_sent"] += 1
                        else:
                            summary["email_errors"] += 1
                    else:
                        summary["email_errors"] += 1
                        summary["warnings"].append(
                            f"No recipients found for {subject.subject_type}:{subject.subject_id} alert."
                        )

            summary["subjects_processed"] += 1

        self.db.commit()
        summary["retention"] = DataRetentionService(self.db).purge_all()
        summary["finished_at"] = utcnow().isoformat()
        return summary

    def send_test_email(
        self,
        *,
        notification_settings: QuotaNotificationSettings,
        recipient_email: Optional[str],
    ) -> dict[str, Any]:
        recipient = self._normalize_email(recipient_email)
        if not recipient:
            raise ValueError("Current user email is required to send a test email.")

        mailer, reason = self._build_mailer(notification_settings)
        if not mailer:
            raise ValueError(reason or "SMTP not configured for quota notifications.")

        checked_at = utcnow()
        subject = "[Quota TEST] SMTP configuration"
        body = (
            "This is a test email for quota notifications SMTP configuration.\n\n"
            f"Threshold percent: {int(notification_settings.threshold_percent)}\n"
            f"SMTP host: {(notification_settings.smtp_host or '').strip() or 'n/a'}\n"
            f"SMTP port: {int(notification_settings.smtp_port)}\n"
            f"STARTTLS: {'enabled' if bool(notification_settings.smtp_starttls) else 'disabled'}\n"
            f"Sent at (UTC): {checked_at.isoformat()}\n"
        )
        try:
            mailer.send(recipients=[recipient], subject=subject, body=body)
        except Exception as exc:
            raise ValueError(f"Unable to send test email: {exc}") from exc

        return {
            "status": "sent",
            "recipient": recipient,
            "sent_at": checked_at.isoformat(),
        }

    def _load_subjects(
        self,
        *,
        endpoint_map: dict[int, StorageEndpoint],
        default_endpoint_id: Optional[int],
    ) -> list[SubjectContext]:
        subjects: list[SubjectContext] = []

        accounts = self.db.query(S3Account).all()
        for account in accounts:
            endpoint_id = account.storage_endpoint_id or default_endpoint_id
            if endpoint_id is None:
                continue
            endpoint = endpoint_map.get(endpoint_id)
            if not endpoint:
                continue
            usage_uid = resolve_admin_uid(account.rgw_account_id, account.rgw_user_uid)
            subject_identifier = account.rgw_account_id or account.rgw_user_uid or str(account.id)
            subjects.append(
                SubjectContext(
                    subject_type="account",
                    subject_id=account.id,
                    endpoint_id=endpoint_id,
                    endpoint_name=endpoint.name,
                    subject_name=account.name,
                    subject_identifier=subject_identifier,
                    usage_uid=usage_uid,
                    quota_account_id=account.rgw_account_id,
                    quota_user_uid=None,
                    contact_email=account.email,
                )
            )

        s3_users = self.db.query(S3User).all()
        for s3_user in s3_users:
            endpoint_id = s3_user.storage_endpoint_id or default_endpoint_id
            if endpoint_id is None:
                continue
            endpoint = endpoint_map.get(endpoint_id)
            if not endpoint:
                continue
            subjects.append(
                SubjectContext(
                    subject_type="s3_user",
                    subject_id=s3_user.id,
                    endpoint_id=endpoint_id,
                    endpoint_name=endpoint.name,
                    subject_name=s3_user.name,
                    subject_identifier=s3_user.rgw_user_uid,
                    usage_uid=s3_user.rgw_user_uid,
                    quota_account_id=None,
                    quota_user_uid=s3_user.rgw_user_uid,
                    contact_email=s3_user.email,
                )
            )
        return subjects

    def _resolve_admin_client(
        self,
        endpoint: StorageEndpoint,
        cache: dict[int, Optional[RGWAdminClient]],
    ) -> Optional[RGWAdminClient]:
        cached = cache.get(endpoint.id)
        if endpoint.id in cache:
            return cached
        provider = str(endpoint.provider or "").strip().lower()
        if provider != StorageProvider.CEPH.value:
            cache[endpoint.id] = None
            return None
        admin_endpoint = resolve_admin_endpoint(endpoint)
        if not admin_endpoint or not endpoint.admin_access_key or not endpoint.admin_secret_key:
            cache[endpoint.id] = None
            return None
        try:
            client = get_rgw_admin_client(
                access_key=endpoint.admin_access_key,
                secret_key=endpoint.admin_secret_key,
                endpoint=admin_endpoint,
                region=endpoint.region,
                verify_tls=bool(getattr(endpoint, "verify_tls", True)),
            )
        except Exception:
            client = None
        cache[endpoint.id] = client
        return client

    def _collect_usage(self, admin: RGWAdminClient, usage_uid: Optional[str]) -> tuple[int, int]:
        if not usage_uid:
            return 0, 0
        payload = admin.get_all_buckets(uid=usage_uid, with_stats=True)
        buckets = extract_bucket_list(payload)
        total_bytes = 0
        total_objects = 0
        for bucket in buckets:
            if not isinstance(bucket, dict):
                continue
            used_bytes, used_objects = extract_usage_stats(bucket.get("usage"))
            total_bytes += int(used_bytes or 0)
            total_objects += int(used_objects or 0)
        return total_bytes, total_objects

    def _collect_quota(
        self,
        admin: RGWAdminClient,
        subject: SubjectContext,
    ) -> tuple[Optional[int], Optional[int]]:
        if subject.subject_type == "account":
            if not subject.quota_account_id:
                return None, None
            return admin.get_account_quota(subject.quota_account_id)
        if not subject.quota_user_uid:
            return None, None
        return admin.get_user_quota(subject.quota_user_uid)

    def _compute_usage_ratio(
        self,
        *,
        used_bytes: int,
        used_objects: int,
        quota_size_bytes: Optional[int],
        quota_objects: Optional[int],
    ) -> Optional[float]:
        ratios: list[float] = []
        if quota_size_bytes and quota_size_bytes > 0:
            ratios.append((float(used_bytes) / float(quota_size_bytes)) * 100.0)
        if quota_objects and quota_objects > 0:
            ratios.append((float(used_objects) / float(quota_objects)) * 100.0)
        if not ratios:
            return None
        return round(max(ratios), 3)

    def _hour_floor(self, value: datetime) -> datetime:
        return value.replace(minute=0, second=0, microsecond=0)

    def _upsert_hourly(
        self,
        subject: SubjectContext,
        used_bytes: int,
        used_objects: int,
        quota_size_bytes: Optional[int],
        quota_objects: Optional[int],
        ratio_pct: Optional[float],
        now: datetime,
    ) -> None:
        hour_ts = self._hour_floor(now)
        existing = (
            self.db.query(QuotaUsageHourly)
            .filter(
                QuotaUsageHourly.hour_ts == hour_ts,
                QuotaUsageHourly.storage_endpoint_id == subject.endpoint_id,
                QuotaUsageHourly.s3_account_id == (subject.subject_id if subject.subject_type == "account" else None),
                QuotaUsageHourly.s3_user_id == (subject.subject_id if subject.subject_type == "s3_user" else None),
            )
            .first()
        )
        if existing:
            existing.used_bytes = int(used_bytes)
            existing.used_objects = int(used_objects)
            existing.quota_size_bytes = quota_size_bytes
            existing.quota_objects = quota_objects
            existing.usage_ratio_pct = ratio_pct
            existing.collected_at = now
            return
        self.db.add(
            QuotaUsageHourly(
                hour_ts=hour_ts,
                storage_endpoint_id=subject.endpoint_id,
                s3_account_id=subject.subject_id if subject.subject_type == "account" else None,
                s3_user_id=subject.subject_id if subject.subject_type == "s3_user" else None,
                used_bytes=int(used_bytes),
                used_objects=int(used_objects),
                quota_size_bytes=quota_size_bytes,
                quota_objects=quota_objects,
                usage_ratio_pct=ratio_pct,
                collected_at=now,
            )
        )

    def _upsert_daily(
        self,
        subject: SubjectContext,
        used_bytes: int,
        used_objects: int,
        ratio_pct: Optional[float],
        now: datetime,
    ) -> None:
        day = now.date()
        existing = (
            self.db.query(QuotaUsageDaily)
            .filter(
                QuotaUsageDaily.day == day,
                QuotaUsageDaily.storage_endpoint_id == subject.endpoint_id,
                QuotaUsageDaily.s3_account_id == (subject.subject_id if subject.subject_type == "account" else None),
                QuotaUsageDaily.s3_user_id == (subject.subject_id if subject.subject_type == "s3_user" else None),
            )
            .first()
        )
        if existing:
            existing.last_used_bytes = int(used_bytes)
            existing.last_used_objects = int(used_objects)
            if ratio_pct is not None:
                if existing.max_ratio_pct is None:
                    existing.max_ratio_pct = ratio_pct
                else:
                    existing.max_ratio_pct = max(float(existing.max_ratio_pct), ratio_pct)
            existing.samples_count = int(existing.samples_count or 0) + 1
            existing.updated_at = now
            return
        self.db.add(
            QuotaUsageDaily(
                day=day,
                storage_endpoint_id=subject.endpoint_id,
                s3_account_id=subject.subject_id if subject.subject_type == "account" else None,
                s3_user_id=subject.subject_id if subject.subject_type == "s3_user" else None,
                last_used_bytes=int(used_bytes),
                last_used_objects=int(used_objects),
                max_ratio_pct=ratio_pct,
                samples_count=1,
                updated_at=now,
            )
        )

    def _state_key(self, subject: SubjectContext) -> tuple[int, Optional[int], Optional[int]]:
        return (
            int(subject.endpoint_id),
            subject.subject_id if subject.subject_type == "account" else None,
            subject.subject_id if subject.subject_type == "s3_user" else None,
        )

    def _load_alert_states(self) -> dict[tuple[int, Optional[int], Optional[int]], QuotaAlertState]:
        rows = self.db.query(QuotaAlertState).all()
        return {
            (int(row.storage_endpoint_id), row.s3_account_id, row.s3_user_id): row
            for row in rows
        }

    def _determine_level(self, ratio_pct: Optional[float], threshold_percent: int) -> str:
        if ratio_pct is None:
            return self._LEVEL_NORMAL
        if ratio_pct >= 100.0:
            return self._LEVEL_FULL
        if ratio_pct >= float(threshold_percent):
            return self._LEVEL_THRESHOLD
        return self._LEVEL_NORMAL

    def _update_state_and_check_alert(
        self,
        *,
        subject: SubjectContext,
        states: dict[tuple[int, Optional[int], Optional[int]], QuotaAlertState],
        ratio_pct: Optional[float],
        threshold_percent: int,
        now: datetime,
    ) -> tuple[bool, str]:
        key = self._state_key(subject)
        state = states.get(key)
        previous_level = state.last_level if state else None
        next_level = self._determine_level(ratio_pct, threshold_percent)

        should_alert = False
        if ratio_pct is not None and next_level in {self._LEVEL_THRESHOLD, self._LEVEL_FULL}:
            if previous_level is None:
                should_alert = True
            else:
                should_alert = self._LEVEL_ORDER[next_level] > self._LEVEL_ORDER.get(previous_level, 0)

        if state is None:
            state = QuotaAlertState(
                storage_endpoint_id=subject.endpoint_id,
                s3_account_id=subject.subject_id if subject.subject_type == "account" else None,
                s3_user_id=subject.subject_id if subject.subject_type == "s3_user" else None,
                last_level=next_level,
                last_ratio_pct=ratio_pct,
                last_checked_at=now,
                created_at=now,
                updated_at=now,
            )
            self.db.add(state)
            states[key] = state
        else:
            state.last_level = next_level
            state.last_ratio_pct = ratio_pct
            state.last_checked_at = now
            state.updated_at = now

        if should_alert:
            state.last_notified_level = next_level
            state.last_notified_at = now
            state.updated_at = now

        return should_alert, next_level

    def _normalize_email(self, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        normalized = str(value).strip().lower()
        return normalized or None

    def _load_account_recipients(self) -> dict[int, set[str]]:
        rows = (
            self.db.query(UserS3Account.account_id, User.email)
            .join(User, User.id == UserS3Account.user_id)
            .filter(User.is_active.is_(True))
            .filter(User.quota_alerts_enabled.is_(True))
            .filter(
                or_(
                    UserS3Account.account_admin.is_(True),
                    UserS3Account.is_root.is_(True),
                    UserS3Account.account_role == AccountRole.PORTAL_MANAGER.value,
                )
            )
            .all()
        )
        result: dict[int, set[str]] = {}
        for account_id, email in rows:
            normalized = self._normalize_email(email)
            if not normalized:
                continue
            result.setdefault(int(account_id), set()).add(normalized)
        return result

    def _load_s3_user_recipients(self) -> dict[int, set[str]]:
        rows = (
            self.db.query(UserS3User.s3_user_id, User.email)
            .join(User, User.id == UserS3User.user_id)
            .filter(User.is_active.is_(True))
            .filter(User.quota_alerts_enabled.is_(True))
            .all()
        )
        result: dict[int, set[str]] = {}
        for s3_user_id, email in rows:
            normalized = self._normalize_email(email)
            if not normalized:
                continue
            result.setdefault(int(s3_user_id), set()).add(normalized)
        return result

    def _load_global_watch_recipients(self) -> set[str]:
        rows = (
            self.db.query(User.email)
            .filter(User.is_active.is_(True))
            .filter(User.quota_alerts_enabled.is_(True))
            .filter(User.quota_alerts_global_watch.is_(True))
            .filter(User.role.in_([UserRole.UI_ADMIN.value, UserRole.UI_SUPERADMIN.value]))
            .all()
        )
        recipients: set[str] = set()
        for (email,) in rows:
            normalized = self._normalize_email(email)
            if normalized:
                recipients.add(normalized)
        return recipients

    def _resolve_recipients(
        self,
        *,
        subject: SubjectContext,
        account_recipients: dict[int, set[str]],
        s3_user_recipients: dict[int, set[str]],
        global_watch_recipients: set[str],
        include_subject_contact: bool,
    ) -> list[str]:
        recipients: set[str] = set(global_watch_recipients)
        if subject.subject_type == "account":
            recipients.update(account_recipients.get(subject.subject_id, set()))
        else:
            recipients.update(s3_user_recipients.get(subject.subject_id, set()))
        if include_subject_contact:
            normalized = self._normalize_email(subject.contact_email)
            if normalized:
                recipients.add(normalized)
        return sorted(recipients)

    def _build_mailer(
        self,
        notification_settings: QuotaNotificationSettings,
    ) -> tuple[Optional[SMTPMailer], Optional[str]]:
        host = (notification_settings.smtp_host or "").strip()
        from_email = (notification_settings.smtp_from_email or "").strip()
        username = (notification_settings.smtp_username or "").strip() or None
        password = (runtime_settings.smtp_password or "").strip() or None

        if not host or not from_email:
            return None, "SMTP not configured: smtp_host and smtp_from_email are required for quota notifications."
        if password and not username:
            return None, "SMTP configuration invalid: SMTP_PASSWORD is set but smtp_username is empty."

        return (
            SMTPMailer(
                host=host,
                port=int(notification_settings.smtp_port),
                username=username,
                password=password,
                from_email=from_email,
                from_name=notification_settings.smtp_from_name,
                starttls=bool(notification_settings.smtp_starttls),
                timeout_seconds=int(notification_settings.smtp_timeout_seconds),
            ),
            None,
        )

    def _send_quota_alert_email(
        self,
        *,
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
        if not self._mailer:
            return False
        ratio_display = f"{ratio_pct:.3f}" if ratio_pct is not None else "n/a"
        email_subject = f"[Quota {alert_level.upper()}] {subject.subject_type}:{subject.subject_name}"
        body = (
            f"Quota alert level: {alert_level}\n"
            f"Subject type: {subject.subject_type}\n"
            f"Subject: {subject.subject_name}\n"
            f"Identifier: {subject.subject_identifier}\n"
            f"Endpoint: {subject.endpoint_name}\n"
            f"Threshold percent: {threshold_percent}\n"
            f"Usage ratio (%): {ratio_display}\n"
            f"Used bytes: {used_bytes}\n"
            f"Quota bytes: {quota_size_bytes if quota_size_bytes is not None else 'unlimited'}\n"
            f"Used objects: {used_objects}\n"
            f"Quota objects: {quota_objects if quota_objects is not None else 'unlimited'}\n"
            f"Checked at (UTC): {checked_at.isoformat()}\n"
        )
        try:
            self._mailer.send(
                recipients=recipients,
                subject=email_subject,
                body=body,
            )
            return True
        except Exception as exc:  # pragma: no cover - network side effect
            logger.warning(
                "Unable to send quota alert email for %s:%s to %s recipients: %s",
                subject.subject_type,
                subject.subject_id,
                len(recipients),
                exc,
            )
            return False
