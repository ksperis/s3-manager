# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from app.utils.time import utcnow

import logging
from typing import Any, Optional

from sqlalchemy.orm import Session

from app.db import (
    S3Account,
    S3User,
    StorageEndpoint,
    StorageProvider,
)
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
    QuotaAlertStateService,
)
from app.services.rgw_admin import RGWAdminClient, RGWAdminError, get_rgw_admin_client
from app.services.rgw_supervision import get_supervision_rgw_client
from app.services.quota_subject import SubjectContext
from app.services.quota_usage_history_service import QuotaUsageHistoryService
from app.services.user_notifications_service import UserNotificationsService
from app.utils.rgw_payloads import extract_bucket_list
from app.utils.storage_endpoint_features import resolve_admin_endpoint
from app.utils.usage_stats import extract_usage_stats

logger = logging.getLogger(__name__)


class QuotaMonitoringService:
    def __init__(self, db: Session) -> None:
        self.db = db

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

        usage_clients: dict[int, Optional[RGWAdminClient]] = {}
        admin_clients: dict[int, Optional[RGWAdminClient]] = {}
        notifications_service = UserNotificationsService(self.db)
        usage_history_service = QuotaUsageHistoryService(self.db)
        alert_state_service = QuotaAlertStateService(self.db)
        recipients_service = QuotaAlertRecipientsService(self.db)
        email_service = QuotaAlertEmailService()
        states = (
            alert_state_service.load_states()
            if quota_alerts_enabled
            else {}
        )
        recipient_index = (
            recipients_service.load()
            if quota_alerts_enabled
            else QuotaAlertRecipientIndex()
        )

        mailer = None
        if quota_alerts_enabled:
            mailer, mail_error_reason = email_service.build_mailer(
                app_settings.quota_notifications
            )
            if mailer is None and mail_error_reason:
                summary["warnings"].append(mail_error_reason)

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
                    content = build_quota_alert_content(
                        subject=subject,
                        previous_level=transition.previous_level,
                        alert_level=next_level,
                        ratio_pct=ratio_pct,
                        threshold_percent=int(
                            app_settings.quota_notifications.threshold_percent
                        ),
                        used_bytes=usage_bytes,
                        used_objects=usage_objects,
                        quota_size_bytes=quota_size_bytes,
                        quota_objects=quota_objects,
                        checked_at=now,
                    )
                    notification_user_ids = recipients_service.notification_user_ids(
                        subject=subject,
                        index=recipient_index,
                    )
                    summary["notifications_created"] += notifications_service.create_quota_alert_notifications(
                        user_ids=notification_user_ids,
                        subject_type=subject.subject_type,
                        subject_id=subject.subject_id,
                        storage_endpoint_id=subject.endpoint_id,
                        event_key=content.event_key,
                        title=content.title,
                        message=content.message,
                        severity=content.severity,
                        payload=content.payload,
                        created_at=now,
                    )
                    recipients = recipients_service.email_recipients(
                        subject=subject,
                        index=recipient_index,
                        include_subject_contact=bool(app_settings.quota_notifications.include_subject_contact_email),
                    )
                    if recipients:
                        sent = email_service.send_alert_email(
                            mailer=mailer,
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
