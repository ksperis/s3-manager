# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import secrets
import uuid
from dataclasses import dataclass
from datetime import timedelta
from typing import Optional

from sqlalchemy import or_, update
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.core.security import (
    create_refresh_token,
    create_s3_access_token,
    create_ui_access_token,
    hash_refresh_token,
)
from app.db import ApiToken, AuthSession, RefreshToken, S3Session, User
from app.utils.time import utcnow


class AuthSessionError(ValueError):
    pass


class RefreshReplayError(AuthSessionError):
    pass


@dataclass(frozen=True)
class SessionCredentials:
    access_token: str
    refresh_token: str
    csrf_token: str
    session: AuthSession


class AuthSessionService:
    def __init__(self, db: Session, settings: Optional[Settings] = None) -> None:
        self.db = db
        self.settings = settings or get_settings()

    def create_for_user(
        self,
        user: User,
        *,
        auth_type: str,
        ip_address: Optional[str],
        user_agent: Optional[str],
        mfa_verified: bool,
    ) -> SessionCredentials:
        now = utcnow()
        absolute = now + timedelta(minutes=self.settings.ui_session_absolute_minutes)
        row = AuthSession(
            id=str(uuid.uuid4()),
            user_id=user.id,
            principal_type="user",
            auth_type=auth_type,
            auth_version=user.auth_version,
            created_at=now,
            last_activity_at=now,
            idle_expires_at=min(now + timedelta(minutes=self.settings.ui_session_idle_minutes), absolute),
            absolute_expires_at=absolute,
            mfa_verified_at=now if mfa_verified else None,
            ip_address=ip_address,
            user_agent=user_agent,
            csrf_token_hash="",
        )
        return self._persist_new_session(row, user=user)

    def create_for_s3_session(
        self,
        s3_session: S3Session,
        *,
        ip_address: Optional[str],
        user_agent: Optional[str],
    ) -> SessionCredentials:
        now = utcnow()
        absolute = min(
            s3_session.absolute_expires_at,
            now + timedelta(minutes=self.settings.s3_session_absolute_minutes),
        )
        row = AuthSession(
            id=str(uuid.uuid4()),
            s3_session_id=s3_session.id,
            principal_type="s3",
            auth_type="s3",
            auth_version=1,
            created_at=now,
            last_activity_at=now,
            idle_expires_at=min(now + timedelta(minutes=self.settings.s3_session_idle_minutes), absolute),
            absolute_expires_at=absolute,
            ip_address=ip_address,
            user_agent=user_agent,
            csrf_token_hash="",
        )
        return self._persist_new_session(row, s3_session=s3_session)

    def rotate(self, raw_token: str) -> SessionCredentials:
        now = utcnow()
        token_hash = hash_refresh_token(raw_token or "")
        current = self.db.query(RefreshToken).filter(RefreshToken.token_hash == token_hash).first()
        if current is None:
            raise AuthSessionError("Invalid refresh token")
        if current.used_at is not None or current.revoked_at is not None:
            self.revoke_family(current.family_id, "refresh_replay")
            raise RefreshReplayError("Refresh token replay detected")
        session = self.db.query(AuthSession).filter(AuthSession.id == current.auth_session_id).first()
        if not self._is_session_active(session, now) or current.expires_at <= now:
            self.revoke_session(current.auth_session_id, "expired")
            raise AuthSessionError("Session expired")
        if session.user_id is not None:
            user = self.db.query(User).filter(User.id == session.user_id).first()
            if not user or not user.is_active or user.auth_version != session.auth_version:
                self.revoke_session(session.id, "principal_changed")
                raise AuthSessionError("User is unavailable")
            s3_session = None
        else:
            user = None
            s3_session = self.db.query(S3Session).filter(S3Session.id == session.s3_session_id).first()
            if not self._is_s3_session_active(s3_session, now):
                self.revoke_session(session.id, "s3_session_expired")
                raise AuthSessionError("S3 session expired")

        claimed = self.db.execute(
            update(RefreshToken)
            .where(
                RefreshToken.id == current.id,
                RefreshToken.used_at.is_(None),
                RefreshToken.revoked_at.is_(None),
            )
            .values(used_at=now)
        )
        if claimed.rowcount != 1:
            self.db.rollback()
            self.revoke_family(current.family_id, "refresh_replay")
            raise RefreshReplayError("Refresh token replay detected")

        next_raw = create_refresh_token()
        next_csrf = secrets.token_urlsafe(32)
        next_row = RefreshToken(
            id=str(uuid.uuid4()),
            family_id=current.family_id,
            auth_session_id=session.id,
            parent_id=current.id,
            token_hash=hash_refresh_token(next_raw),
            created_at=now,
            expires_at=session.absolute_expires_at,
        )
        self.db.add(next_row)
        self.db.flush()
        current.replaced_by_id = next_row.id
        session.last_activity_at = now
        session.csrf_token_hash = hash_refresh_token(next_csrf)
        session.idle_expires_at = min(
            now + timedelta(minutes=self._idle_minutes(session)),
            session.absolute_expires_at,
        )
        if s3_session is not None:
            s3_session.last_used_at = now
            s3_session.idle_expires_at = min(
                now + timedelta(minutes=self.settings.s3_session_idle_minutes),
                s3_session.absolute_expires_at,
            )
        self.db.add_all([current, session])
        self.db.commit()
        return SessionCredentials(
            access_token=self._access_token(session, user=user, s3_session=s3_session),
            refresh_token=next_raw,
            csrf_token=next_csrf,
            session=session,
        )

    def validate_access(self, session_id: str, *, expected_type: str) -> tuple[AuthSession, User | S3Session]:
        now = utcnow()
        session = self.db.query(AuthSession).filter(AuthSession.id == session_id).first()
        expected_principal = "s3" if expected_type == "s3_access" else "user"
        if session is None:
            raise AuthSessionError("Session expired or invalid")
        if not self._is_session_active(session, now):
            self.revoke_session(session.id, "expired")
            raise AuthSessionError("Session expired or invalid")
        if session.principal_type != expected_principal:
            self.revoke_session(session.id, "principal_type_mismatch")
            raise AuthSessionError("Session expired or invalid")
        if session.user_id is not None:
            principal = self.db.query(User).filter(User.id == session.user_id).first()
            if not principal or not principal.is_active or principal.auth_version != session.auth_version:
                self.revoke_session(session.id, "principal_changed")
                raise AuthSessionError("Session expired or invalid")
        else:
            principal = self.db.query(S3Session).filter(S3Session.id == session.s3_session_id).first()
            if not self._is_s3_session_active(principal, now):
                self.revoke_session(session.id, "s3_session_expired")
                raise AuthSessionError("Session expired or invalid")
            principal.last_used_at = now
            principal.idle_expires_at = min(
                now + timedelta(minutes=self.settings.s3_session_idle_minutes),
                principal.absolute_expires_at,
            )
        session.last_activity_at = now
        session.idle_expires_at = min(
            now + timedelta(minutes=self._idle_minutes(session)),
            session.absolute_expires_at,
        )
        self.db.add_all([session, principal])
        self.db.commit()
        return session, principal

    def validate_csrf(self, session: AuthSession, token: Optional[str]) -> bool:
        return bool(token) and secrets.compare_digest(hash_refresh_token(token), session.csrf_token_hash)

    def revoke_session(self, session_id: str, reason: str) -> None:
        session = self.db.query(AuthSession).filter(AuthSession.id == session_id).first()
        if session is None:
            return
        now = utcnow()
        session.revoked_at = session.revoked_at or now
        session.revoke_reason = session.revoke_reason or reason
        self.db.query(RefreshToken).filter(
            RefreshToken.auth_session_id == session.id,
            RefreshToken.revoked_at.is_(None),
        ).update({RefreshToken.revoked_at: now, RefreshToken.revoke_reason: reason}, synchronize_session=False)
        if session.s3_session_id:
            self._erase_s3_session(session.s3_session_id, reason, now)
        self.db.add(session)
        self.db.commit()

    def revoke_family(self, family_id: str, reason: str) -> None:
        now = utcnow()
        session_ids = [
            row[0]
            for row in self.db.query(RefreshToken.auth_session_id)
            .filter(RefreshToken.family_id == family_id)
            .distinct()
            .all()
        ]
        self.db.query(RefreshToken).filter(RefreshToken.family_id == family_id).update(
            {RefreshToken.revoked_at: now, RefreshToken.revoke_reason: reason},
            synchronize_session=False,
        )
        for session_id in session_ids:
            session = self.db.query(AuthSession).filter(AuthSession.id == session_id).first()
            if session:
                session.revoked_at = session.revoked_at or now
                session.revoke_reason = session.revoke_reason or reason
                if session.s3_session_id:
                    self._erase_s3_session(session.s3_session_id, reason, now)
        self.db.commit()

    def revoke_by_refresh_token(
        self,
        raw_token: str,
        reason: str,
        *,
        csrf_token: Optional[str] = None,
    ) -> Optional[str]:
        row = self.db.query(RefreshToken).filter(
            RefreshToken.token_hash == hash_refresh_token(raw_token or ""),
        ).first()
        if row is None:
            return None
        session = self.db.query(AuthSession).filter(AuthSession.id == row.auth_session_id).first()
        if session is None:
            return None
        if csrf_token is not None and not self.validate_csrf(session, csrf_token):
            raise AuthSessionError("Invalid CSRF token")
        self.revoke_family(row.family_id, reason)
        return session.id

    def revoke_all_for_user(self, user: User, reason: str, *, increment_version: bool = True) -> None:
        now = utcnow()
        if increment_version:
            user.auth_version += 1
            self.db.add(user)
        rows = self.db.query(AuthSession).filter(AuthSession.user_id == user.id, AuthSession.revoked_at.is_(None)).all()
        for row in rows:
            row.revoked_at = now
            row.revoke_reason = reason
            self.db.add(row)
        session_ids = [row.id for row in rows]
        if session_ids:
            self.db.query(RefreshToken).filter(
                RefreshToken.auth_session_id.in_(session_ids),
                RefreshToken.revoked_at.is_(None),
            ).update({RefreshToken.revoked_at: now, RefreshToken.revoke_reason: reason}, synchronize_session=False)
        self.db.query(ApiToken).filter(
            ApiToken.user_id == user.id,
            ApiToken.revoked_at.is_(None),
        ).update({ApiToken.revoked_at: now}, synchronize_session=False)
        self.db.commit()

    def list_for_user(self, user_id: int) -> list[AuthSession]:
        return (
            self.db.query(AuthSession)
            .filter(AuthSession.user_id == user_id)
            .order_by(AuthSession.created_at.desc())
            .all()
        )

    def cleanup_expired(self) -> int:
        """Revoke expired rows and irreversibly erase dormant S3 credentials."""
        now = utcnow()
        expired_s3 = self.db.query(S3Session).filter(
            S3Session.revoked_at.is_(None),
            or_(S3Session.idle_expires_at <= now, S3Session.absolute_expires_at <= now),
        ).all()
        expired_s3_ids = [row.id for row in expired_s3]
        auth_conditions = [
            AuthSession.idle_expires_at <= now,
            AuthSession.absolute_expires_at <= now,
        ]
        if expired_s3_ids:
            auth_conditions.append(AuthSession.s3_session_id.in_(expired_s3_ids))
        expired_auth = self.db.query(AuthSession).filter(
            AuthSession.revoked_at.is_(None),
            or_(*auth_conditions),
        ).all()
        auth_ids = [row.id for row in expired_auth]
        for row in expired_auth:
            row.revoked_at = now
            row.revoke_reason = "expired"
            self.db.add(row)
        if auth_ids:
            self.db.query(RefreshToken).filter(
                RefreshToken.auth_session_id.in_(auth_ids),
                RefreshToken.revoked_at.is_(None),
            ).update(
                {RefreshToken.revoked_at: now, RefreshToken.revoke_reason: "expired"},
                synchronize_session=False,
            )
        for row in expired_s3:
            row.access_key_enc = None
            row.secret_key_enc = None
            row.revoked_at = now
            row.revoke_reason = "expired"
            self.db.add(row)
        self.db.commit()
        return len(expired_auth) + len(expired_s3)

    def _persist_new_session(
        self,
        session: AuthSession,
        *,
        user: Optional[User] = None,
        s3_session: Optional[S3Session] = None,
    ) -> SessionCredentials:
        raw_refresh = create_refresh_token()
        csrf = secrets.token_urlsafe(32)
        session.csrf_token_hash = hash_refresh_token(csrf)
        refresh = RefreshToken(
            id=str(uuid.uuid4()),
            family_id=str(uuid.uuid4()),
            auth_session_id=session.id,
            token_hash=hash_refresh_token(raw_refresh),
            created_at=session.created_at,
            expires_at=session.absolute_expires_at,
        )
        self.db.add_all([session, refresh])
        self.db.commit()
        self.db.refresh(session)
        return SessionCredentials(
            access_token=self._access_token(session, user=user, s3_session=s3_session),
            refresh_token=raw_refresh,
            csrf_token=csrf,
            session=session,
        )

    def _access_token(
        self,
        session: AuthSession,
        *,
        user: Optional[User],
        s3_session: Optional[S3Session],
    ) -> str:
        if user is not None:
            return create_ui_access_token(
                user_id=user.id,
                session_id=session.id,
                auth_version=user.auth_version,
                role=user.role,
            )
        if s3_session is None:
            raise AuthSessionError("Session principal is missing")
        return create_s3_access_token(s3_session_id=s3_session.id, auth_session_id=session.id)

    def _idle_minutes(self, session: AuthSession) -> int:
        return self.settings.s3_session_idle_minutes if session.principal_type == "s3" else self.settings.ui_session_idle_minutes

    @staticmethod
    def _is_session_active(session: Optional[AuthSession], now) -> bool:
        return bool(
            session
            and session.revoked_at is None
            and session.idle_expires_at > now
            and session.absolute_expires_at > now
        )

    @staticmethod
    def _is_s3_session_active(session: Optional[S3Session], now) -> bool:
        return bool(
            session
            and session.revoked_at is None
            and session.access_key_enc
            and session.secret_key_enc
            and session.idle_expires_at > now
            and session.absolute_expires_at > now
        )

    def _erase_s3_session(self, session_id: str, reason: str, now) -> None:
        row = self.db.query(S3Session).filter(S3Session.id == session_id).first()
        if row:
            row.access_key_enc = None
            row.secret_key_enc = None
            row.revoked_at = row.revoked_at or now
            row.revoke_reason = row.revoke_reason or reason
            self.db.add(row)
