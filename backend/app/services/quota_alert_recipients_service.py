# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from dataclasses import dataclass, field
from typing import Optional

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.db import (
    AccountRole,
    UiGroupS3Account,
    UiGroupS3User,
    User,
    UserRole,
    UserS3Account,
    UserS3User,
    UserUiGroup,
)
from app.services.quota_subject import SubjectContext


@dataclass
class QuotaAlertRecipientIndex:
    account_emails: dict[int, set[str]] = field(default_factory=dict)
    s3_user_emails: dict[int, set[str]] = field(default_factory=dict)
    global_emails: set[str] = field(default_factory=set)
    account_user_ids: dict[int, set[int]] = field(default_factory=dict)
    s3_user_member_ids: dict[int, set[int]] = field(default_factory=dict)
    global_user_ids: set[int] = field(default_factory=set)


def normalize_email(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    return str(value).strip().lower() or None


class QuotaAlertRecipientsService:
    """Resolve email and in-app recipients from effective quota access."""

    def __init__(self, db: Session) -> None:
        self.db = db

    def load(self) -> QuotaAlertRecipientIndex:
        index = QuotaAlertRecipientIndex()
        self._load_account_users(index)
        self._load_account_group_users(index)
        self._load_s3_users(index)
        self._load_s3_group_users(index)
        self._load_global_users(index)
        return index

    @staticmethod
    def email_recipients(
        *,
        subject: SubjectContext,
        index: QuotaAlertRecipientIndex,
        include_subject_contact: bool,
    ) -> list[str]:
        recipients = set(index.global_emails)
        if subject.subject_type == "account":
            recipients.update(
                index.account_emails.get(subject.subject_id, set())
            )
        else:
            recipients.update(
                index.s3_user_emails.get(subject.subject_id, set())
            )
        if include_subject_contact:
            subject_email = normalize_email(subject.contact_email)
            if subject_email:
                recipients.add(subject_email)
        return sorted(recipients)

    @staticmethod
    def notification_user_ids(
        *,
        subject: SubjectContext,
        index: QuotaAlertRecipientIndex,
    ) -> list[int]:
        user_ids = set(index.global_user_ids)
        if subject.subject_type == "account":
            user_ids.update(
                index.account_user_ids.get(subject.subject_id, set())
            )
        else:
            user_ids.update(
                index.s3_user_member_ids.get(subject.subject_id, set())
            )
        return sorted(user_ids)

    def _load_account_users(
        self,
        index: QuotaAlertRecipientIndex,
    ) -> None:
        rows = (
            self.db.query(
                UserS3Account.account_id,
                User.id,
                User.email,
                User.quota_alerts_enabled,
            )
            .join(User, User.id == UserS3Account.user_id)
            .filter(User.is_active.is_(True))
            .filter(
                or_(
                    UserS3Account.is_root.is_(True),
                    UserS3Account.role.in_(
                        [
                            AccountRole.PORTAL_MANAGER.value,
                            AccountRole.ACCOUNT_ADMINISTRATOR.value,
                        ]
                    ),
                )
            )
            .all()
        )
        for account_id, user_id, email, email_enabled in rows:
            self._add_scoped_recipient(
                email_map=index.account_emails,
                user_id_map=index.account_user_ids,
                subject_id=account_id,
                user_id=user_id,
                email=email,
                email_enabled=email_enabled,
            )

    def _load_account_group_users(
        self,
        index: QuotaAlertRecipientIndex,
    ) -> None:
        rows = (
            self.db.query(
                UiGroupS3Account.account_id,
                User.id,
                User.email,
                User.quota_alerts_enabled,
            )
            .join(
                UserUiGroup,
                UserUiGroup.group_id == UiGroupS3Account.group_id,
            )
            .join(User, User.id == UserUiGroup.user_id)
            .filter(User.is_active.is_(True))
            .filter(
                UiGroupS3Account.role.in_(
                    [
                        AccountRole.PORTAL_MANAGER.value,
                        AccountRole.ACCOUNT_ADMINISTRATOR.value,
                    ]
                )
            )
            .all()
        )
        for account_id, user_id, email, email_enabled in rows:
            self._add_scoped_recipient(
                email_map=index.account_emails,
                user_id_map=index.account_user_ids,
                subject_id=account_id,
                user_id=user_id,
                email=email,
                email_enabled=email_enabled,
            )

    def _load_s3_users(self, index: QuotaAlertRecipientIndex) -> None:
        rows = (
            self.db.query(
                UserS3User.s3_user_id,
                User.id,
                User.email,
                User.quota_alerts_enabled,
            )
            .join(User, User.id == UserS3User.user_id)
            .filter(User.is_active.is_(True))
            .all()
        )
        for s3_user_id, user_id, email, email_enabled in rows:
            self._add_scoped_recipient(
                email_map=index.s3_user_emails,
                user_id_map=index.s3_user_member_ids,
                subject_id=s3_user_id,
                user_id=user_id,
                email=email,
                email_enabled=email_enabled,
            )

    def _load_s3_group_users(
        self,
        index: QuotaAlertRecipientIndex,
    ) -> None:
        rows = (
            self.db.query(
                UiGroupS3User.s3_user_id,
                User.id,
                User.email,
                User.quota_alerts_enabled,
            )
            .join(
                UserUiGroup,
                UserUiGroup.group_id == UiGroupS3User.group_id,
            )
            .join(User, User.id == UserUiGroup.user_id)
            .filter(User.is_active.is_(True))
            .all()
        )
        for s3_user_id, user_id, email, email_enabled in rows:
            self._add_scoped_recipient(
                email_map=index.s3_user_emails,
                user_id_map=index.s3_user_member_ids,
                subject_id=s3_user_id,
                user_id=user_id,
                email=email,
                email_enabled=email_enabled,
            )

    def _load_global_users(
        self,
        index: QuotaAlertRecipientIndex,
    ) -> None:
        rows = (
            self.db.query(
                User.id,
                User.email,
                User.quota_alerts_enabled,
            )
            .filter(User.is_active.is_(True))
            .filter(User.quota_alerts_global_watch.is_(True))
            .filter(
                User.role.in_(
                    [
                        UserRole.UI_ADMIN.value,
                        UserRole.UI_SUPERADMIN.value,
                    ]
                )
            )
            .all()
        )
        for user_id, email, email_enabled in rows:
            index.global_user_ids.add(int(user_id))
            if email_enabled:
                normalized = normalize_email(email)
                if normalized:
                    index.global_emails.add(normalized)

    @staticmethod
    def _add_scoped_recipient(
        *,
        email_map: dict[int, set[str]],
        user_id_map: dict[int, set[int]],
        subject_id: int,
        user_id: int,
        email: Optional[str],
        email_enabled: bool,
    ) -> None:
        canonical_subject_id = int(subject_id)
        user_id_map.setdefault(canonical_subject_id, set()).add(
            int(user_id)
        )
        if not email_enabled:
            return
        normalized = normalize_email(email)
        if normalized:
            email_map.setdefault(canonical_subject_id, set()).add(
                normalized
            )
