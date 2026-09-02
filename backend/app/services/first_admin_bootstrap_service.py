# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import hashlib
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy import exists, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.sensitive_data import sanitized_error_log_detail
from app.core.security import get_password_hash
from app.db import FirstAdminBootstrap, User
from app.db.enums import UserRole
from app.models.user import validate_password_policy
from app.services.audit_service import AuditService
from app.utils.time import utcnow


FIRST_ADMIN_BOOTSTRAP_ID = 1
DEFAULT_BOOTSTRAP_TTL_MINUTES = 15


class FirstAdminBootstrapError(ValueError):
    pass


class FirstAdminBootstrapUnavailableError(FirstAdminBootstrapError):
    pass


@dataclass(frozen=True)
class IssuedFirstAdminBootstrap:
    token: str
    expires_at: datetime


@dataclass(frozen=True)
class CreatedFirstAdmin:
    user_id: int
    email: str


class FirstAdminBootstrapService:
    def __init__(self, db: Session) -> None:
        self.db = db

    @staticmethod
    def _digest(token: str) -> str:
        return hashlib.sha256(token.encode("utf-8")).hexdigest()

    @staticmethod
    def _normalize_email(email: str) -> str:
        return str(email or "").strip().lower()

    @staticmethod
    def _normalize_full_name(full_name: Optional[str]) -> Optional[str]:
        value = str(full_name or "").strip()
        return value or None

    @staticmethod
    def _validate_password(password: str) -> None:
        try:
            validate_password_policy(password)
        except ValueError as exc:
            raise FirstAdminBootstrapError(sanitized_error_log_detail(exc)) from exc

    @staticmethod
    def _empty_users_predicate():
        return ~exists(select(User.id))

    def is_available(self) -> bool:
        now = utcnow()
        if int(self.db.query(func.count(User.id)).scalar() or 0) != 0:
            return False
        row = self.db.get(FirstAdminBootstrap, FIRST_ADMIN_BOOTSTRAP_ID)
        return bool(
            row
            and row.token_digest
            and row.consumed_at is None
            and row.expires_at is not None
            and row.expires_at > now
        )

    def issue_token(
        self,
        *,
        ttl_minutes: int = DEFAULT_BOOTSTRAP_TTL_MINUTES,
    ) -> IssuedFirstAdminBootstrap:
        if not 1 <= ttl_minutes <= 60:
            raise FirstAdminBootstrapError(
                "Bootstrap token lifetime must be between 1 and 60 minutes"
            )
        if int(self.db.query(func.count(User.id)).scalar() or 0) != 0:
            raise FirstAdminBootstrapUnavailableError(
                "The database already contains users"
            )

        now = utcnow()
        expires_at = now + timedelta(minutes=ttl_minutes)
        token = secrets.token_urlsafe(32)
        digest = self._digest(token)
        row = self.db.get(FirstAdminBootstrap, FIRST_ADMIN_BOOTSTRAP_ID)
        try:
            if row is None:
                self.db.add(
                    FirstAdminBootstrap(
                        id=FIRST_ADMIN_BOOTSTRAP_ID,
                        token_digest=digest,
                        issued_at=now,
                        expires_at=expires_at,
                    )
                )
                self.db.flush()
            else:
                changed = self.db.execute(
                    update(FirstAdminBootstrap)
                    .where(
                        FirstAdminBootstrap.id == FIRST_ADMIN_BOOTSTRAP_ID,
                        FirstAdminBootstrap.consumed_at.is_(None),
                        self._empty_users_predicate(),
                    )
                    .values(
                        token_digest=digest,
                        issued_at=now,
                        expires_at=expires_at,
                        created_user_id=None,
                    )
                )
                if changed.rowcount != 1:
                    raise FirstAdminBootstrapUnavailableError(
                        "First administrator bootstrap is unavailable"
                    )
            self.db.commit()
        except IntegrityError as exc:
            self.db.rollback()
            raise FirstAdminBootstrapUnavailableError(
                "First administrator bootstrap is unavailable"
            ) from exc

        AuditService(self.db).record_action(
            user=None,
            scope="security",
            action="first_admin_bootstrap_issued",
            entity_type="first_admin_bootstrap",
            entity_id=str(FIRST_ADMIN_BOOTSTRAP_ID),
            metadata={"expires_at": expires_at.isoformat()},
        )
        return IssuedFirstAdminBootstrap(token=token, expires_at=expires_at)

    def create_with_token(
        self,
        *,
        token: str,
        email: str,
        full_name: Optional[str],
        password: str,
        ip_address: Optional[str] = None,
        user_agent: Optional[str] = None,
        request_id: Optional[str] = None,
    ) -> CreatedFirstAdmin:
        normalized_email = self._normalize_email(email)
        self._validate_password(password)
        now = utcnow()
        row = self.db.get(FirstAdminBootstrap, FIRST_ADMIN_BOOTSTRAP_ID)
        actual_digest = self._digest(token)
        expected_digest = row.token_digest if row and row.token_digest else "0" * 64
        token_matches = secrets.compare_digest(actual_digest, expected_digest)
        if (
            not token_matches
            or row is None
            or row.consumed_at is not None
            or row.expires_at is None
            or row.expires_at <= now
        ):
            raise FirstAdminBootstrapUnavailableError(
                "First administrator bootstrap is unavailable"
            )

        changed = self.db.execute(
            update(FirstAdminBootstrap)
            .where(
                FirstAdminBootstrap.id == FIRST_ADMIN_BOOTSTRAP_ID,
                FirstAdminBootstrap.token_digest == actual_digest,
                FirstAdminBootstrap.consumed_at.is_(None),
                FirstAdminBootstrap.expires_at > now,
                self._empty_users_predicate(),
            )
            .values(token_digest=None, consumed_at=now)
        )
        if changed.rowcount != 1:
            self.db.rollback()
            raise FirstAdminBootstrapUnavailableError(
                "First administrator bootstrap is unavailable"
            )

        user = self._new_user(normalized_email, full_name, password)
        self.db.add(user)
        try:
            self.db.flush()
            self.db.execute(
                update(FirstAdminBootstrap)
                .where(FirstAdminBootstrap.id == FIRST_ADMIN_BOOTSTRAP_ID)
                .values(created_user_id=user.id)
            )
            user_id = int(user.id)
            self.db.commit()
        except IntegrityError as exc:
            self.db.rollback()
            raise FirstAdminBootstrapUnavailableError(
                "First administrator bootstrap is unavailable"
            ) from exc

        user = self.db.get(User, user_id)
        AuditService(self.db).record_action(
            user=user,
            scope="security",
            action="first_admin_bootstrap_completed",
            entity_type="user",
            entity_id=str(user_id),
            metadata={"method": "web", "passkey_enrollment_required": True},
            ip_address=ip_address,
            user_agent=user_agent,
            request_id=request_id,
        )
        return CreatedFirstAdmin(user_id=user_id, email=normalized_email)

    def create_from_cli(
        self,
        *,
        email: str,
        full_name: Optional[str],
        password: str,
        confirmation: str,
    ) -> CreatedFirstAdmin:
        normalized_email = self._normalize_email(email)
        expected = f"CREATE FIRST ADMIN {normalized_email}"
        if confirmation != expected:
            raise FirstAdminBootstrapError(
                f"Confirmation must exactly match: {expected}"
            )
        self._validate_password(password)
        if int(self.db.query(func.count(User.id)).scalar() or 0) != 0:
            raise FirstAdminBootstrapUnavailableError(
                "The database already contains users; "
                "create administrators through the UI"
            )

        now = utcnow()
        row = self.db.get(FirstAdminBootstrap, FIRST_ADMIN_BOOTSTRAP_ID)
        try:
            if row is None:
                self.db.add(
                    FirstAdminBootstrap(
                        id=FIRST_ADMIN_BOOTSTRAP_ID,
                        consumed_at=now,
                    )
                )
                self.db.flush()
            else:
                changed = self.db.execute(
                    update(FirstAdminBootstrap)
                    .where(
                        FirstAdminBootstrap.id == FIRST_ADMIN_BOOTSTRAP_ID,
                        FirstAdminBootstrap.consumed_at.is_(None),
                        self._empty_users_predicate(),
                    )
                    .values(token_digest=None, consumed_at=now)
                )
                if changed.rowcount != 1:
                    raise FirstAdminBootstrapUnavailableError(
                        "First administrator bootstrap is unavailable"
                    )

            user = self._new_user(normalized_email, full_name, password)
            self.db.add(user)
            self.db.flush()
            self.db.execute(
                update(FirstAdminBootstrap)
                .where(FirstAdminBootstrap.id == FIRST_ADMIN_BOOTSTRAP_ID)
                .values(created_user_id=user.id)
            )
            user_id = int(user.id)
            self.db.commit()
        except IntegrityError as exc:
            self.db.rollback()
            raise FirstAdminBootstrapUnavailableError(
                "First administrator bootstrap is unavailable"
            ) from exc

        user = self.db.get(User, user_id)
        AuditService(self.db).record_action(
            user=user,
            scope="security",
            action="operator_create_first_superadmin",
            entity_type="user",
            entity_id=str(user_id),
            metadata={"method": "cli", "passkey_enrollment_required": True},
        )
        return CreatedFirstAdmin(user_id=user_id, email=normalized_email)

    @staticmethod
    def _new_user(
        email: str,
        full_name: Optional[str],
        password: str,
    ) -> User:
        normalized_name = FirstAdminBootstrapService._normalize_full_name(full_name)
        return User(
            email=email,
            full_name=normalized_name,
            display_name=normalized_name,
            hashed_password=get_password_hash(password),
            role=UserRole.UI_SUPERADMIN.value,
            is_active=True,
            auth_version=1,
        )
