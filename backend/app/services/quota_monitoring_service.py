# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
import logging
from typing import Any

from sqlalchemy.orm import Session

from app.db import (
    QuotaAlertState,
    S3Account,
    S3User,
    StorageEndpoint,
    StorageProvider,
)
from app.models.app_settings import AppSettings
from app.services.app_settings_service import load_app_settings
from app.services.data_retention_service import DataRetentionService
from app.services.quota_alert_content import build_quota_alert_content
from app.services.quota_alert_email_service import QuotaAlertEmailService
from app.services.quota_alert_recipients_service import (
    QuotaAlertRecipientIndex,
    QuotaAlertRecipientsService,
)
from app.services.quota_alert_state_service import (
    QUOTA_ALERT_FULL,
    QUOTA_ALERT_THRESHOLD,
    QuotaAlertStateKey,
    QuotaAlertStateService,
)
from app.services.rgw_admin import RGWAdminClient, RGWAdminError, get_rgw_admin_client
from app.services.rgw_supervision import get_supervision_rgw_client
from app.services.quota_subject import SubjectContext
from app.services.quota_usage_history_service import QuotaUsageHistoryService
from app.services.user_notifications_service import UserNotificationsService
from app.utils.rgw_payloads import extract_bucket_list
from app.utils.storage_endpoint_features import resolve_admin_endpoint
from app.utils.time import utcnow
from app.utils.usage_stats import extract_usage_stats

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class _QuotaUsageSnapshot:
    used_bytes: int
    used_objects: int
    bucket_count: int
    quota_size_bytes: int | None
    quota_objects: int | None
    ratio_pct: float | None


@dataclass
class _QuotaMonitorRun:
    settings: AppSettings
    now: datetime
    quota_alerts_enabled: bool
    usage_history_enabled: bool
    summary: dict[str, Any]
    endpoint_map: dict[int, StorageEndpoint]
    usage_clients: dict[int, RGWAdminClient | None]
    admin_clients: dict[int, RGWAdminClient | None]
    notifications: UserNotificationsService
    history: QuotaUsageHistoryService
    alert_states: QuotaAlertStateService
    recipients: QuotaAlertRecipientsService
    email: QuotaAlertEmailService
    states: dict[QuotaAlertStateKey, QuotaAlertState]
    recipient_index: QuotaAlertRecipientIndex
    mailer: Any | None


class QuotaMonitoringService:
    def __init__(self, db: Session) -> None:
        self.db = db

    def run_monitor(
        self,
        *,
        include_quota_alerts: bool = True,
        include_usage_history: bool = True,
    ) -> dict[str, Any]:
        settings = load_app_settings()
        now = utcnow()
        quota_alerts_enabled = bool(
            settings.general.quota_alerts_enabled and include_quota_alerts
        )
        usage_history_enabled = bool(
            settings.general.usage_history_enabled and include_usage_history
        )
        summary = self._new_summary(
            settings=settings,
            now=now,
            quota_alerts_enabled=quota_alerts_enabled,
            usage_history_enabled=usage_history_enabled,
        )
        if not quota_alerts_enabled and not usage_history_enabled:
            summary.update(
                status="skipped",
                reason=(
                    "Both quota alerts and usage history collection are "
                    "disabled for this run."
                ),
            )
            return self._finish_run(summary)

        run, default_endpoint_id = self._prepare_run(
            settings=settings,
            now=now,
            quota_alerts_enabled=quota_alerts_enabled,
            usage_history_enabled=usage_history_enabled,
            summary=summary,
        )
        subjects = self._load_subjects(
            endpoint_map=run.endpoint_map,
            default_endpoint_id=default_endpoint_id,
        )
        summary["subjects_total"] = len(subjects)
        for subject in subjects:
            self._process_subject(subject, run)

        self.db.commit()
        return self._finish_run(summary)

    @staticmethod
    def _new_summary(
        *,
        settings: AppSettings,
        now: datetime,
        quota_alerts_enabled: bool,
        usage_history_enabled: bool,
    ) -> dict[str, Any]:
        return {
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
            "quota_alerts_configured": bool(settings.general.quota_alerts_enabled),
            "usage_history_enabled": bool(settings.general.usage_history_enabled),
            "usage_history_collection_enabled": usage_history_enabled,
            "threshold_percent": int(settings.quota_notifications.threshold_percent),
        }

    def _prepare_run(
        self,
        *,
        settings: AppSettings,
        now: datetime,
        quota_alerts_enabled: bool,
        usage_history_enabled: bool,
        summary: dict[str, Any],
    ) -> tuple[_QuotaMonitorRun, int | None]:
        endpoint_map = {
            endpoint.id: endpoint
            for endpoint in self.db.query(StorageEndpoint).all()
        }
        default_endpoint_id = min(
            (
                endpoint.id
                for endpoint in endpoint_map.values()
                if endpoint.is_default
            ),
            default=None,
        )
        alert_states = QuotaAlertStateService(self.db)
        recipients = QuotaAlertRecipientsService(self.db)
        email = QuotaAlertEmailService()
        states = (
            alert_states.load_states()
            if quota_alerts_enabled
            else {}
        )
        recipient_index = (
            recipients.load()
            if quota_alerts_enabled
            else QuotaAlertRecipientIndex()
        )
        mailer = None
        if quota_alerts_enabled:
            mailer, mail_error_reason = email.build_mailer(
                settings.quota_notifications
            )
            if mailer is None and mail_error_reason:
                summary["warnings"].append(mail_error_reason)
        return (
            _QuotaMonitorRun(
                settings=settings,
                now=now,
                quota_alerts_enabled=quota_alerts_enabled,
                usage_history_enabled=usage_history_enabled,
                summary=summary,
                endpoint_map=endpoint_map,
                usage_clients={},
                admin_clients={},
                notifications=UserNotificationsService(self.db),
                history=QuotaUsageHistoryService(self.db),
                alert_states=alert_states,
                recipients=recipients,
                email=email,
                states=states,
                recipient_index=recipient_index,
                mailer=mailer,
            ),
            default_endpoint_id,
        )

    def _process_subject(
        self,
        subject: SubjectContext,
        run: _QuotaMonitorRun,
    ) -> None:
        endpoint = run.endpoint_map[subject.endpoint_id]
        snapshot = self._collect_subject_snapshot(subject, endpoint, run)
        if snapshot is None:
            return
        if run.usage_history_enabled:
            self._record_usage_history(subject, snapshot, run)
        if run.quota_alerts_enabled:
            self._process_quota_alert(subject, snapshot, run)
        run.summary["subjects_processed"] += 1

    def _collect_subject_snapshot(
        self,
        subject: SubjectContext,
        endpoint: StorageEndpoint,
        run: _QuotaMonitorRun,
    ) -> _QuotaUsageSnapshot | None:
        usage_client = self._resolve_usage_client(
            endpoint,
            run.usage_clients,
            run.admin_clients,
        )
        if usage_client is None:
            run.summary["errors"].append(
                self._subject_issue(
                    subject,
                    "error",
                    f"Usage client unavailable for endpoint '{subject.endpoint_name}'.",
                )
            )
            return None
        try:
            used_bytes, used_objects, bucket_count = self._collect_usage(
                usage_client,
                subject.usage_uid,
            )
        except Exception as exc:  # pragma: no cover - defensive logging
            logger.warning(
                "Quota monitor usage collection failed for %s:%s: %s",
                subject.subject_type,
                subject.subject_id,
                exc,
            )
            run.summary["errors"].append(
                self._subject_issue(
                    subject,
                    "error",
                    f"Usage collection failed: {exc}",
                )
            )
            return None

        quota_size_bytes, quota_objects = self._collect_subject_quota(
            subject,
            endpoint,
            run,
        )
        ratio_pct = self._compute_usage_ratio(
            used_bytes=used_bytes,
            used_objects=used_objects,
            quota_size_bytes=quota_size_bytes,
            quota_objects=quota_objects,
        )
        return _QuotaUsageSnapshot(
            used_bytes=used_bytes,
            used_objects=used_objects,
            bucket_count=bucket_count,
            quota_size_bytes=quota_size_bytes,
            quota_objects=quota_objects,
            ratio_pct=ratio_pct,
        )

    def _collect_subject_quota(
        self,
        subject: SubjectContext,
        endpoint: StorageEndpoint,
        run: _QuotaMonitorRun,
    ) -> tuple[int | None, int | None]:
        admin_client = self._resolve_admin_client(endpoint, run.admin_clients)
        if admin_client is None:
            run.summary["warnings"].append(
                self._subject_issue(
                    subject,
                    "warning",
                    f"Quota client unavailable for endpoint '{subject.endpoint_name}'.",
                )
            )
            return None, None
        try:
            return self._collect_quota(admin_client, subject)
        except Exception as exc:  # pragma: no cover - defensive logging
            logger.warning(
                "Quota monitor quota collection failed for %s:%s: %s",
                subject.subject_type,
                subject.subject_id,
                exc,
            )
            run.summary["warnings"].append(
                self._subject_issue(
                    subject,
                    "warning",
                    f"Quota collection failed: {exc}",
                )
            )
            return None, None

    @staticmethod
    def _subject_issue(
        subject: SubjectContext,
        kind: str,
        message: str,
    ) -> dict[str, Any]:
        return {
            "subject_type": subject.subject_type,
            "subject_id": subject.subject_id,
            kind: message,
        }

    @staticmethod
    def _record_usage_history(
        subject: SubjectContext,
        snapshot: _QuotaUsageSnapshot,
        run: _QuotaMonitorRun,
    ) -> None:
        run.history.upsert_hourly(
            subject,
            snapshot.used_bytes,
            snapshot.used_objects,
            snapshot.bucket_count,
            snapshot.quota_size_bytes,
            snapshot.quota_objects,
            snapshot.ratio_pct,
            run.now,
        )
        run.summary["history_hourly_upserts"] += 1
        run.history.upsert_daily(
            subject,
            snapshot.used_bytes,
            snapshot.used_objects,
            snapshot.bucket_count,
            snapshot.ratio_pct,
            run.now,
        )
        run.summary["history_daily_upserts"] += 1

    def _process_quota_alert(
        self,
        subject: SubjectContext,
        snapshot: _QuotaUsageSnapshot,
        run: _QuotaMonitorRun,
    ) -> None:
        threshold_percent = int(run.settings.quota_notifications.threshold_percent)
        transition = run.alert_states.update(
            subject=subject,
            states=run.states,
            ratio_pct=snapshot.ratio_pct,
            threshold_percent=threshold_percent,
            now=run.now,
        )
        if not transition.should_alert or transition.next_level not in {
            QUOTA_ALERT_THRESHOLD,
            QUOTA_ALERT_FULL,
        }:
            return

        run.summary["alerts_triggered"] += 1
        content = build_quota_alert_content(
            subject=subject,
            previous_level=transition.previous_level,
            alert_level=transition.next_level,
            ratio_pct=snapshot.ratio_pct,
            threshold_percent=threshold_percent,
            used_bytes=snapshot.used_bytes,
            used_objects=snapshot.used_objects,
            quota_size_bytes=snapshot.quota_size_bytes,
            quota_objects=snapshot.quota_objects,
            checked_at=run.now,
        )
        notification_user_ids = run.recipients.notification_user_ids(
            subject=subject,
            index=run.recipient_index,
        )
        run.summary["notifications_created"] += (
            run.notifications.create_quota_alert_notifications(
                user_ids=notification_user_ids,
                subject_type=subject.subject_type,
                subject_id=subject.subject_id,
                storage_endpoint_id=subject.endpoint_id,
                event_key=content.event_key,
                title=content.title,
                message=content.message,
                severity=content.severity,
                payload=content.payload,
                created_at=run.now,
            )
        )
        self._send_alert_email(
            subject,
            snapshot,
            transition.next_level,
            threshold_percent,
            run,
        )

    @staticmethod
    def _send_alert_email(
        subject: SubjectContext,
        snapshot: _QuotaUsageSnapshot,
        alert_level: str,
        threshold_percent: int,
        run: _QuotaMonitorRun,
    ) -> None:
        recipients = run.recipients.email_recipients(
            subject=subject,
            index=run.recipient_index,
            include_subject_contact=bool(
                run.settings.quota_notifications.include_subject_contact_email
            ),
        )
        if not recipients:
            run.summary["email_errors"] += 1
            run.summary["warnings"].append(
                f"No recipients found for {subject.subject_type}:"
                f"{subject.subject_id} alert."
            )
            return
        sent = run.email.send_alert_email(
            mailer=run.mailer,
            recipients=recipients,
            subject=subject,
            alert_level=alert_level,
            ratio_pct=snapshot.ratio_pct,
            threshold_percent=threshold_percent,
            used_bytes=snapshot.used_bytes,
            used_objects=snapshot.used_objects,
            quota_size_bytes=snapshot.quota_size_bytes,
            quota_objects=snapshot.quota_objects,
            checked_at=run.now,
        )
        if sent:
            run.summary["alerts_sent"] += 1
        else:
            run.summary["email_errors"] += 1

    def _finish_run(self, summary: dict[str, Any]) -> dict[str, Any]:
        summary["retention"] = DataRetentionService(self.db).purge_all()
        summary["finished_at"] = utcnow().isoformat()
        return summary

    def _load_subjects(
        self,
        *,
        endpoint_map: dict[int, StorageEndpoint],
        default_endpoint_id: int | None,
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
        cache: dict[int, RGWAdminClient | None],
    ) -> RGWAdminClient | None:
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
                verify_tls=endpoint.verify_tls,
            )
        except Exception:
            client = None
        cache[endpoint.id] = client
        return client

    def _resolve_usage_client(
        self,
        endpoint: StorageEndpoint,
        cache: dict[int, RGWAdminClient | None],
        admin_cache: dict[int, RGWAdminClient | None],
    ) -> RGWAdminClient | None:
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

    def _collect_usage(
        self,
        admin: RGWAdminClient,
        usage_uid: str | None,
    ) -> tuple[int, int, int]:
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
    ) -> tuple[int | None, int | None]:
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
        quota_size_bytes: int | None,
        quota_objects: int | None,
    ) -> float | None:
        ratios: list[float] = []
        if quota_size_bytes and quota_size_bytes > 0:
            ratios.append((float(used_bytes) / float(quota_size_bytes)) * 100.0)
        if quota_objects and quota_objects > 0:
            ratios.append((float(used_objects) / float(quota_objects)) * 100.0)
        if not ratios:
            return None
        return round(max(ratios), 3)
