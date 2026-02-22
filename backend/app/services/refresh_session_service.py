# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from app.utils.time import utcnow
import uuid
from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import create_refresh_token, hash_refresh_token
from app.db import RefreshSession

settings = get_settings()


class RefreshSessionService:
    def __init__(self, db: Session) -> None:
        self.db = db

    def create_for_user(self, user_id: int, auth_type: Optional[str] = None) -> tuple[str, RefreshSession]:
        return self._create(user_id=user_id, s3_session_id=None, auth_type=auth_type)

    def create_for_s3_session(
        self,
        s3_session_id: str,
        auth_type: Optional[str] = "s3_session",
    ) -> tuple[str, RefreshSession]:
        return self._create(user_id=None, s3_session_id=s3_session_id, auth_type=auth_type)

    def get_by_token(self, token: str) -> Optional[RefreshSession]:
        if not token:
            return None
        token_hash = hash_refresh_token(token)
        return (
            self.db.query(RefreshSession)
            .filter(RefreshSession.token_hash == token_hash)
            .first()
        )

    def rotate(self, session: RefreshSession) -> str:
        now = utcnow()
        token = create_refresh_token()
        session.token_hash = hash_refresh_token(token)
        session.last_used_at = now
        session.expires_at = now + timedelta(minutes=settings.refresh_token_expire_minutes)
        self.db.add(session)
        self.db.commit()
        return token

    def revoke(self, session: RefreshSession) -> None:
        session.revoked_at = utcnow()
        self.db.add(session)
        self.db.commit()

    def is_expired(self, session: RefreshSession) -> bool:
        if session.revoked_at is not None:
            return True
        return session.expires_at <= utcnow()

    def _create(
        self,
        *,
        user_id: Optional[int],
        s3_session_id: Optional[str],
        auth_type: Optional[str],
    ) -> tuple[str, RefreshSession]:
        now = utcnow()
        token = create_refresh_token()
        session = RefreshSession(
            id=str(uuid.uuid4()),
            token_hash=hash_refresh_token(token),
            user_id=user_id,
            s3_session_id=s3_session_id,
            auth_type=auth_type,
            created_at=now,
            last_used_at=now,
            expires_at=now + timedelta(minutes=settings.refresh_token_expire_minutes),
        )
        self.db.add(session)
        self.db.commit()
        return token, session
