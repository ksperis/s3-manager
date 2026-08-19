# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from datetime import timedelta

from fastapi import HTTPException, Request, status
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import decode_typed_token
from app.db import AuthSession
from app.services.webauthn_service import WebAuthnService
from app.utils.time import utcnow


_settings = get_settings()


def current_auth_session(request: Request, db: Session) -> AuthSession:
    token = request.cookies.get(_settings.access_token_cookie_name)
    claims = decode_typed_token(token or "", expected_type="ui_access")
    if claims is None:
        claims = decode_typed_token(token or "", expected_type="s3_access")
    if claims is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="UI session required")
    row = db.query(AuthSession).filter(AuthSession.id == claims.get("sid")).first()
    if not row or row.revoked_at is not None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="UI session required")
    return row


def require_recent_mfa(request: Request, db: Session) -> AuthSession:
    row = current_auth_session(request, db)
    if not WebAuthnService(db).is_recent(row):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Recent WebAuthn verification required")
    return row


def require_recent_primary_auth(request: Request, db: Session) -> AuthSession:
    row = current_auth_session(request, db)
    if row.created_at < utcnow() - timedelta(minutes=_settings.mfa_recent_minutes):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Recent primary authentication required")
    return row
