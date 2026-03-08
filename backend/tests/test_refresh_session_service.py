# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from datetime import timedelta

from app.db import RefreshSession
from app.services.refresh_session_service import RefreshSessionService
from app.utils.time import utcnow


def test_refresh_session_create_for_user_get_rotate_revoke_and_expiry(db_session):
    service = RefreshSessionService(db_session)

    token, session = service.create_for_user(user_id=123, auth_type="password")
    assert token
    assert session.user_id == 123
    assert session.s3_session_id is None
    assert session.auth_type == "password"

    fetched = service.get_by_token(token)
    assert fetched is not None
    assert fetched.id == session.id

    old_hash = fetched.token_hash
    rotated_token = service.rotate(fetched)
    assert rotated_token
    db_session.refresh(fetched)
    assert fetched.token_hash != old_hash
    assert fetched.last_used_at is not None

    service.revoke(fetched)
    db_session.refresh(fetched)
    assert fetched.revoked_at is not None
    assert service.is_expired(fetched) is True


def test_refresh_session_create_for_s3_session(db_session):
    service = RefreshSessionService(db_session)
    token, session = service.create_for_s3_session("s3-session-1")

    assert token
    assert session.user_id is None
    assert session.s3_session_id == "s3-session-1"
    assert session.auth_type == "s3_session"


def test_refresh_session_get_by_token_empty_and_expired_by_date(db_session):
    service = RefreshSessionService(db_session)
    assert service.get_by_token("") is None

    _, session = service.create_for_user(user_id=321)
    session.expires_at = utcnow() - timedelta(seconds=1)
    session.revoked_at = None
    db_session.add(session)
    db_session.commit()

    row = db_session.query(RefreshSession).filter(RefreshSession.id == session.id).first()
    assert row is not None
    assert service.is_expired(row) is True
