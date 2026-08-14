# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from app.utils.time import utcnow

from datetime import datetime
import logging
from typing import Any, Optional

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db import (
    AccountRole,
    S3Account,
    S3User,
    StorageEndpoint,
    StorageProvider,
    UiGroupS3Account,
    UiGroupS3User,
    User,
    UserRole,
    UserS3Account,
    UserS3User,
    UserUiGroup,
)
from app.models.app_settings import QuotaNotificationSettings
from app.services.app_settings_service import load_app_settings
from app.services.data_retention_service import DataRetentionService
from app.services.quota_alert_state_service import (
    QUOTA_ALERT_FULL,
    QUOTA_ALERT_THRESHOLD,
    QuotaAlertStateService,
)
from app.services.rgw_admin import RGWAdminClient, RGWAdminError, get_rgw_admin_client
from app.services.rgw_supervision import get_supervision_rgw_client
from app.services import smtp_mailer
from app.services.quota_subject import SubjectContext
from app.services.quota_usage_history_service import QuotaUsageHistoryService
from app.services.user_notifications_service import UserNotificationsService
from app.utils.rgw_payloads import extract_bucket_list
from app.utils.storage_endpoint_features import resolve_admin_endpoint
from app.utils.usage_stats import extract_usage_stats

logger = logging.getLogger(__name__)
runtime_settings = get_settings()


class QuotaMonitoringService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self._mail_error_reason: Optional[str] = None
        self._mailer: Optional[smtp_mailer.SMTPMailer] = None

    def run_monitor(
        self,
        *,
        include_quota_alerts: bool = True,
        include_usage_history: bool = True,
    ) -> dict[str, Any]:
        app_settings = load_app_settings()
        now = utcnow()
        quota_alerts_enabled = bool(app_settings.general.quota_alerts_enabled and include_quota_alerts)
        usage_history_collection_enabled = bool(app_settings.general.usage_history_enabled and include_usage_history)
        summary: dict[str, Any] = {
            "started_at": now.isoformat(),
            "subjects_total": 0,
            "subjects_processed": 0,
            "history_hourly_upserts": 0,
            "history_daily_upserts": 0,
            "alerts_triggered": 0,
            "alerts_sent": 0,
            "notifications_created": 0,
            "email_errors": 0,
            "errors": [],
            "warnings": [],
            "quota_alerts_enabled": quota_alerts_enabled,
            "quota_alerts_configured": bool(app_settings.general.quota_alerts_enabled),
            "usage_history_enabled": bool(app_settings.general.usage_history_enabled),
            "usage_history_collection_enabled": usage_history_collection_enabled,
            "threshold_percent": int(app_settings.quota_notifications.threshold_percent),
        }

        if not quota_alerts_enabled and not usage_history_collection_enabled:
            summary["status"] = "skipped"
            summary["reason"] = "Both quota alerts and usage history collection are disabled for this run."
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
        account_notification_users = self._load_account_notification_users()
        s3_user_notification_users = self._load_s3_user_notification_users()
        global_watch_notification_users = self._load_global_watch_notification_users()
        usage_clients: dict[int, Optional[RGWAdminClient]] = {}
        admin_clients: dict[int, Optional[RGWAdminClient]] = {}
        notifications_service = UserNotificationsService(self.db)
        usage_history_service = QuotaUsageHistoryService(self.db)
        alert_state_service = QuotaAlertStateService(self.db)
        states = (
            alert_state_service.load_states()
            if quota_alerts_enabled
            else {}
        )

        if quota_alerts_enabled:
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

            usage_client = self._resolve_usage_client(endpoint, usage_clients, admin_clients)
            if not usage_client:
                summary["errors"].append(
                    {
                        "subject_type": subject.subject_type,
                        "subject_id": subject.subject_id,
                        "error": f"Usage client unavailable for endpoint '{subject.endpoint_name}'.",
                    }
                )
                continue

            try:
                usage_bytes, usage_objects, bucket_count = self._collect_usage(usage_client, subject.usage_uid)
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
            admin_client = self._resolve_admin_client(endpoint, admin_clients)
            if not admin_client:
                summary["warnings"].append(
                    {
                        "subject_type": subject.subject_type,
                        "subject_id": subject.subject_id,
                        "warning": f"Quota client unavailable for endpoint '{subject.endpoint_name}'.",
                    }
                )
            else:
                try:
                    quota_size_bytes, quota_objects = self._collect_quota(admin_client, subject)
                except Exception as exc:  # pragma: no cover - defensive logging
                    logger.warning("Quota monitor quota collection failed for %s:%s: %s", subject.subject_type, subject.subject_id, exc)
                    summary["warnings"].append(
                        {
                            "subject_type": subject.subject_type,
                            "subject_id": subject.subject_id,
                            "warning": f"Quota collection failed: {exc}",
                        }
                    )

            ratio_pct = self._compute_usage_ratio(
                used_bytes=usage_bytes,
                used_objects=usage_objects,
                quota_size_bytes=quota_size_bytes,
                quota_objects=quota_objects,
            )

            if usage_history_collection_enabled:
                usage_history_service.upsert_hourly(
                    subject,
                    usage_bytes,
                    usage_objects,
                    bucket_count,
                    quota_size_bytes,
                    quota_objects,
                    ratio_pct,
                    now,
                )
                summary["history_hourly_upserts"] += 1
                usage_history_service.upsert_daily(
                    subject,
                    usage_bytes,
                    usage_objects,
                    bucket_count,
                    ratio_pct,
                    now,
                )
                summary["history_daily_upserts"] += 1

            if quota_alerts_enabled:
                transition = alert_state_service.update(
                    subject=subject,
                    states=states,
                    ratio_pct=ratio_pct,
                    threshold_percent=int(app_settings.quota_notifications.threshold_percent),
                    now=now,
                )
                next_level = transition.next_level
                if transition.should_alert and next_level in {
                    QUOTA_ALERT_THRESHOLD,
                    QUOTA_ALERT_FULL,
                }:
                    summary["alerts_triggered"] += 1
                    notification_user_ids = self._resolve_notification_user_ids(
                        subject=subject,
                        account_notification_users=account_notification_users,
                        s3_user_notification_users=s3_user_notification_users,
                        global_watch_notification_users=global_watch_notification_users,
                    )
                    summary["notifications_created"] += notifications_service.create_quota_alert_notifications(
                        user_ids=notification_user_ids,
                        subject_type=subject.subject_type,
                        subject_id=subject.subject_id,
                        storage_endpoint_id=subject.endpoint_id,
                        event_key=self._quota_notification_event_key(
                            subject,
                            transition.previous_level,
                            next_level,
                            now,
                        ),
                        title=self._quota_notification_title(next_level),
                        message=self._quota_notification_message(
                            subject=subject,
                            alert_level=next_level,
                            ratio_pct=ratio_pct,
                        ),
                        severity=(
                            "error"
                            if next_level == QUOTA_ALERT_FULL
                            else "warning"
                        ),
                        payload=self._quota_notification_payload(
                            subject=subject,
                            alert_level=next_level,
                            ratio_pct=ratio_pct,
                            threshold_percent=int(app_settings.quota_notifications.threshold_percent),
                            used_bytes=usage_bytes,
                            used_objects=usage_objects,
                            quota_size_bytes=quota_size_bytes,
                            quota_objects=quota_objects,
                            checked_at=now,
                        ),
                        created_at=now,
                    )
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
            endpoint_id = account.storage_endpoint_id
            endpoint = endpoint_map.get(endpoint_id)
            if not endpoint:
                continue
            subjects.append(
                SubjectContext(
                    subject_type="account",
                    subject_id=account.id,
                    endpoint_id=endpoint_id,
                    endpoint_name=endpoint.name,
                    subject_name=account.name,
                    subject_identifier=account.rgw_account_id,
                    usage_uid=account.rgw_user_uid,
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

    def _resolve_usage_client(
        self,
        endpoint: StorageEndpoint,
        cache: dict[int, Optional[RGWAdminClient]],
        admin_cache: dict[int, Optional[RGWAdminClient]],
    ) -> Optional[RGWAdminClient]:
        cached = cache.get(endpoint.id)
        if endpoint.id in cache:
            return cached
        provider = str(endpoint.provider or "").strip().lower()
        if provider != StorageProvider.CEPH.value:
            cache[endpoint.id] = None
            return None
        try:
            client = get_supervision_rgw_client(endpoint)
        except Exception:
            client = self._resolve_admin_client(endpoint, admin_cache)
        cache[endpoint.id] = client
        return client

    def _collect_usage(self, admin: RGWAdminClient, usage_uid: Optional[str]) -> tuple[int, int, int]:
        if not usage_uid:
            return 0, 0, 0
        payload = admin.get_all_buckets(uid=usage_uid, with_stats=True)
        buckets = extract_bucket_list(payload)
        total_bytes = 0
        total_objects = 0
        bucket_count = len(buckets)
        for bucket in buckets:
            if not isinstance(bucket, dict):
                continue
            used_bytes, used_objects = extract_usage_stats(bucket.get("usage"))
            total_bytes += int(used_bytes or 0)
            total_objects += int(used_objects or 0)
        return total_bytes, total_objects, bucket_count

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
                    UserS3Account.is_root.is_(True),
                    UserS3Account.role.in_([
                        AccountRole.PORTAL_MANAGER.value,
                        AccountRole.ACCOUNT_ADMINISTRATOR.value,
                    ]),
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

        group_rows = (
            self.db.query(UiGroupS3Account.account_id, User.email)
            .join(UserUiGroup, UserUiGroup.group_id == UiGroupS3Account.group_id)
            .join(User, User.id == UserUiGroup.user_id)
            .filter(User.is_active.is_(True))
            .filter(User.quota_alerts_enabled.is_(True))
            .filter(
                UiGroupS3Account.role.in_([
                    AccountRole.PORTAL_MANAGER.value,
                    AccountRole.ACCOUNT_ADMINISTRATOR.value,
                ])
            )
            .all()
        )
        for account_id, email in group_rows:
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

        group_rows = (
            self.db.query(UiGroupS3User.s3_user_id, User.email)
            .join(UserUiGroup, UserUiGroup.group_id == UiGroupS3User.group_id)
            .join(User, User.id == UserUiGroup.user_id)
            .filter(User.is_active.is_(True))
            .filter(User.quota_alerts_enabled.is_(True))
            .all()
        )
        for s3_user_id, email in group_rows:
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

    def _load_account_notification_users(self) -> dict[int, set[int]]:
        rows = (
            self.db.query(UserS3Account.account_id, User.id)
            .join(User, User.id == UserS3Account.user_id)
            .filter(User.is_active.is_(True))
            .filter(
                or_(
                    UserS3Account.is_root.is_(True),
                    UserS3Account.role.in_([
                        AccountRole.PORTAL_MANAGER.value,
                        AccountRole.ACCOUNT_ADMINISTRATOR.value,
                    ]),
                )
            )
            .all()
        )
        result: dict[int, set[int]] = {}
        for account_id, user_id in rows:
            result.setdefault(int(account_id), set()).add(int(user_id))

        group_rows = (
            self.db.query(UiGroupS3Account.account_id, User.id)
            .join(UserUiGroup, UserUiGroup.group_id == UiGroupS3Account.group_id)
            .join(User, User.id == UserUiGroup.user_id)
            .filter(User.is_active.is_(True))
            .filter(
                UiGroupS3Account.role.in_([
                    AccountRole.PORTAL_MANAGER.value,
                    AccountRole.ACCOUNT_ADMINISTRATOR.value,
                ])
            )
            .all()
        )
        for account_id, user_id in group_rows:
            result.setdefault(int(account_id), set()).add(int(user_id))
        return result

    def _load_s3_user_notification_users(self) -> dict[int, set[int]]:
        rows = (
            self.db.query(UserS3User.s3_user_id, User.id)
            .join(User, User.id == UserS3User.user_id)
            .filter(User.is_active.is_(True))
            .all()
        )
        result: dict[int, set[int]] = {}
        for s3_user_id, user_id in rows:
            result.setdefault(int(s3_user_id), set()).add(int(user_id))

        group_rows = (
            self.db.query(UiGroupS3User.s3_user_id, User.id)
            .join(UserUiGroup, UserUiGroup.group_id == UiGroupS3User.group_id)
            .join(User, User.id == UserUiGroup.user_id)
            .filter(User.is_active.is_(True))
            .all()
        )
        for s3_user_id, user_id in group_rows:
            result.setdefault(int(s3_user_id), set()).add(int(user_id))
        return result

    def _load_global_watch_notification_users(self) -> set[int]:
        rows = (
            self.db.query(User.id)
            .filter(User.is_active.is_(True))
            .filter(User.quota_alerts_global_watch.is_(True))
            .filter(User.role.in_([UserRole.UI_ADMIN.value, UserRole.UI_SUPERADMIN.value]))
            .all()
        )
        return {int(user_id) for (user_id,) in rows}

    def _resolve_notification_user_ids(
        self,
        *,
        subject: SubjectContext,
        account_notification_users: dict[int, set[int]],
        s3_user_notification_users: dict[int, set[int]],
        global_watch_notification_users: set[int],
    ) -> list[int]:
        user_ids: set[int] = set(global_watch_notification_users)
        if subject.subject_type == "account":
            user_ids.update(account_notification_users.get(subject.subject_id, set()))
        else:
            user_ids.update(s3_user_notification_users.get(subject.subject_id, set()))
        return sorted(user_ids)

    def _quota_notification_event_key(
        self,
        subject: SubjectContext,
        previous_level: Optional[str],
        alert_level: str,
        checked_at: datetime,
    ) -> str:
        transition_from = previous_level or "new"
        return (
            f"quota:{subject.subject_type}:{subject.endpoint_id}:"
            f"{subject.subject_id}:{transition_from}:{alert_level}:{checked_at.isoformat()}"
        )

    def _quota_notification_title(self, alert_level: str) -> str:
        if alert_level == QUOTA_ALERT_FULL:
            return "Quota reached"
        return "Quota near limit"

    def _quota_notification_message(
        self,
        *,
        subject: SubjectContext,
        alert_level: str,
        ratio_pct: Optional[float],
    ) -> str:
        subject_label = "RGW account" if subject.subject_type == "account" else "RGW user"
        ratio_display = f"{ratio_pct:.3f}%" if ratio_pct is not None else "n/a"
        if alert_level == QUOTA_ALERT_FULL:
            return f"{subject_label} {subject.subject_name} has reached its quota ({ratio_display})."
        return f"{subject_label} {subject.subject_name} is near its quota limit ({ratio_display})."

    def _quota_notification_payload(
        self,
        *,
        subject: SubjectContext,
        alert_level: str,
        ratio_pct: Optional[float],
        threshold_percent: int,
        used_bytes: int,
        used_objects: int,
        quota_size_bytes: Optional[int],
        quota_objects: Optional[int],
        checked_at: datetime,
    ) -> dict[str, Any]:
        return {
            "alert_level": alert_level,
            "subject_type": subject.subject_type,
            "subject_label": "RGW account" if subject.subject_type == "account" else "RGW user",
            "subject_name": subject.subject_name,
            "endpoint_name": subject.endpoint_name,
            "threshold_percent": int(threshold_percent),
            "usage_ratio_pct": ratio_pct,
            "used_bytes": int(used_bytes),
            "quota_size_bytes": quota_size_bytes,
            "used_objects": int(used_objects),
            "quota_objects": quota_objects,
            "checked_at": checked_at.isoformat(),
        }

    def _build_mailer(
        self,
        notification_settings: QuotaNotificationSettings,
    ) -> tuple[Optional[smtp_mailer.SMTPMailer], Optional[str]]:
        host = (notification_settings.smtp_host or "").strip()
        from_email = (notification_settings.smtp_from_email or "").strip()
        username = (notification_settings.smtp_username or "").strip() or None
        password = (runtime_settings.smtp_password or "").strip() or None

        if not host or not from_email:
            return None, "SMTP not configured: smtp_host and smtp_from_email are required for quota notifications."
        if password and not username:
            return None, "SMTP configuration invalid: SMTP_PASSWORD is set but smtp_username is empty."

        return (
            smtp_mailer.SMTPMailer(
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
