# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from datetime import datetime
import json
from typing import Any, Iterable, Optional

from sqlalchemy import or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db import PortalAccountRole, User, UserNotification, UserRole
from app.models.user_notification import UserNotificationOut, UserNotificationsResponse
from app.services.effective_access_service import EffectiveAccessService
from app.utils.time import utcnow


def _parse_notification_payload(raw: str) -> dict[str, Any]:
    payload = json.loads(raw)
    if not isinstance(payload, dict):
        raise ValueError("User notification payload must be a JSON object")
    return payload


class UserNotificationsService:
    def __init__(self, db: Session) -> None:
        self.db = db

    def create_quota_alert_notifications(
        self,
        *,
        user_ids: Iterable[int],
        subject_type: str,
        subject_id: int,
        storage_endpoint_id: int,
        event_key: str,
        title: str,
        message: str,
        severity: str,
        payload: dict[str, Any],
        created_at: datetime,
    ) -> int:
        created = 0
        clean_user_ids = sorted({int(user_id) for user_id in user_ids if int(user_id) > 0})
        if not clean_user_ids:
            return 0

        existing_user_ids = {
            int(row[0])
            for row in self.db.query(UserNotification.user_id)
            .filter(
                UserNotification.user_id.in_(clean_user_ids),
                UserNotification.event_key == event_key,
            )
            .all()
        }
        payload_json = json.dumps(payload, ensure_ascii=True, sort_keys=True)
        for user_id in clean_user_ids:
            if user_id in existing_user_ids:
                continue
            row = UserNotification(
                    user_id=user_id,
                    notification_type="quota_alert",
                    severity=severity,
                    title=title,
                    message=message,
                    subject_type=subject_type,
                    storage_endpoint_id=storage_endpoint_id,
                    s3_account_id=subject_id if subject_type == "account" else None,
                    s3_user_id=subject_id if subject_type == "s3_user" else None,
                    event_key=event_key,
                    payload_json=payload_json,
                    created_at=created_at,
                )
            try:
                with self.db.begin_nested():
                    self.db.add(row)
                    self.db.flush()
            except IntegrityError:
                continue
            created += 1
        return created

    def list_for_user(self, user: User, *, limit: int = 20) -> UserNotificationsResponse:
        visible = self._visible_notifications_query(user)
        items = (
            visible.order_by(UserNotification.created_at.desc(), UserNotification.id.desc())
            .limit(max(1, min(int(limit), 100)))
            .all()
        )
        unread_count = int(visible.filter(UserNotification.read_at.is_(None)).count())
        return UserNotificationsResponse(
            items=[self._to_out(item) for item in items],
            unread_count=unread_count,
        )

    def mark_read(
        self,
        user: User,
        *,
        notification_ids: Optional[list[int]] = None,
        mark_all: bool = False,
    ) -> int:
        visible = self._visible_notifications_query(user).filter(UserNotification.read_at.is_(None))
        if not mark_all:
            ids = [int(item) for item in notification_ids or [] if int(item) > 0]
            if not ids:
                return 0
            visible = visible.filter(UserNotification.id.in_(ids))

        now = utcnow()
        rows = visible.all()
        for row in rows:
            row.read_at = now
        self.db.commit()
        return len(rows)

    def unread_count_for_user(self, user: User) -> int:
        return int(
            self._visible_notifications_query(user)
            .filter(UserNotification.read_at.is_(None))
            .count()
        )

    def _visible_notifications_query(self, user: User):
        query = self.db.query(UserNotification).filter(UserNotification.user_id == user.id)
        access = EffectiveAccessService(self.db).resolve_user(user)
        alert_account_ids = {
            int(link.account_id)
            for link in access.account_links
            if link.portal_role == PortalAccountRole.PORTAL_MANAGER.value
        }
        alert_s3_user_ids = {int(item) for item in access.s3_user_ids}
        global_watch = bool(
            user.is_active
            and user.quota_alerts_global_watch
            and user.role in {UserRole.UI_ADMIN.value, UserRole.UI_SUPERADMIN.value}
        )

        visibility_filters = [UserNotification.subject_type.is_(None)]
        if global_watch:
            visibility_filters.append(UserNotification.subject_type.in_(["account", "s3_user"]))
        else:
            if alert_account_ids:
                visibility_filters.append(
                    (UserNotification.subject_type == "account")
                    & UserNotification.s3_account_id.in_(alert_account_ids)
                )
            if alert_s3_user_ids:
                visibility_filters.append(
                    (UserNotification.subject_type == "s3_user")
                    & UserNotification.s3_user_id.in_(alert_s3_user_ids)
                )

        return query.filter(or_(*visibility_filters))

    def _to_out(self, row: UserNotification) -> UserNotificationOut:
        return UserNotificationOut(
            id=int(row.id),
            type=row.notification_type,
            severity=row.severity,
            title=row.title,
            message=row.message,
            subject_type=row.subject_type,
            storage_endpoint_id=row.storage_endpoint_id,
            s3_account_id=row.s3_account_id,
            s3_user_id=row.s3_user_id,
            payload=_parse_notification_payload(row.payload_json),
            created_at=row.created_at,
            read_at=row.read_at,
        )
